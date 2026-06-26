// src/db/models/JobLog.model.js
const mongoose = require('mongoose');

const jobLogSchema = new mongoose.Schema({
  jobId:       { type: String, required: true, unique: true },
  type:        { type: String, enum: ['email', 'image', 'report'], required: true },
  status:      { type: String, enum: ['waiting', 'active', 'completed', 'failed', 'dead'], default: 'waiting' },
  priority:    { type: Number, default: 5 },
  attempts:    { type: Number, default: 0 },
  data:        { type: mongoose.Schema.Types.Mixed, required: true },  // any payload shape
  result:      { type: mongoose.Schema.Types.Mixed, default: null },   // any result shape
  error:       { type: String, default: null },
  createdAt:   { type: Date, default: Date.now },
  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
});

module.exports = mongoose.model('JobLog', jobLogSchema);