const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

////////////////////////////////////////////////////////////
//
// Custom Rate Limiting Function (DISABLED FOR NOW)
//
////////////////////////////////////////////////////////////

// async function checkRateLimit(ip) {
//   const key = `rate-limit:${ip}`;
//   const count = await redisConnection.incr(key);

//   if (count === 1) {
//     await redisConnection.expire(key, 300); // Reset counter after 5 minutes
//   }

//   if (count > 2000) {
//     return false; // Block IP
//   }
//   return true; // Allow IP
// }

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
  // Log when an SMTP connection starts
  //
  ////////////////////////////////////////////////////////////

  async onConnect(session, callback) {
    const ip = session.remoteAddress;
    console.log(`📥 [${new Date().toISOString()}] Incoming SMTP connection from: ${ip}`);

    // 🔥 Rate limiting disabled for now
    // const allowed = await checkRateLimit(ip);
    // if (!allowed) {
    //   console.warn(`🚨 Rate limit exceeded for ${ip}`);
    //   return callback(new Error("Too many connections, please try again later."));
    // }

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

    console.log(`📩 [${new Date().toISOString()}] Email received. Envelope to: ${rcptToEmails.join(", ")}`);

    stream.on("data", (chunk) => {
      emailData += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        console.log(`✅ [${new Date().toISOString()}] Email added to queue`);
        await emailQueue.add("processEmail", {
          rawEmail: emailData,
          envelopeTo: rcptToEmails,
        });
        callback(null);
      } catch (err) {
        console.error(`❌ [${new Date().toISOString()}] Error queuing email:`, err);
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
  console.log(`📡 [${new Date().toISOString()}] SMTP Server listening on port 25...`);
});
