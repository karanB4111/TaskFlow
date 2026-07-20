const { Worker, UnrecoverableError } = require("bullmq");
const { redisConnection } = require("../../config/redis");
const JobLog = require("../../db/JobLog.model");
const registerWorkerLogging = require("./workerLogging");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// processing function
async function processImageJob(job) {
  const { imageUrl } = job.data;

  if (!imageUrl) {
    throw new UnrecoverableError("Please upload a valid image");
  }

  const job_Id = `${job.name}:${job.id}`; 

  await JobLog.findOneAndUpdate(
    { jobId: job_Id},
    {
        $set: {
            type: "image",
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

  await sleep(1500);

  return{
    messageID : `mock-image-${job_Id}`,
    imageUrl,
    sentAt : new Date().toISOString(),
  };
 
}

//new Worker & connection
const imageWorker = new Worker("image", processImageJob, {
  connection: redisConnection,
  concurrency: 5
});

registerWorkerLogging(imageWorker);

//logs based on events
imageWorker.on("completed", async (job, result) => {
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

imageWorker.on("failed", async (job, error) => {
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

module.exports = imageWorker;
