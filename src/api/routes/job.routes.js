const { createJob } = require('../controllers/Job.controller');
const express = require('express');
const router = express.Router();

router.post('/jobs', createJob);

module.exports = router;
