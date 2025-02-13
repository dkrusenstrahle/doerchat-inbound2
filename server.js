const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
const Redis = require("ioredis");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");


// 🔥 Redis connection for BullMQ and Rate Limiting
const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

// 🔒 Rate Limiting (50 emails per 10 minutes per IP)
const limiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisConnection.call(...args),
  }),
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // Limit each IP to 50 requests per window
  message: "Too many emails sent, please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});

// 🚀 SMTP Server Setup
const server = new SMTPServer({
  logger: true,
  disableStartTLS: true,
  authOptional: true,

  // 🔒 Apply Rate Limiting on Connection
  onConnect(session, callback) {
    const ip = session.remoteAddress;

    limiter({ ip }, {}, (err) => {
      if (err) {
        console.warn(`🚨 Rate limit exceeded for ${ip}`);
        return callback(new Error("Too many connections, please try again later."));
      }
      callback();
    });
  },

  onData(stream, session, callback) {
    let emailData = "";
    const rcptToEmails = session.envelope.rcptTo.map((recipient) => recipient.address);

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        await emailQueue.add("processEmail", {
          rawEmail: emailData,
          envelopeTo: rcptToEmails,
        });
        callback(null);
      } catch (err) {
        console.error("❌ Error queuing email:", err);
        callback(new Error("Email queueing failed"));
      }
    });
  }
});

server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server with rate limiting listening on port 25...");
});
