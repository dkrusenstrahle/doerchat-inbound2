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

        console.log("=== 📩 Incoming Email ===");
        console.log("📨 From:", parsed.from?.text || "Unknown Sender");
        console.log("📬 To:", parsed.to?.text || "Unknown Recipient");
        console.log("📌 Subject:", parsed.subject || "No Subject");

        // Extract user account from the recipient email
        const toEmail = parsed.to?.text || "";
        const match = toEmail.match(/(\w+)@mail2\.doerkit\.com/);
        const accountId = match ? match[1] : "unknown";

        console.log(`✅ Matched Account ID: ${accountId}`);

        // Send parsed email data to a webhook or database
        await axios.post("https://your-webhook-url.com/incoming-email", {
          account_id: accountId, // Identify the user
          from: parsed.from?.text || "Unknown Sender",
          to: parsed.to?.text || "Unknown Recipient",
          subject: parsed.subject || "No Subject",
          text: parsed.text || "No Text Content",
          html: parsed.html || "No HTML Content",
          attachments: parsed.attachments ? parsed.attachments.map(a => ({
            filename: a.filename,
            size: a.size
          })) : []
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
