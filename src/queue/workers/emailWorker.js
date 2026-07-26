const { Worker, UnrecoverableError } = require("bullmq");
const { redisConnection } = require("../../config/redis");
const JobLog = require("../../db/JobLog.model");
const registerWorkerLogging = require("./workerLogging");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// processing function
async function processEmailJob(job) {
  const { to, subject, body } = job.data;

  if (!to || !subject || !body) {
    throw new UnrecoverableError("Email job requires 'to', 'subject', and 'body'");
  }

  const job_Id = `${job.name}:${job.id}`;

  await JobLog.findOneAndUpdate(
    { jobId: job_Id },
    {
        $set: {
            type: "email",
            status: "active",
            attempts: job.attemptsMade + 1,
            data: job.data,
            startedAt: new Date(),
            error: null,
        },
        $setOnInsert: {
            jobId: job_Id,
        }
  },
  { upsert: true, returnDocument: 'after'}
  );

  await job.updateProgress(10);
  await sleep(1500);
  await job.updateProgress(90);

  const result = {
    messageID : `mock-email-${job_Id}`,
    to,
    subject,
    sentAt : new Date().toISOString(),
  };

  await job.updateProgress(100);
  return result;
 
}

//new Worker & connection
const emailWorker = new Worker("email", processEmailJob, {
  connection: redisConnection,
  concurrency: 5
});

registerWorkerLogging(emailWorker);

//logs based on events
emailWorker.on("completed", async (job, result) => {
    const job_Id = `${job.name}:${job.id}`

    await JobLog.findOneAndUpdate(
        { jobId: job_Id },
        {
            $set: {
                status: "completed",
                result,
                completedAt: new Date(),
                error: null,
            },
        }
    );
});

emailWorker.on("failed", async (job, error) => {
    if (!job) {
        return;
    }

    const job_Id = `${job.name}:${job.id}`

    await JobLog.findOneAndUpdate(
        { jobId: job_Id },
        {
            $set: {
                status: "failed",
                error: error.message,
                attempts: job?.attemptsMade,
            },
        }
    );
});

module.exports = emailWorker;
