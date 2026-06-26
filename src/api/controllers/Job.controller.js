const Job = require('../../db/JobLog.model');
const { getQueueByType } = require("../../queue/index");

async function createJob(req, res) {
    const { type, data, priority, delay } = req.body;

    if (!type || !data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({
            success: false,
            message: "Fields 'type' and 'data' are required",
        });
    }

    const jobPriority = priority ?? 5;
    const jobDelay = delay ?? 0;

    if (!Number.isInteger(jobPriority) || jobPriority < 1 || jobPriority > 10) {
        return res.status(400).json({
            success: false,
            message: "Priority must be an integer between 1 and 10",
        });
    }

    if (!Number.isInteger(jobDelay) || jobDelay < 0) {
        return res.status(400).json({
            success: false,
            message: "Delay must be a non-negative integer",
        });
    }

    try {
        const queue = getQueueByType(type);
        const job = await queue.add(type, data, {
            priority: jobPriority,
            delay: jobDelay,
        });

        await Job.create({
            jobId: job.id,
            type,
            status: 'waiting',
            priority: jobPriority,
            data,
        });

        return res.status(202).json({
            success: true,
            jobId: job.id,
            type,
            status: 'waiting',
            priority: jobPriority,
        });
    } catch (err) {
        console.error('Error creating job:', err);

        if (err.code === 'UNKNOWN_JOB_TYPE') {
            return res.status(400).json({
                success: false,
                message: err.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error creating job',
        });
    }
}

module.exports = {
    createJob,
};

