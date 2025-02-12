const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const fs = require("fs");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // No TLS for now
  authOptional: true, // Allow without authentication

  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const parsed = await simpleParser(emailData);
        
        // Extract everything before '@' from recipient email
        const toEmail = parsed.to?.value?.[0]?.address || ""; // Get first recipient
        const accountId = toEmail.split("@")[0] || "unknown"; // Get part before '@'

        console.log(`✅ Matched Account ID: ${accountId}`);

        // Process attachments
        let attachmentData = [];
        if (parsed.attachments && parsed.attachments.length > 0) {
          parsed.attachments.forEach((attachment) => {
            const filePath = `/tmp/${attachment.filename}`;
            fs.writeFileSync(filePath, attachment.content); // Save to disk
            attachmentData.push({
              filename: attachment.filename,
              size: attachment.size,
              path: filePath, // Provide file path
              mimeType: attachment.contentType,
            });
          });
        }

        // Send email data to webhook
        await axios.post("https://ngrok.doerkit.dev/webhook_email", {
          account_id: accountId, // Identify user
          from: parsed.from?.text || "Unknown Sender",
          to: parsed.to?.text || "Unknown Recipient",
          subject: parsed.subject || "No Subject",
          text: parsed.text || "No Text Content",
          html: parsed.html || "No HTML Content",
          attachments: attachmentData, // Send attachment details
        });

        console.log("✅ Email successfully processed and sent to webhook.");
        callback(null);
      } catch (err) {
        console.error("❌ Error parsing email:", err);
        callback(new Error("Email parsing failed"));
      }
    });
  }
});

server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
