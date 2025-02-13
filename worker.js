const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const { exec } = require("child_process");
const axios = require("axios");
const Redis = require("ioredis");

const connection = new Redis({ maxRetriesPerRequest: null });

////////////////////////////////////////////////////////////
//
// Create the worker
//
////////////////////////////////////////////////////////////

const worker = new Worker(
  "email-processing",
  async (job) => {
    try {
      console.log("================================================");
      console.log(`📩 Processing new email (Job ID: ${job.id})`);
      console.log("================================================");

      // Run email through SpamAssassin
      exec(`echo ${JSON.stringify(job.data.rawEmail)} | spamassassin -e`, async (err, stdout) => {
        console.log("🚨 Running SpamAssassin...");
        if (stdout.includes("X-Spam-Flag: YES")) {
          console.warn("🚨 Spam detected, rejecting email.");
          await job.moveToCompleted("Spam email rejected", true);
          return;
        }

        console.log("✅ Email passed SpamAssassin check");

        // Parse the email
        const parsed = await simpleParser(job.data.rawEmail);

        // Extract Account ID from Envelope
        let accountId = job.data.envelopeTo?.[0]?.split("@")[0] || "unknown";
        if (accountId === "unknown" && parsed.to?.value?.[0]?.address) {
          accountId = parsed.to.value[0].address.split("@")[0];
        }

        // Extract Sender Info
        let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
        let fromName = parsed.from?.value?.[0]?.name || "";

        // Extract Full Original Sender (Return-Path or Reply-To)
        let originalSender =
          parsed.headers.get("return-path") ||
          parsed.headers.get("reply-to") ||
          fromEmail;

        // Extract Recipient Info
        let toEmail = parsed.to?.value?.[0]?.address || "Unknown Recipient";
        let toName = parsed.to?.value?.[0]?.name || "";

        // Extract Attachments
        let attachmentData = [];
        if (parsed.attachments && parsed.attachments.length > 0) {
          attachmentData = parsed.attachments.map((attachment) => ({
            filename: attachment.filename,
            size: attachment.size,
            mimeType: attachment.contentType,
            content: attachment.content.toString("base64"),
          }));
        }

        console.log("✅ Parsed email successfully. Sending to webhook...");

        // Send Data to Webhook
        await axios.post("https://ngrok.doerkit.dev/webhook_email", {
          account_id: accountId,
          from: fromEmail,
          from_name: fromName,
          original_sender: originalSender, // ✅ New: Include original sender
          to: toEmail,
          to_name: toName,
          subject: parsed.subject || "No Subject",
          body_text: parsed.text || "No Text Content",
          body_html: parsed.html || "No HTML Content",
          attachments: attachmentData,
        });

        console.log("✅ Webhook request sent successfully.");
      });
    } catch (err) {
      console.log("================================================");
      console.error("❌ Error processing email:", err);
      console.log("================================================");
    }
  },
  { connection, concurrency: 5 }
);

////////////////////////////////////////////////////////////
//
// Log when a job is completed
//
////////////////////////////////////////////////////////////

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully.`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);

  if (job.attemptsMade < 3) {
    console.log(`🔄 Retrying job ${job.id} in 10 seconds...`);

    await job.queue.add(job.name, job.data, {
      delay: 10000, // Retry after 10 seconds
      attempts: 3, // Max retry attempts
    });
  }
});

console.log("📡 Email worker started with concurrency 5...");
