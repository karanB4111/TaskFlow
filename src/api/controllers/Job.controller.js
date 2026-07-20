const Job = require('../../db/JobLog.model');
const { getQueueByType } = require("../../queue/queues/index");
const logger = require('../../utils/logger');

const VALID_JOB_TYPES = ['email', 'image', 'report'];
const VALID_JOB_STATUSES = ['waiting', 'active', 'completed', 'failed', 'dead'];

function parsePublicJobId(publicJobId) {
    const separatorIndex = publicJobId.indexOf(':');

    if (separatorIndex <= 0 || separatorIndex === publicJobId.length - 1) {
        return null;
    }

    return {
        type: publicJobId.slice(0, separatorIndex),
        bullMqJobId: publicJobId.slice(separatorIndex + 1),
    };
}

function parsePositiveInteger(value, defaultValue) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        return defaultValue;
    }

    return parsedValue;
}

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

        const job_Id = `${job.name}:${job.id}`;

        await Job.create({
            jobId: job_Id,
            type,
            status: 'waiting',
            priority: jobPriority,
            data,
        });

        logger.info('Job submitted', {
            jobId: job_Id,
            bullMqJobId: job.id,
            type,
            priority: jobPriority,
            delay: jobDelay,
        });

        return res.status(202).json({
            success: true,
            jobId: job_Id,
            type,
            status: 'waiting',
            priority: jobPriority,
        });
    } catch (err) {
        logger.error('Error creating job', {
            error: err,
            type,
            priority: jobPriority,
            delay: jobDelay,
        });

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

async function listJobs(req, res) {
    const { status, type } = req.query;
    const filter = {};

    if (status) {
        if (!VALID_JOB_STATUSES.includes(status)) {
            return res.status(400).send(`Invalid status filter: ${status}`);
        }

        filter.status = status;
    }

    if (type) {
        if (!VALID_JOB_TYPES.includes(type)) {
            return res.status(400).send(`Invalid type filter: ${type}`);
        }

        filter.type = type;
    }

    const page = parsePositiveInteger(req.query.page, 1);
    const requestedLimit = parsePositiveInteger(req.query.limit, 20);
    const limit = Math.min(requestedLimit, 100);
    const skip = (page - 1) * limit; 
    

    try {
        const [jobs, total] = await Promise.all([
            Job.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Job.countDocuments(filter),
        ]);

        const totalPages = Math.max(Math.ceil(total / limit), 1);

        return res.render('jobs/index', {
            jobs,
            filters: { status, type },
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasPrevPage: page > 1,
                hasNextPage: page < totalPages,
            },
            validJobTypes: VALID_JOB_TYPES,
            validJobStatuses: VALID_JOB_STATUSES,
        });
    } catch (err) {
        logger.error('Error listing jobs', {
            error: err,
            filter,
            page,
            limit,
        });

        return res.status(500).send('Error listing jobs');
    }
}

async function getJob(req, res) {
    const { id } = req.params;
    const parsedJobId = parsePublicJobId(id);

    if (!parsedJobId) {
        return res.status(400).json({
            success: false,
            message: "Job id must be in 'jobtype:id' format",
        });
    }

    const { type, bullMqJobId } = parsedJobId;

    try {
        const queue = getQueueByType(type);
        const [jobLog, queueJob] = await Promise.all([
            Job.findOne({ jobId: id }).lean(),
            queue.getJob(bullMqJobId),
        ]);

        if (!jobLog && !queueJob) {
            return res.status(404).json({
                success: false,
                message: 'Job not found',
            });
        }

        const queueState = queueJob ? await queueJob.getState() : null;
        const attemptsMade = queueJob?.attemptsMade ?? jobLog?.attempts ?? 0;

        return res.status(200).json({
            success: true,
            job: {
                jobId: id,
                bullMqJobId,
                type,
                status: queueState ?? jobLog.status,
                persistedStatus: jobLog?.status ?? null,
                queueStatus: queueState,
                priority: jobLog?.priority ?? queueJob?.opts?.priority ?? 5,
                attempts: attemptsMade,
                progress: queueJob?.progress ?? null,
                data: jobLog?.data ?? queueJob?.data ?? null,
                result: jobLog?.result ?? queueJob?.returnvalue ?? null,
                error: jobLog?.error ?? queueJob?.failedReason ?? null,
                createdAt: jobLog?.createdAt ?? (queueJob?.timestamp ? new Date(queueJob.timestamp) : null),
                startedAt: jobLog?.startedAt ?? (queueJob?.processedOn ? new Date(queueJob.processedOn) : null),
                completedAt: jobLog?.completedAt ?? (queueJob?.finishedOn ? new Date(queueJob.finishedOn) : null),
            },
        });
    } catch (err) {
        logger.error('Error fetching job', {
            error: err,
            jobId: id,
        });

        if (err.code === 'UNKNOWN_JOB_TYPE') {
            return res.status(400).json({
                success: false,
                message: err.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error fetching job',
        });
    }
}

module.exports = {
    createJob,
    listJobs,
    getJob,
};
