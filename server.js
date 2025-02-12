const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // No encryption for now
  authOptional: true, // Allow emails without authentication

  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      console.log("\n📩 Received Raw Email Data:\n");
      console.log(emailData);
      console.log("\n====================================\n");

      try {
        // Parse email content
        const parsed = await simpleParser(emailData);

        console.log("=== 📩 Parsed Email ===");
        console.log("📨 From:", parsed.from?.text || "Unknown Sender");
        console.log("📬 To:", parsed.to?.text || "Unknown Recipient");
        console.log("📌 Subject:", parsed.subject || "No Subject");
        console.log("📝 Text Body:", parsed.text || "No Text Content");
        console.log("🖥 HTML Body:", parsed.html || "No HTML Content");
        console.log("📎 Attachments:", parsed.attachments ? parsed.attachments.map(a => a.filename) : "None");

        // Send parsed email data to a webhook
        await axios.post("https://ngrok.doerkit.dev/webhook", {
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
        callback(null); // Accept the email
      } catch (err) {
        console.error("❌ Error parsing email:", err);
        callback(new Error("Email parsing failed"));
      }
    });
  }
});

// Start listening on port 25
server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
