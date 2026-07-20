const { createJob, listJobs, getJob } = require('../controllers/Job.controller');
const express = require('express');
const router = express.Router();

router.post('/jobs', createJob);

router.get('/jobs', listJobs);

router.get('/jobs/:id', getJob);

module.exports = router;
