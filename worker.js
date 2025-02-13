const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const Redis = require("ioredis");

const connection = new Redis({ maxRetriesPerRequest: null });

const worker = new Worker(
  "email-processing",
  async (job) => {
    try {
      const parsed = await simpleParser(job.data.rawEmail);

      // ✅ Use RCPT TO as account_id
      const accountId = job.data.envelopeTo?.[0]?.split("@")[0] || "unknown";

      let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
      let fromName = parsed.from?.value?.[0]?.name || "";

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
        account_id: accountId, // ✅ Extracted from `RCPT TO`
        from: fromEmail,
        from_name: fromName,
        to: parsed.to?.text || "Unknown Recipient",
        subject: parsed.subject || "No Subject",
        text: parsed.text || "No Text Content",
        html: parsed.html || "No HTML Content",
        attachments: attachmentData,
      });

      console.log(`✅ Processed email for Account ID: ${accountId}`);
    } catch (err) {
      console.error("❌ Error processing email:", err);
    }
  },
  { connection, concurrency: 5 }
);

console.log("📡 Email processing worker started...");
