const { SMTPServer } = require("smtp-server");
const { Queue } = require("bullmq");
require("dotenv").config();

const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const redisConnection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new Redis({ maxRetriesPerRequest: null });
const emailQueue = new Queue("email-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: parseInt(process.env.EMAIL_JOB_ATTEMPTS || "8", 10),
    backoff: {
      type: "exponential",
      delay: parseInt(process.env.EMAIL_JOB_BACKOFF_MS || "5000", 10),
    },
    removeOnComplete: {
      age: parseInt(process.env.EMAIL_JOB_RETENTION_SECONDS || "86400", 10), // 24h
      count: 10000,
    },
    removeOnFail: {
      age: parseInt(process.env.EMAIL_JOB_FAIL_RETENTION_SECONDS || "604800", 10), // 7d
      count: 20000,
    },
  },
});

const ACCEPTED_DOMAIN = "doerchatmail.com";

const EMAIL_RATE_LIMIT_WINDOW = parseInt(
  process.env.EMAIL_RATE_LIMIT_WINDOW_SECONDS || "300",
  10
);
const EMAIL_RATE_LIMIT_MAX = parseInt(
  process.env.EMAIL_RATE_LIMIT_MAX || "1000",
  10
);

const MAX_EMAIL_SIZE = parseInt(
  process.env.MAX_EMAIL_SIZE_BYTES || `${20 * 1024 * 1024}`,
  10
);

const spoolDir =
  process.env.EMAIL_SPOOL_DIR || path.join(process.cwd(), ".spool");

async function cleanupSpoolDir() {
  const maxAgeSeconds = parseInt(
    process.env.EMAIL_SPOOL_MAX_AGE_SECONDS || "604800",
    10
  ); // 7 days
  const now = Date.now();
  try {
    await fs.promises.mkdir(spoolDir, { recursive: true });
  } catch (_) {}
  let entries = [];
  try {
    entries = await fs.promises.readdir(spoolDir);
  } catch (_) {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".eml"))
      .map(async (name) => {
        const full = path.join(spoolDir, name);
        try {
          const stat = await fs.promises.stat(full);
          const ageSeconds = (now - stat.mtimeMs) / 1000;
          if (ageSeconds > maxAgeSeconds) {
            await fs.promises.unlink(full);
          }
        } catch (_) {}
      })
  );
}

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
  size: MAX_EMAIL_SIZE,
  maxClients: parseInt(process.env.SMTP_MAX_CLIENTS || "200", 10),
  socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || "120000", 10),
  closeTimeout: parseInt(process.env.SMTP_CLOSE_TIMEOUT_MS || "30000", 10),

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
    let emailSize = 0;

    const rcptToEmails = session.envelope.rcptTo.map(
      (recipient) => recipient.address
    );
    const mailFrom = session.envelope.mailFrom?.address || null;
    const remoteAddress = session.remoteAddress || null;

    console.log(
      `📩 [${new Date().toISOString()}] Email received. Envelope to: ${rcptToEmails.join(
        ", "
      )}`
    );

    try {
      fs.mkdirSync(spoolDir, { recursive: true });
    } catch (_) {
      // best-effort; if this fails, write stream creation will fail below
    }

    const spoolFile = path.join(
      spoolDir,
      `${Date.now()}-${crypto.randomUUID()}.eml`
    );
    const writeStream = fs.createWriteStream(spoolFile, { flags: "wx" });
    const hasher = crypto.createHash("sha256");
    let aborted = false;

    const abort = (err) => {
      if (aborted) return;
      aborted = true;
      try {
        stream.pause();
      } catch (_) {}
      try {
        writeStream.destroy();
      } catch (_) {}
      try {
        fs.unlinkSync(spoolFile);
      } catch (_) {}
      callback(err);
    };

    stream.on("data", (chunk) => {
      emailSize += chunk.length;
      if (emailSize > MAX_EMAIL_SIZE) {
        console.warn(`🚨 Email size limit exceeded (${emailSize} bytes)`);
        return abort(new Error("Message size exceeds limit (20MB)"));
      }
      hasher.update(chunk);
      if (!writeStream.write(chunk)) {
        stream.pause();
        writeStream.once("drain", () => stream.resume());
      }
    });

    stream.on("end", async () => {
      try {
        writeStream.end();
        await new Promise((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
        });

        const sha256 = hasher.digest("hex");
        console.log(
          `✅ [${new Date().toISOString()}] Email spooled (${emailSize} bytes, sha256=${sha256.slice(
            0,
            12
          )}...) and added to queue`
        );

        try {
          await emailQueue.add(
            "processEmail",
            {
              emailPath: spoolFile,
              envelopeTo: rcptToEmails,
              mailFrom,
              remoteAddress,
              sha256,
              emailSize,
            },
            { jobId: sha256 }
          );
        } catch (err) {
          // BullMQ throws if jobId already exists; treat as idempotent success.
          if (
            err &&
            typeof err.message === "string" &&
            err.message.includes("JobId") &&
            err.message.includes("already exists")
          ) {
            console.warn(
              `♻️ [${new Date().toISOString()}] Duplicate email detected (sha256=${sha256.slice(
                0,
                12
              )}...), skipping enqueue`
            );
            try {
              fs.unlinkSync(spoolFile);
            } catch (_) {}
            callback(null);
            return;
          }
          throw err;
        }
        callback(null);
      } catch (err) {
        console.error(`❌ [${new Date().toISOString()}] Error queuing email:`, err);
        try {
          fs.unlinkSync(spoolFile);
        } catch (_) {}
        callback(new Error("Email queueing failed"));
      }
    });

    stream.on("error", (err) => abort(err));
    writeStream.on("error", (err) => abort(err));
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

const SMTP_PORT = parseInt(process.env.SMTP_PORT || "25", 10);
const SMTP_HOST = process.env.SMTP_HOST || "0.0.0.0";

server.listen(SMTP_PORT, SMTP_HOST, async () => {
  console.log(
    `📡 [${new Date().toISOString()}] SMTP Server listening on ${SMTP_HOST}:${SMTP_PORT}...`
  );
  void cleanupSpoolDir().catch(() => {});
  setInterval(() => {
    void cleanupSpoolDir().catch(() => {});
  }, parseInt(process.env.EMAIL_SPOOL_CLEAN_INTERVAL_MS || "3600000", 10)); // hourly
});

////////////////////////////////////////////////////////////
//
// Graceful shutdown
//
////////////////////////////////////////////////////////////

async function shutdown(signal) {
  console.log(`🛑 Received ${signal}, shutting down...`);
  try {
    await new Promise((resolve) => server.close(resolve));
  } catch (_) {}
  try {
    await emailQueue.close();
  } catch (_) {}
  try {
    await redisConnection.quit();
  } catch (_) {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));