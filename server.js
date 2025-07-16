const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");

const Redis = require("ioredis");

const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

const ACCEPTED_DOMAIN = "doerchatmail.com";

const EMAIL_RATE_LIMIT_WINDOW = 300;
const EMAIL_RATE_LIMIT_MAX = 1000;

////////////////////////////////////////////////////////////
//
// Rate Limiting Functions
//
////////////////////////////////////////////////////////////

async function checkIPRateLimit(ip) {
  const key = `ip-rate-limit:${ip}`;
  const count = await redisConnection.incr(key);

  if (count === 1) {
    await redisConnection.expire(key, EMAIL_RATE_LIMIT_WINDOW);
  }

  if (count > EMAIL_RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

async function checkEmailRateLimit(email) {
  const key = `email-rate-limit:${email}`;
  const count = await redisConnection.incr(key);

  if (count === 1) {
    await redisConnection.expire(key, EMAIL_RATE_LIMIT_WINDOW);
  }

  if (count > EMAIL_RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

////////////////////////////////////////////////////////////
//
// SMTP Server Setup
//
////////////////////////////////////////////////////////////

const server = new SMTPServer({
  logger: true,
  disabledCommands: ["STARTTLS"],
  authOptional: true,

  ////////////////////////////////////////////////////////////
  //
  // Connection Handling
  //
  ////////////////////////////////////////////////////////////

  async onConnect(session, callback) {
    const ip = session.remoteAddress; // or try session.client.remoteAddress
    console.log(
      `📥 [${new Date().toISOString()}] Incoming SMTP connection from: ${ip}`
    );

    const allowed = await checkIPRateLimit(ip); // Apply IP-based rate limiting
    if (!allowed) {
      console.warn(`🚨 IP Rate limit exceeded for ${ip}`);
      return callback(
        new Error("Too many connections from this IP, please try again later.")
      );
    }

    callback();
  },

  ////////////////////////////////////////////////////////////
  //
  // Recipient Verification
  //
  ////////////////////////////////////////////////////////////

  onRcptTo(address, session, callback) {
    const recipient = address.address;

    // Check if the recipient address matches the expected pattern
    const isValidRecipient =
      recipient.endsWith(`@${ACCEPTED_DOMAIN}`) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/.test(
        recipient
      ); // Basic UUID check

    if (!isValidRecipient) {
      console.warn(`❌ Rejected recipient: ${recipient}`);
      return callback(new Error("Recipient address not allowed"));
    }

    console.log(`✅ Accepted recipient: ${recipient}`);
    callback();
  },

  ////////////////////////////////////////////////////////////
  //
  // MAIL FROM Verification and Rate Limining
  //
  ////////////////////////////////////////////////////////////

  async onMailFrom(address, session, callback) {
    const mailFrom = address.address;

    const allowed = await checkEmailRateLimit(mailFrom); // Apply email-based rate limiting
    if (!allowed) {
      console.warn(`🚨 Email Rate limit exceeded for: ${mailFrom}`);
      return callback(
        new Error("Too many emails from this address, please try again later.")
      );
    }

    console.log(`✅ Accepted MAIL FROM: ${mailFrom}`);
    callback();
  },

  ////////////////////////////////////////////////////////////
  //
  // Process the email
  //
  ////////////////////////////////////////////////////////////

  onData(stream, session, callback) {
    let emailData = "";
    const rcptToEmails = session.envelope.rcptTo.map(
      (recipient) => recipient.address
    );

    console.log(
      `📩 [${new Date().toISOString()}] Email received. Envelope to: ${rcptToEmails.join(
        ", "
      )}`
    );

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
  },

  ////////////////////////////////////////////////////////////
  //
  // Error handling for server itself
  //
  ////////////////////////////////////////////////////////////

  onError(err) {
    console.error(`🚨 [${new Date().toISOString()}] SMTP Server internal error:`, err);
  },

  onClose(session) {
    console.log(
      `🔌 [${new Date().toISOString()}] Connection closed for: ${session.remoteAddress}`
    );
  },
});

////////////////////////////////////////////////////////////
//
// Global Unhandled Exception/Rejection Handlers
//
////////////////////////////////////////////////////////////

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "💣 [FATAL] Unhandled Rejection at:",
    promise,
    "reason:",
    reason
  );
});

process.on("uncaughtException", (err) => {
  console.error("💥 [FATAL] Uncaught Exception:", err);
});

////////////////////////////////////////////////////////////
//
// Start the SMTP Server
//
////////////////////////////////////////////////////////////

server.listen(25, "0.0.0.0", () => {
  console.log(`📡 [${new Date().toISOString()}] SMTP Server listening on port ${25}...`);
});