const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // No TLS (use a reverse proxy for security)
  onAuth(auth, session, callback) {
    return callback(null, { user: auth.username }); // Accept all emails
  },
  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const parsed = await simpleParser(emailData);

        console.log("=== Incoming Email ===");
        console.log("From:", parsed.from.text);
        console.log("To:", parsed.to.text);
        console.log("Subject:", parsed.subject);
        console.log("Text Body:", parsed.text);
        console.log("HTML Body:", parsed.html);
        console.log("Attachments:", parsed.attachments.map(a => a.filename));

        // Send email data to webhook
        await axios.post("https://ngrok.doerkit.dev/webhook", {
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

        callback(null); // Accept the email
      } catch (err) {
        console.error("Error parsing email:", err);
        callback(err);
      }
    });
  },
});

// Start listening on port 25
server.listen(25, "0.0.0.0", () => {
  console.log("SMTP Server listening on port 25...");
});
