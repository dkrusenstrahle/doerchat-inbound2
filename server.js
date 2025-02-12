const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");

// Create SMTP Server
const server = new SMTPServer({
  logger: true, // Enable logging for debugging
  disableStartTLS: true, // Disable TLS (use real certs in production)
  onAuth(auth, session, callback) {
    // Accept all users (disable authentication)
    return callback(null, { user: auth.username });
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

