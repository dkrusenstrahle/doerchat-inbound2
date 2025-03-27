const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
const Redis = require("ioredis");
require("dotenv").config();

const redisConnection = new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", { connection: redisConnection });

// Configuration (from environment variables)
const ACCEPTED_DOMAIN = process.env.ACCEPTED_DOMAIN || "doerchatmail.com"; // e.g., "doerchatmail.com"

////////////////////////////////////////////////////////////
//
// Rate Limiting Function
//
////////////////////////////////////////////////////////////

async function checkRateLimit(ip) {
  const key = `rate-limit:${ip}`;
  const count = await redisConnection.incr(key);

  if (count === 1) {
    await redisConnection.expire(key, process.env.RATE_LIMIT_WINDOW_SECONDS || 300);
  }

  if (count > (process.env.RATE_LIMIT_MAX_CONNECTIONS || 200)) {
    return false; // Block IP
  }
  return true; // Allow IP
}

////////////////////////////////////////////////////////////
//
// HELO Validation
//
////////////////////////////////////////////////////////////

function isValidHelo(helo) {
  console.log(`🔍 Validating HELO: ${helo}`);
  if (!helo) return false;
  // Relaxed check allowing underscores
  return /^[a-zA-Z0-9._-]+$/.test(helo);
}

////////////////////////////////////////////////////////////
//
// SMTP Server Setup
//
////////////////////////////////////////////////////////////

const server = new SMTPServer({
  logger: true,
  disabledCommands: ['STARTTLS'],
  authOptional: true, // Still recommended, but can be skipped for simplicity

  ////////////////////////////////////////////////////////////
  //
  // Authentication Handler (if authOptional is false)
  //
  ////////////////////////////////////////////////////////////
  async onAuth(auth, session, callback) {
    // If authOptional is true, this can be removed/simplified
    // Example (replace with real credentials check):
    if (auth.username === "testuser" && auth.password === "testpass") {
      console.log(`✅ Authentication successful for ${auth.username}`);
      return callback(null, { user: auth.username }); // Success
    } else {
      console.warn(`❌ Authentication failed for ${auth.username}`);
      return callback(new Error("Invalid username or password")); // Failure
    }
  },

  ////////////////////////////////////////////////////////////
  //
  // Connection Handling
  //
  ////////////////////////////////////////////////////////////
  async onConnect(session, callback) {
    const ip = session.remoteAddress;
    console.log(`📥 [${new Date().toISOString()}] Incoming SMTP connection from: ${ip}`);

    const allowed = await checkRateLimit(ip);
    if (!allowed) {
        console.warn(`🚨 Rate limit exceeded for ${ip}`);
        return callback(new Error("Too many connections, please try again later."));
    }

    // Skip HELO validation if authenticated
    if (!session.isAuthenticated) {
        if (!isValidHelo(session.helo)) {
            console.warn(`🚨 Invalid HELO/EHLO received from ${ip}`);
            return callback(new Error("Invalid HELO/EHLO"));
        }
    } else {
        console.log(`✅ Skipping HELO validation for authenticated user`);
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
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/.test(recipient); // Basic UUID check

    if (!isValidRecipient) {
      console.warn(`❌ Rejected recipient: ${recipient}`);
      return callback(new Error("Recipient address not allowed"));
    }

    console.log(`✅ Accepted recipient: ${recipient}`);
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
  },
});

////////////////////////////////////////////////////////////
//
// Start the SMTP Server
//
////////////////////////////////////////////////////////////

server.listen(process.env.SMTP_PORT || 25, process.env.SMTP_HOST || "0.0.0.0", () => {
  console.log(`📡 [${new Date().toISOString()}] SMTP Server listening on port ${process.env.SMTP_PORT || 25}...`);
});
