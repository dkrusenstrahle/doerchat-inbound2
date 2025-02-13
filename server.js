const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

////////////////////////////////////////////////////////////
//
// Custom Rate Limiting Function (200 emails per 5 minutes per IP)
//
////////////////////////////////////////////////////////////

async function checkRateLimit(ip) {
  const key = `rate-limit:${ip}`;
  const count = await redisConnection.incr(key);

  if (count === 1) {
    await redisConnection.expire(key, 300); // Reset counter after 5 minutes
  }

  if (count > 200) {
    return false; // Block IP
  }
  return true; // Allow IP
}

////////////////////////////////////////////////////////////
//
// SMTP Server Setup
//
////////////////////////////////////////////////////////////

const server = new SMTPServer({
  logger: true,
  disableStartTLS: true,
  authOptional: true,

  ////////////////////////////////////////////////////////////
  //
  // Apply Rate Limiting on Connection
  //
  ////////////////////////////////////////////////////////////

  async onConnect(session, callback) {
    const ip = session.remoteAddress;
    const allowed = await checkRateLimit(ip);

    if (!allowed) {
      console.warn(`🚨 Rate limit exceeded for ${ip}`);
      return callback(new Error("Too many connections, please try again later."));
    }
    callback();
  },

  ////////////////////////////////////////////////////////////
  //
  // Process the email
  //
  ////////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////////
//
// Start the SMTP Server
//
////////////////////////////////////////////////////////////

server.listen(25, "0.0.0.0", () => {
  console.log("📡 SMTP Server with rate limiting listening on port 25...");
});
