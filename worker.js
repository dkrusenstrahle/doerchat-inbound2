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

      // Extract recipient email and account ID
      const toEmail = parsed.to?.value?.[0]?.address || "";
      const accountId = toEmail.split("@")[0] || "unknown";

      // Extract sender email & name
      let fromEmail = "Unknown Sender";
      let fromName = "";

      if (parsed.from?.value?.length > 0) {
        fromEmail = parsed.from.value[0].address || "Unknown Sender";
        fromName = parsed.from.value[0].name || ""; // Extracts name if present
      }

      // Process attachments
      let attachmentData = [];
      if (parsed.attachments && parsed.attachments.length > 0) {
        attachmentData = parsed.attachments.map((attachment) => ({
          filename: attachment.filename,
          size: attachment.size,
          mimeType: attachment.contentType,
          content: attachment.content.toString("base64"),
        }));
      }

      // Send parsed email data to webhook
      await axios.post("https://ngrok.doerkit.dev/webhook_email", {
        account_id: accountId,
        from: fromEmail,
        from_name: fromName, // Adds sender name if available
        to: parsed.to?.text || "Unknown Recipient",
        subject: parsed.subject || "No Subject",
        text: parsed.text || "No Text Content",
        html: parsed.html || "No HTML Content",
        attachments: attachmentData,
      });

      console.log(`✅ Processed email from ${fromEmail} (${fromName || "No Name"})`);
    } catch (err) {
      console.error("❌ Error processing email:", err);
    }
  },
  { connection, concurrency: 5 } // Adjust concurrency as needed
);

console.log("📡 Email processing worker started...");
