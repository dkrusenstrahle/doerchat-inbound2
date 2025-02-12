const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const Redis = require("ioredis");

const connection = new Redis();

const worker = new Worker("email-processing", async (job) => {
  try {
    const parsed = await simpleParser(job.data.rawEmail);
    const toEmail = parsed.to?.value?.[0]?.address || "";
    const accountId = toEmail.split("@")[0] || "unknown";

    let attachmentData = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
      attachmentData = parsed.attachments.map(attachment => ({
        filename: attachment.filename,
        size: attachment.size,
        mimeType: attachment.contentType,
        content: attachment.content.toString("base64")
      }));
    }

    await axios.post("https://ngrok.doerkit.dev/webhook_email", {
      account_id: accountId,
      from: parsed.from?.text || "Unknown Sender",
      to: parsed.to?.text || "Unknown Recipient",
      subject: parsed.subject || "No Subject",
      text: parsed.text || "No Text Content",
      html: parsed.html || "No HTML Content",
      attachments: attachmentData
    });

    console.log(`✅ Email processed for account: ${accountId}`);
  } catch (err) {
    console.error("❌ Error processing email:", err);
  }
}, { connection });

console.log("📡 Worker started, waiting for jobs...");
