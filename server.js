const { SMTPServer } = require("smtp-server");

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true, // No encryption for now
  authOptional: true, // Allow emails without authentication

  onData(stream, session, callback) {
    let emailData = "";

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", () => {
      console.log("\n📩 Received Raw Email Data:\n");
      console.log(emailData);
      console.log("\n====================================\n");

      callback(null); // Accept the email
    });
  }
});

// Start listening on port 25
server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
