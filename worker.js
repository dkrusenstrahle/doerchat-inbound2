const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const { exec } = require("child_process");
const axios = require("axios");
const Redis = require("ioredis");
require("dotenv").config();

////////////////////////////////////////////////////////////
//
// Improved Redis Connection Handling
//
////////////////////////////////////////////////////////////

const connection = new Redis({
  maxRetriesPerRequest: null,
  reconnectOnError: (err) => {
    console.error("⚠️ Redis Error, reconnecting...", err);
    return true;
  },
  retryStrategy: (times) => Math.min(times * 200, 2000), // Exponential backoff
});

////////////////////////////////////////////////////////////
//
// Job Processor
//
////////////////////////////////////////////////////////////

const worker = new Worker(
  "email-processing",
  async (job) => {
    console.log("================================================");
    console.log(`📩 Processing Job ID: ${job.id}`);
    console.log("================================================");

    try {
      console.log("📩 Parsing the email...");
      const parsed = await simpleParser(job.data.rawEmail);

      // Extract email metadata
      const accountId = job.data.envelopeTo[0].split("@")[0]; // Reliable account ID extraction
      console.log(`Account ID: ${accountId}`);

      let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
      let fromName = parsed.from?.value?.[0]?.name || "";
      let toEmail = parsed.to?.value?.[0]?.address || "Unknown Recipient";
      let toName = parsed.to?.value?.[0]?.name || "";

      let messageId = parsed.messageId || null;
      let inReplyTo = parsed.inReplyTo || null;

      let attachmentData = parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        size: attachment.size,
        mimeType: attachment.contentType,
        content: attachment.content.toString("base64"),
      }));

      console.log("📨 Sending the email to the webhook...");
      const response = await axios.post("https://api.doerchat.com/webhook_inbound", {
        account_id: accountId,
        from: fromEmail,
        from_name: fromName,
        to: toEmail,
        to_name: toName,
        subject: parsed.subject || "No Subject",
        body_text: parsed.text || "No Text Content",
        body_html: parsed.html || "No HTML Content",
        message_id: messageId,
        in_reply_to: inReplyTo,
        attachments: attachmentData,
      });

      console.log(`✅ Webhook sent successfully: ${response.status} ${response.statusText}`);
    } catch (err) {
      console.error("❌ Error processing email:", err.message);
      throw err; // Let BullMQ handle retries
    }
  },
  {
    connection,
    concurrency: 5,
    settings: {
      retryProcessDelay: 5000, // Delay before retrying a failed job
      stalledInterval: 60000, // Check for stalled jobs every minute
    },
  }
);

////////////////////////////////////////////////////////////
//
//  Job Event Handlers for Debugging
//
////////////////////////////////////////////////////////////

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully.`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);

  if (job.attemptsMade < job.opts.attempts) {
    console.log(`🔄 Retrying job ${job.id} in 10 seconds...`);
    await job.retry();
  }
});
