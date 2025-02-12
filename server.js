const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // Disable TLS (use a reverse proxy for security)
  authOptional: true, // Allow incoming mail without authentication

  onAuth(auth, session, callback) {
    // Disable authentication for incoming emails
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

        console.log("=== 📩 Incoming Email ===");
        console.log("📨 From:", parsed.from.text);
        console.log("📬 To:", parsed.to.text);
        console.log("📌 Subject:", parsed.subject);
        console.log("📝 Text Body:", parsed.text);
        console.log("🖥 HTML Body:", parsed.html);
        console.log("📎 Attachments:", parsed.attachments.map(a => a.filename));

        // Send email data to webhook
        await axios.post("https://your-webhook-url.com/incoming-email", {
          from: parsed.from.text,
          to: parsed.to.text,
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          attachments: parsed.attachments.map(a => ({
            filename: a.filename,
            size: a.size
          }))
        });

        console.log("✅ Email successfully processed and sent to webhook.");
        callback(null); // Accept the email
      } catch (err) {
        console.error("❌ Error parsing email:", err);
        callback(err);
      }
    });
  }
});

// Start listening on port 25 for incoming mail
server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
