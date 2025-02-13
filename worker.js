const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const Redis = require("ioredis");

const connection = new Redis({
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "email-processing",
  async (job) => {
    try {
      const parsed = await simpleParser(job.data.rawEmail);

      // ✅ Extract correct account_id from `RCPT TO`
      let accountId = "unknown";
      if (parsed.to?.value?.length > 0) {
        const toEmail = parsed.to.value[0].address || "";
        accountId = toEmail.split("@")[0] || "unknown";
      }

      // ✅ Extract sender email and name (default from the email headers)
      let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
      let fromName = parsed.from?.value?.[0]?.name || "";

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
        account_id: accountId, // ✅ Extracted from `RCPT TO`
        from: fromEmail, // ✅ Sender email
        from_name: fromName, // ✅ Sender name
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
