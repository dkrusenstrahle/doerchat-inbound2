const express = require("express");
const basicAuth = require("express-basic-auth");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis();
const emailQueue = new Queue("email-processing", { connection });

const serverAdapter = new ExpressAdapter();

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

// 🔒 Add Basic Authentication Middleware
const app = express();
app.use(
  "/admin/queues",
  basicAuth({
    users: { "admin": "paulina1" }, // Change username & password
    challenge: true, // Shows browser pop-up for credentials
    unauthorizedResponse: "Unauthorized",
  }),
  serverAdapter.getRouter()
);

serverAdapter.setBasePath("/admin/queues");

app.listen(3001, "0.0.0.0", () => {
  console.log("🚀 Bull Board secured at http://YOUR-SERVER-IP:3001/admin/queues");
});
