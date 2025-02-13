const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true,
  authOptional: true,

  onData(stream, session, callback) {
    let emailData = "";
    const rcptToEmails = session.envelope.rcptTo.map((recipient) => recipient.address);

    console.log(`📩 Received Email`);
    console.log(`📥 RCPT TO: ${rcptToEmails.join(", ")}`);

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const parsed = await simpleParser(emailData);

        await emailQueue.add("processEmail", {
          rawEmail: emailData,
          envelopeTo: rcptToEmails, // ✅ Add extracted RCPT TO addresses
        });

        console.log("✅ Email added to queue for processing");
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
