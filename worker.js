const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const Redis = require("ioredis");
const { exec } = require("child_process");

const connection = new Redis({ maxRetriesPerRequest: null });

const worker = new Worker(
  "email-processing",
  async (job) => {
    try {
      console.log("📩 Processing new email...");

      exec(`echo ${JSON.stringify(job.data.rawEmail)} | spamassassin -e`, async (err, stdout, stderr) => {
        if (stdout.includes("X-Spam-Flag: YES")) {
          console.warn("🚨 SpamAssassin detected spam, rejecting email.");
          await job.moveToCompleted("Spam email rejected", true);
          return;
        }

        const parsed = await simpleParser(job.data.rawEmail);

        let accountId = job.data.envelopeTo?.[0]?.split("@")[0] || "unknown";
        if (accountId === "unknown" && parsed.to?.value?.[0]?.address) {
          accountId = parsed.to.value[0].address.split("@")[0];
        }

        let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
        let fromName = parsed.from?.value?.[0]?.name || "";
        let toEmail = parsed.to?.value?.[0]?.address || "Unknown Recipient";
        let toName = parsed.to?.value?.[0]?.name || "";

        let attachmentData = [];
        if (parsed.attachments && parsed.attachments.length > 0) {
          attachmentData = parsed.attachments.map((attachment) => ({
            filename: attachment.filename,
            size: attachment.size,
            mimeType: attachment.contentType,
            content: attachment.content.toString("base64"),
          }));
        }

        await axios.post("https://ngrok.doerkit.dev/webhook_email", {
          account_id: accountId,
          from: fromEmail,
          from_name: fromName,
          to: toEmail,
          to_name: toName,
          subject: parsed.subject || "No Subject",
          text: parsed.text || "No Text Content",
          html: parsed.html || "No HTML Content",
          attachments: attachmentData,
        });
      });
    } catch (err) {
      console.error("❌ Error processing email:", err);
    }
  },
  { connection, concurrency: 5 }
);
