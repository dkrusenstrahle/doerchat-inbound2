const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const Redis = require("ioredis");

const connection = new Redis({
  maxRetriesPerRequest: null,
});

const worker = new Worker("email-processing",
  async (job) => {
    try {
      const parsed = await simpleParser(job.data.rawEmail);

      // ✅ Extract the correct `account_id` from `RCPT TO`
      let accountId = "unknown";
      if (parsed.to?.value?.length > 0) {
        const toEmail = parsed.to.value[0].address || "";
        accountId = toEmail.split("@")[0] || "unknown";
      }

      // ✅ Extract the original sender's email and name from the forwarded content
      let fromEmail = "Unknown Sender";
      let fromName = "";

      if (parsed.from?.value?.length > 0) {
        fromEmail = parsed.from.value[0].address || "Unknown Sender";
        fromName = parsed.from.value[0].name || "";
      }

      // 🔥 Handle Gmail Forwarding: Extract **real sender** from email body
      const forwardedMatch = parsed.text?.match(/From:\s*(.*?)\s*<(.+?)>/);
      if (forwardedMatch) {
        fromName = forwardedMatch[1]?.trim() || "";
        fromEmail = forwardedMatch[2]?.trim() || fromEmail; // Keep Gmail `from` as fallback
      }

      // ✅ Process attachments
      let attachmentData = [];
      if (parsed.attachments && parsed.attachments.length > 0) {
        attachmentData = parsed.attachments.map((attachment) => ({
          filename: attachment.filename,
          size: attachment.size,
          mimeType: attachment.contentType,
          content: attachment.content.toString("base64"),
        }));
      }

      // ✅ Send parsed email data to webhook
      await axios.post("https://ngrok.doerkit.dev/webhook_email", {
        account_id: accountId, // ✅ Now using the correct recipient!
        from: fromEmail, // ✅ Extracted real sender
        from_name: fromName, // ✅ Extracted real sender name
        to: parsed.to?.text || "Unknown Recipient",
        subject: parsed.subject || "No Subject",
        text: parsed.text || "No Text Content",
        html: parsed.html || "No HTML Content",
        attachments: attachmentData,
      });

      console.log(`✅ Processed email from ${fromEmail} (${fromName || "No Name"}), Account ID: ${accountId}`);
    } catch (err) {
      console.error("❌ Error processing email:", err);
    }
  },
  { connection, concurrency: 5 }
);

console.log("📡 Email processing worker started...");
