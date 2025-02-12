const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // No encryption
  authOptional: true, // Allow incoming mail without authentication

  onAuth(auth, session, callback) {
    console.log("🔹 Authentication not required, allowing mail...");
    return callback(null, { user: "anonymous" });
  },

  onConnect(session, callback) {
    console.log(`📡 New connection from: ${session.remoteAddress}`);
    callback(); // Accept all connections
  },

  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const parsed = await simpleParser(emailData);

        if (!parsed || !parsed.from || !parsed.to || !parsed.subject) {
          console.error("❌ Parsed email data is incomplete or undefined.");
          return callback(new Error("Email parsing failed"));
        }

        console.log("=== 📩 Incoming Email ===");
        console.log("📨 From:", parsed.from ? parsed.from.text : "Unknown Sender");
        console.log("📬 To:", parsed.to ? parsed.to.text : "Unknown Recipient");
        console.log("📌 Subject:", parsed.subject || "No Subject");
        console.log("📝 Text Body:", parsed.text || "No Text Content");
        console.log("🖥 HTML Body:", parsed.html || "No HTML Content");
        console.log("📎 Attachments:", parsed.attachments ? parsed.attachments.map(a => a.filename) : "None");

        // Send email data to webhook
        await axios.post("https://your-webhook-url.com/incoming-email", {
          from: parsed.from ? parsed.from.text : "Unknown Sender",
          to: parsed.to ? parsed.to.text : "Unknown Recipient",
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
        callback(new Error("Failed to process email"));
      }
    });
  }
});

// Start listening on port 25
server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
