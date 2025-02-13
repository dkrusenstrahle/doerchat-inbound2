const express = require("express");
const { createBullBoard } = require("@bull-board/api");
const { BullAdapter } = require("@bull-board/api/bullAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis();
const emailQueue = new Queue("email-processing", { connection });

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullAdapter(emailQueue)],
  serverAdapter,
});

serverAdapter.setBasePath("/admin/queues");

const app = express();
app.use("/admin/queues", serverAdapter.getRouter());

app.listen(3001, () => {
  console.log("🚀 Bull Board running on http://localhost:3001/admin/queues");
});
