require("dotenv").config();
const { Worker } = require("bullmq");
const { simpleParser } = require("mailparser");
const { spawn } = require("child_process");
const axios = require("axios");
const Redis = require("ioredis");
const fs = require("fs/promises");
const http = require("http");
const https = require("https");

////////////////////////////////////////////////////////////
//
// Improved Redis Connection Handling
//
////////////////////////////////////////////////////////////

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  reconnectOnError: (err) => {
    console.error("⚠️ Redis Error, reconnecting...", err);
    return true;
  },
  retryStrategy: (times) => Math.min(times * 200, 2000), // Exponential backoff
});

const axiosClient = axios.create({
  timeout: parseInt(process.env.DOERCHAT_API_TIMEOUT_MS || "10000", 10),
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 100 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 100 }),
});

////////////////////////////////////////////////////////////
//
// Utility: Run SpamAssassin Safely
//
////////////////////////////////////////////////////////////

const runSpamAssassin = (email) => {
  return new Promise((resolve, reject) => {
    // Use spawn instead of exec to avoid command injection
    const child = spawn("spamassassin", ["-e"]);
    let stdout = "";
    let stderr = "";
    const timeoutMs = parseInt(process.env.SPAMASSASSIN_TIMEOUT_MS || "30000", 10);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      reject(new Error(`SpamAssassin timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data;
    });

    child.stderr.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // SpamAssassin -e exits with 1 if spam, but we also want the stdout for the score
      // We only reject if there's a serious error (stderr or code > 1)
      if (stderr && code > 1) {
        console.error("SpamAssassin Error:", stderr);
        return reject(new Error(`SpamAssassin failed with code ${code}`));
      }
      resolve(stdout);
    });

    child.stdin.end(email);
  });
};

async function getRawEmail(job) {
  if (job.data?.rawEmail) return job.data.rawEmail;
  if (job.data?.emailPath) return await fs.readFile(job.data.emailPath);
  throw new Error("Missing rawEmail/emailPath in job data");
}

async function safeUnlink(pathname) {
  if (!pathname) return;
  try {
    await fs.unlink(pathname);
  } catch (_) {}
}

////////////////////////////////////////////////////////////
//
// Job Processor
//
////////////////////////////////////////////////////////////

const worker = new Worker(
  "email-processing",
  async (job) => {
    console.log("================================================");
    console.log(`📩 Processing Job ID: ${job.id}`);
    console.log("================================================");

    try {
      const rawEmail = await getRawEmail(job);

      console.log("🚀 Running SpamAssassin...");
      const spamCheckResult = await runSpamAssassin(rawEmail);

      // Extract the SpamAssassin score
      const scoreMatch = spamCheckResult.match(/X-Spam-Score:\s*([0-9.]+)/);
      const spamScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0; // Default to 0 if no score

      const spamThreshold = parseFloat(process.env.SPAM_THRESHOLD || "5.0");
      console.log(`SpamAssassin Score: ${spamScore}, Threshold: ${spamThreshold}`);

      if (spamCheckResult.includes("X-Spam-Flag: YES") || spamScore > spamThreshold) {
        console.warn("🚨 SpamAssassin detected spam, rejecting email.");
        throw new Error(`Spam email detected (SpamAssassin Score: ${spamScore})`);
      }

      console.log("📩 Parsing the email...");
      const parsed = await simpleParser(rawEmail);

      // Extract email metadata
      const accountId = job.data.envelopeTo[0].split("@")[0]; // Reliable account ID extraction
      console.log(`Account ID: ${accountId}`);

      const cacheKey = `account-exists:${accountId}`;
      const cached = await connection.get(cacheKey);
      let accountOk = null;
      if (cached === "1") accountOk = true;
      if (cached === "0") accountOk = false;

      if (accountOk === null) {
        const accountExists = await axiosClient.post(
          "https://api.doerchat.com/rest/v1/check-account",
          { account_id: accountId }
        );
        accountOk = Boolean(accountExists?.data?.data?.success);
        // Cache for 5 minutes to reduce upstream load
        await connection.set(cacheKey, accountOk ? "1" : "0", "EX", 300);
      }

      if (accountOk) {
        console.log("🔍 Account exists, processing email...");
      } else {
        console.log("🔍 Account does not exist, skipping...");
        // No need to keep spooled email if it won't be processed
        await safeUnlink(job.data?.emailPath);
        return;
      }

      let fromEmail = parsed.from?.value?.[0]?.address || "Unknown Sender";
      let fromName = parsed.from?.value?.[0]?.name || "";
      let toEmail = parsed.to?.value?.[0]?.address || "Unknown Recipient";
      let toName = parsed.to?.value?.[0]?.name || "";

      let messageId = parsed.messageId || null;
      let inReplyTo = parsed.inReplyTo || null;

      let attachmentData = parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        size: attachment.size,
        mimeType: attachment.contentType,
        content: attachment.content.toString("base64"),
      }));

      console.log("📨 Sending the email to the webhook...");
      const response = await axiosClient.post(
        "https://api.doerchat.com/webhook_inbound",
        {
          account_id: accountId,
          from: fromEmail,
          from_name: fromName,
          to: toEmail,
          to_name: toName,
          subject: parsed.subject || "No Subject",
          body_text: parsed.text || "No Text Content",
          body_html: parsed.html || "No HTML Content",
          message_id: messageId,
          in_reply_to: inReplyTo,
          attachments: attachmentData,
        },
        {
          headers: {
            "x-webhook-secret": process.env.DOERCHAT_WEBHOOK_SECRET,
          },
        }
      );

      console.log(`✅ Webhook sent successfully: ${response.status} ${response.statusText}`);
    } catch (err) {
      console.error("❌ Error processing email:", err?.message || err);
      throw err; // Let BullMQ handle retries
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
    settings: {
      retryProcessDelay: 5000, // Delay before retrying a failed job
      stalledInterval: 60000, // Check for stalled jobs every minute
    },
  }
);

////////////////////////////////////////////////////////////
//
//  Job Event Handlers for Debugging
//
////////////////////////////////////////////

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully.`);
  safeUnlink(job.data?.emailPath);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);

  const attempts = job?.opts?.attempts ?? 0;
  if (attempts && job.attemptsMade >= attempts) {
    // No retries left; clean up spool file to prevent disk growth.
    await safeUnlink(job.data?.emailPath);
  }
});

////////////////////////////////////////////////////////////
//
// Graceful shutdown
//
////////////////////////////////////////////////////////////

async function shutdown(signal) {
  console.log(`🛑 Received ${signal}, closing worker...`);
  try {
    await worker.close();
  } catch (_) {}
  try {
    await connection.quit();
  } catch (_) {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
