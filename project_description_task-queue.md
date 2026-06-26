# Distributed Task Queue System — Project Specification

---

## 1. Project Overview

### 1.1 Problem Statement

Modern web applications frequently need to perform time-consuming operations such as sending emails, processing images, generating reports, or calling third-party APIs. Executing these operations synchronously within an HTTP request cycle causes three critical problems:

- **Slow response times** — users wait for heavy operations to complete before receiving a response
- **Fragile reliability** — if the server crashes mid-operation, the task is silently lost with no retry mechanism
- **Poor scalability** — a spike in requests doing heavy work blocks server threads and causes cascading failures

### 1.2 Solution

This project is a **general-purpose background job processing system** — a backend service that accepts task submissions from any client application, queues them reliably, processes them asynchronously through dedicated worker processes, and reports real-time status back to the client.

Any application integrating with this system can offload heavy work instantly. The client receives an immediate acknowledgment with a job ID. A separate worker process handles the actual execution. The client tracks progress and receives completion notification in real-time via WebSocket.

### 1.3 System in One Line

> A client submits a job via REST API → the job is queued in Redis via BullMQ → a worker processes it in the background → the result is stored in MongoDB → the client receives real-time updates via Socket.io.

---

## 2. Core Concepts

### 2.1 What Is a Job

A **job** is a discrete unit of background work. It has:

- A **type** — what kind of work it represents (email, image, report)
- A **payload** — the data the worker needs to do the work
- A **state** — where it currently is in its lifecycle
- A **result** — what the worker returned after completion

### 2.2 Job Lifecycle

Every job passes through the following states:

```
          ┌─────────┐
  submit  │ waiting │  job is in the queue, not yet picked up
─────────►│         │
          └────┬────┘
               │ worker picks up
               ▼
          ┌─────────┐
          │ active  │  worker is currently processing it
          └────┬────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
  ┌──────────┐   ┌────────┐
  │completed │   │ failed │  worker threw an error
  └──────────┘   └────┬───┘
                      │ if attempts < maxAttempts
                      ▼
                 ┌─────────┐
                 │ waiting │  re-queued for retry (exponential backoff)
                 └─────────┘
                      │ if attempts == maxAttempts
                      ▼
                 ┌─────────┐
                 │  dead   │  moved to dead-letter queue, no more retries
                 └─────────┘
```

Additionally, jobs can be in:
- **delayed** — submitted with a future execution time, not yet eligible for pickup
- **prioritized** — waiting but ranked above other waiting jobs by priority score

### 2.3 Why Redis as the Queue Backend

Redis provides two data structures that map perfectly to queue semantics:

- **Sorted Sets** — BullMQ stores waiting jobs in a sorted set keyed by priority + timestamp. Workers call `ZPOPMIN` to atomically pick the highest-priority job. This is O(log N) and safe under concurrent workers.
- **Hashes** — each job's data, state, attempts, and result are stored as a Redis hash, keyed by job ID.

This means the queue itself lives entirely in Redis. MongoDB is used only for persistent logs — Redis is the source of truth for live job state.

### 2.4 Two Separate Processes

The system runs as **two independent Node.js processes**:

- **API Server** (`server.js`) — receives HTTP requests, validates input, pushes jobs to Redis, returns job ID. Does zero heavy work.
- **Worker Process** (`workers/index.js`) — polls Redis for jobs, executes them, writes results to MongoDB, emits Socket.io events.

These two processes are intentionally separate so they can be scaled independently. Under high job volume, you run more worker containers without touching the API layer.

---

## 3. Supported Job Types

The system ships with three concrete job type implementations. These serve as both functional features and demonstrations of the engine's capability.

### 3.1 Email Job

Sends a transactional email to a recipient.

**Payload:**
```json
{
  "type": "email",
  "data": {
    "to": "user@example.com",
    "subject": "Your report is ready",
    "body": "Please find your report attached."
  }
}
```

**Worker behavior:** Connects to SMTP via Nodemailer, sends the email, returns a message ID as the result.

**Retry logic:** Retries up to 3 times with exponential backoff (1s, 2s, 4s). SMTP errors are transient and typically resolve on retry.

---

### 3.2 Image Processing Job

Resizes an image from a source URL into one or more target dimensions.

**Payload:**
```json
{
  "type": "image",
  "data": {
    "imageUrl": "https://storage.example.com/uploads/photo.jpg",
    "resizeTo": [300, 600, 1200],
    "outputFormat": "webp"
  }
}
```

**Worker behavior:** Downloads the image, uses Sharp to resize into each target dimension, uploads processed variants back to storage, returns output URLs as the result.

**Retry logic:** Retries up to 2 times. Download failures are retried; corrupted input files are moved to dead-letter immediately.

---

### 3.3 Report Generation Job

Generates a PDF report for a given user based on their data.

**Payload:**
```json
{
  "type": "report",
  "data": {
    "userId": "usr_abc123",
    "reportType": "monthly-summary",
    "month": "2024-01"
  }
}
```

**Worker behavior:** Queries MongoDB for user data, compiles the report, generates a PDF, stores it, and optionally emails it to the user. Returns the PDF storage URL as the result.

**Retry logic:** Retries up to 3 times. DB query errors are retried; invalid user IDs fail immediately without retry.

---

## 4. Architecture

### 4.1 High-Level Architecture

```
                        ┌─────────────────────────────────────┐
                        │           Client Application         │
                        │  (Postman / Web App / Another API)   │
                        └──────────────┬──────────────────────┘
                                       │ HTTP Request
                                       ▼
                        ┌─────────────────────────────────────┐
                        │              Nginx                   │
                        │   Reverse Proxy + Rate Limiting      │
                        └──────────────┬──────────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────────────┐
                        │           API Server                 │
                        │        (Express + Node.js)           │
                        │                                      │
                        │  Routes → Controllers → Queue Push   │
                        └──────┬──────────────┬───────────────┘
                               │              │
                    push job   │              │  Socket.io
                               ▼              ▼
                        ┌────────────┐  ┌──────────────┐
                        │   Redis    │  │  Socket.io   │
                        │  (BullMQ  │  │    Server    │
                        │   Queue)  │  └──────┬───────┘
                        └─────┬──────┘         │ real-time events
                              │                │
                    pick job  │                ▼
                              ▼         ┌──────────────┐
                        ┌────────────┐  │    Client    │
                        │   Worker   │  │  Dashboard   │
                        │  Process   │  └──────────────┘
                        │            │
                        │ email      │
                        │ image      │
                        │ report     │
                        └─────┬──────┘
                              │ persist result
                              ▼
                        ┌────────────┐
                        │  MongoDB   │
                        │ (JobLogs)  │
                        └────────────┘
```

### 4.2 Queue Architecture

Each job type has its own dedicated BullMQ queue. This provides isolation — a spike in image jobs does not delay email delivery.

```
Redis
├── bull:email:wait          (sorted set — waiting email jobs)
├── bull:email:active        (set — currently processing)
├── bull:email:completed     (sorted set — done)
├── bull:email:failed        (sorted set — failed, retryable)
├── bull:email:delayed       (sorted set — scheduled for future)
├── bull:image:wait
├── bull:image:active
│   ...
└── bull:report:wait
    ...
```

Each queue has its own worker with independently configured concurrency:

```
emailQueue  → emailWorker  (concurrency: 5)
imageQueue  → imageWorker  (concurrency: 2,  CPU-heavy)
reportQueue → reportWorker (concurrency: 3)
```

### 4.3 Rate Limiting Architecture

Rate limiting is enforced at two levels:

**Level 1 — Nginx (IP-based):**
Limits total requests per IP address. Protects against raw HTTP floods before they reach Node.js.

**Level 2 — Redis Token Bucket (API-key-based):**
Each API key is allotted N job submissions per minute. Implemented using Redis `INCR` + `PEXPIRE` — a lightweight sliding window counter. Returns `HTTP 429` with `Retry-After` header when exceeded.

---

## 5. Project Structure

```
task-queue-system/
│
├── server.js                          # API server entry point
│
├── workers/
│   └── index.js                       # Worker process entry point
│
├── src/
│   ├── app.js                         # Express app, middleware chain, route mounting
│   │
│   ├── config/
│   │   ├── redis.js                   # IORedis connection instance (shared)
│   │   └── env.js                     # Validates all required env vars on startup
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   └── jobs.routes.js         # Route definitions for /api/jobs
│   │   ├── controllers/
│   │   │   └── jobs.controller.js     # submitJob, getJob, listJobs handlers
│   │   └── middleware/
│   │       ├── auth.middleware.js     # Validates x-api-key header
│   │       └── rateLimit.middleware.js # Redis token bucket per API key
│   │
│   ├── queue/
│   │   ├── queues/
│   │   │   ├── emailQueue.js          # BullMQ Queue instance for email jobs
│   │   │   ├── imageQueue.js          # BullMQ Queue instance for image jobs
│   │   │   └── reportQueue.js         # BullMQ Queue instance for report jobs
│   │   ├── workers/
│   │   │   ├── emailWorker.js         # Processes email jobs
│   │   │   ├── imageWorker.js         # Processes image jobs
│   │   │   └── reportWorker.js        # Processes report jobs
│   │   └── events/
│   │       └── queueEvents.js         # BullMQ QueueEvents → Socket.io bridge
│   │
│   ├── db/
│   │   ├── connection.js              # Mongoose connect + disconnect
│   │   └── models/
│   │       └── JobLog.model.js        # Mongoose schema for persisted job records
│   │
│   ├── socket/
│   │   └── socket.js                  # Socket.io server init + room management
│   │
│   └── utils/
│       └── logger.js                  # Winston logger (JSON format, log levels)
│
├── nginx/
│   └── nginx.conf                     # Reverse proxy + rate limit + WS upgrade
│
├── Dockerfile                         # Node.js app container definition
├── docker-compose.yml                 # Orchestrates api + worker + redis + mongo + nginx
├── .env.example                       # Required environment variable template
├── .env                               # Actual values (gitignored)
└── package.json
```

---

## 6. Data Models

### 6.1 JobLog (MongoDB)

Persists a record for every job submitted. Updated as the job progresses.

```
Field          Type       Description
─────────────────────────────────────────────────────────────────
jobId          String     BullMQ job ID (primary lookup key)
type           String     "email" | "image" | "report"
status         String     "waiting" | "active" | "completed" | "failed" | "dead"
priority       Number     1 (highest) to 10 (lowest), default 5
attempts       Number     How many times the worker has tried this job
data           Mixed      Original job payload submitted by client
result         Mixed      Value returned by worker on success
error          String     Error message if job failed
createdAt      Date       When the job was submitted
startedAt      Date       When the worker first picked it up
completedAt    Date       When the job reached a terminal state
```

### 6.2 Job Payload (Redis — managed by BullMQ)

BullMQ stores each job in Redis as a hash. You do not manage this directly. Key fields BullMQ tracks internally:

```
Field          Description
──────────────────────────────────────────────────────
id             Unique job ID (auto-incremented)
name           Job type string
data           JSON payload
opts           Job options (attempts, backoff, delay, priority)
returnvalue    What the worker processor function returned
failedReason   Error message if job failed
attemptsMade   Current attempt count
timestamp      When the job was created (Unix ms)
processedOn    When a worker started processing it
finishedOn     When it completed or exhausted retries
```

---

## 7. API Specification

### 7.1 Authentication

All endpoints require the following header:

```
x-api-key: <your-api-key>
```

Missing or invalid keys return `HTTP 401`.

### 7.2 Rate Limits

```
20 job submissions per API key per minute
HTTP 429 returned when exceeded, with Retry-After header
```

### 7.3 Endpoints

---

#### POST /api/jobs
Submit a new background job.

**Request Headers:**
```
Content-Type: application/json
x-api-key: your-api-key
```

**Request Body:**
```json
{
  "type": "email",
  "priority": 1,
  "delay": 0,
  "data": {
    "to": "user@example.com",
    "subject": "Hello",
    "body": "Message body here"
  }
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| type     | string | yes      | `email`, `image`, or `report` |
| data     | object | yes      | Job-type-specific payload |
| priority | number | no       | 1 (highest) to 10 (lowest). Default: 5 |
| delay    | number | no       | Milliseconds to wait before processing. Default: 0 |

**Success Response — 202 Accepted:**
```json
{
  "success": true,
  "jobId": "42",
  "type": "email",
  "status": "waiting",
  "priority": 1
}
```

**Error Responses:**
```
400 Bad Request    — missing required fields or unknown job type
401 Unauthorized   — missing or invalid API key
429 Too Many Requests — rate limit exceeded
```

---

#### GET /api/jobs/:id
Retrieve current status and result of a specific job.

**Request Headers:**
```
x-api-key: your-api-key
```

**Success Response — 200 OK:**
```json
{
  "jobId": "42",
  "type": "email",
  "status": "completed",
  "priority": 1,
  "attempts": 1,
  "data": {
    "to": "user@example.com",
    "subject": "Hello",
    "body": "Message body here"
  },
  "result": {
    "messageId": "msg_abc123",
    "delivered": true
  },
  "error": null,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "startedAt": "2024-01-15T10:30:00.521Z",
  "completedAt": "2024-01-15T10:30:02.814Z"
}
```

**Error Responses:**
```
401 Unauthorized   — missing or invalid API key
404 Not Found      — no job with this ID exists
```

---

#### GET /api/jobs
List jobs with optional filters. Paginated.

**Query Parameters:**

| Parameter | Type   | Description |
|-----------|--------|-------------|
| status    | string | Filter by status: `waiting`, `active`, `completed`, `failed`, `dead` |
| type      | string | Filter by job type: `email`, `image`, `report` |
| page      | number | Page number. Default: 1 |
| limit     | number | Results per page. Default: 20, max: 100 |

**Example Request:**
```
GET /api/jobs?status=failed&type=email&page=1&limit=20
x-api-key: your-api-key
```

**Success Response — 200 OK:**
```json
{
  "jobs": [
    {
      "jobId": "38",
      "type": "email",
      "status": "failed",
      "attempts": 3,
      "error": "Connection refused by SMTP server",
      "createdAt": "2024-01-15T09:15:00.000Z"
    }
  ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "pages": 1
  }
}
```

---

#### GET /dashboard
Bull Board queue monitoring UI. Shows all queues, their sizes, job details, and allows manual retry of failed jobs.

```
http://localhost:3000/dashboard
```

No API key required in development. Protected by HTTP Basic Auth in production via `DASHBOARD_USER` and `DASHBOARD_PASS` environment variables.

---

### 7.4 WebSocket Events (Socket.io)

Clients can subscribe to real-time updates for a specific job by joining its room after connecting:

```javascript
// Client-side
const socket = io('http://localhost:3000');

// Subscribe to a specific job's events
socket.emit('subscribe', { jobId: '42' });

// Listen for updates
socket.on('job:active',    ({ jobId }) => { /* worker started */ });
socket.on('job:progress',  ({ jobId, progress }) => { /* 0-100 */ });
socket.on('job:completed', ({ jobId, result }) => { /* done */ });
socket.on('job:failed',    ({ jobId, reason }) => { /* error */ });
```

**Server-side room logic:** When a client subscribes, the server puts that socket in a room named `job:<jobId>`. BullMQ QueueEvents fire on job state changes and the server emits to that room.

---

## 8. Queue Configuration

### 8.1 Default Job Options

Applied to all jobs unless overridden per submission:

```
attempts:  3
backoff:   exponential, starting at 1000ms
           (retries at 1s, 2s, 4s intervals)
removeOnComplete: false  (keep in Redis for inspection)
removeOnFail:     false  (keep failed jobs, required for dead-letter)
```

### 8.2 Priority Levels

```
Priority 1  —  Critical   (process before all others)
Priority 3  —  High
Priority 5  —  Normal     (default)
Priority 7  —  Low
Priority 10 —  Background (process only when queue is otherwise idle)
```

### 8.3 Dead-Letter Queue

Jobs that exhaust all retry attempts are moved to a dedicated dead-letter queue (`bull:email:failed` with no further retry scheduled). The Bull Board dashboard exposes these for manual inspection and one-click retry.

### 8.4 Repeatable Jobs

The system supports cron-style recurring jobs registered at worker startup. Example:

```
Every day at 2:00 AM  →  generate daily summary reports for all users
Every hour            →  retry any jobs stuck in active state > 30 minutes
```

---

## 9. Infrastructure

### 9.1 Services

The full system runs as five Docker containers orchestrated by Docker Compose:

| Service | Image | Port | Role |
|---------|-------|------|------|
| api | custom (Dockerfile) | 3000 | Express API server + Socket.io |
| worker | custom (Dockerfile) | — | BullMQ worker process |
| redis | redis:7-alpine | 6379 | Queue storage + rate limit counters |
| mongo | mongo:7 | 27017 | Job log persistence |
| nginx | nginx:alpine | 80 | Reverse proxy, rate limiting, WS upgrade |

### 9.2 Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

The worker container uses the same image with a different CMD:
```yaml
command: node workers/index.js
```

### 9.3 Docker Compose

```yaml
version: '3.9'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - redis
      - mongo
    restart: unless-stopped

  worker:
    build: .
    command: node workers/index.js
    env_file: .env
    depends_on:
      - redis
      - mongo
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api
    restart: unless-stopped

volumes:
  redis_data:
  mongo_data:
```

### 9.4 Nginx Configuration

```nginx
events {}

http {
  limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;

  upstream api {
    server api:3000;
  }

  server {
    listen 80;

    location /api/ {
      limit_req zone=api_limit burst=20 nodelay;
      proxy_pass http://api;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }

    location /dashboard/ {
      proxy_pass http://api;
    }

    location /socket.io/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
  }
}
```

---

## 10. Environment Variables

All required variables must be present at startup. The application exits with a clear error message if any are missing.

```bash
# Application
NODE_ENV=development          # development | production
PORT=3000                     # API server port

# Redis
REDIS_URL=redis://localhost:6379

# MongoDB
MONGODB_URI=mongodb://localhost:27017/taskqueue

# Authentication
API_KEY=your-secret-api-key   # Single key for now; extend to multi-key later

# Bull Board Dashboard
DASHBOARD_USER=admin
DASHBOARD_PASS=secret

# Email (for email job type)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000    # 1 minute window
RATE_LIMIT_MAX_JOBS=20        # Max job submissions per API key per window
```

---

## 11. Error Handling

### 11.1 API Error Format

All error responses follow a consistent structure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Field 'type' is required",
    "details": {}
  }
}
```

### 11.2 Error Codes

```
UNAUTHORIZED        — Missing or invalid API key
RATE_LIMIT_EXCEEDED — Too many requests
VALIDATION_ERROR    — Missing or invalid request fields
NOT_FOUND           — Job ID does not exist
UNKNOWN_JOB_TYPE    — Submitted type is not registered
INTERNAL_ERROR      — Unexpected server error
```

### 11.3 Worker Error Handling

- **Transient errors** (network timeouts, SMTP unavailable) — retried with exponential backoff
- **Permanent errors** (invalid email address, corrupt image file) — job fails immediately, skips remaining retries, goes to dead-letter
- **Worker crashes** — BullMQ automatically reclaims jobs stuck in `active` state after a stall timeout and re-queues them

---

## 12. Logging

Winston is used for structured JSON logging across both the API server and worker process.

**Log levels used:**

```
error   — unrecoverable failures, always logged
warn    — retryable failures, rate limit hits
info    — job submitted, job completed, server started
debug   — job picked up by worker, progress updates (dev only)
```

**Log format (production):**
```json
{
  "level": "info",
  "message": "Job completed",
  "jobId": "42",
  "type": "email",
  "duration": 2293,
  "timestamp": "2024-01-15T10:30:02.814Z"
}
```

---

## 15. Tech Stack Reference

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x LTS | Runtime for both API server and worker process |
| Express | 4.x | HTTP server, routing, middleware |
| BullMQ | 5.x | Queue management, worker lifecycle, job options |
| IORedis | 5.x | Redis client (required by BullMQ specifically) |
| Redis | 7.x | Queue backend, rate limit counters |
| Mongoose | 8.x | MongoDB ODM for job log persistence |
| MongoDB | 7.x | Persistent storage for job records |
| Socket.io | 4.x | Real-time bidirectional job status updates |
| Winston | 3.x | Structured JSON logging |
| @bull-board/express | 5.x | Pre-built queue monitoring dashboard |
| Docker | 24.x | Containerization of all services |
| Docker Compose | 2.x | Local multi-service orchestration |
| Nginx | 1.25.x | Reverse proxy, rate limiting, WebSocket proxying |

---

*Specification version: 1.0*
*Project: Distributed Task Queue System*