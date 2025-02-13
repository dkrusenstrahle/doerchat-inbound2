const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis();
const emailQueue = new Queue("email-processing", { connection });

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
        await emailQueue.add("new-email", { rawEmail: emailData });
        callback(null);
      } catch (err) {
        console.error("❌ Failed to enqueue email:", err);
        callback(new Error("Email processing failed"));
      }
    });
  }
});

server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server listening on port 25...");
});
