const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true,
  authOptional: true,

  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const parsed = await simpleParser(emailData);
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

        callback(null);
      } catch (err) {
        callback(new Error("Email parsing failed"));
      }
    });
  }
});

server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
