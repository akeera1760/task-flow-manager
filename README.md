# TaskFlow — Task Management (MERN)

This repository contains a small MERN-stack task management application:

- `server/` — Express API with Mongoose models, JWT authentication, password-reset email support and a simple WebSocket notifier.
- `client/` — React single-page UI (Vite) that talks to the API and provides task CRUD, filters, and a responsive layout.

This README explains how to run the app locally, which environment variables are required, and where the main code lives.

## Prerequisites

- Node.js (v18+ recommended) and npm
- MongoDB (local or remote) accessible from `server`
- Optional: SMTP credentials for password reset emails (or you can use the development fallback)

## Project layout

- `server/` — backend source under `server/src` (entry: `server/src/index.js`)
- `client/` — frontend source under `client/src` (entry: `client/src/main.jsx`)

## Environment variables

Create a `.env` file in `server/` (you can copy from `.env.example` if present). The server reads these variables:

- `PORT` — (optional) port to run the API (defaults to `5000`)
- `MONGO_URI` — MongoDB connection string (required)
- `JWT_SECRET` — secret used to sign JWT tokens (required for auth)
- `APP_URL` — URL to the client app (used in reset emails), e.g. `http://localhost:3000`
- `SMTP_URL` or (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) — SMTP settings to send email; if not provided the server will generate a reset token but may return it in the API response for development/testing
- `SMTP_FROM` — optional from address for outgoing mail

Example (server/.env):

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/taskflow
JWT_SECRET=change_this_secret
APP_URL=http://localhost:3000
SMTP_USER=youremail@example.com
SMTP_PASS=yourpassword
SMTP_FROM=TaskFlow <no-reply@example.com>
```

On the client side the base API URL is read from the environment at build/dev time. In `client/` create a `.env` (or edit `client/.env`) with:

```
VITE_API_BASE=http://localhost:5000/api
```

Vite will use port 3000 by default. If that port is busy Vite will automatically pick another port (e.g. 3001, 3002).

## Install & run (local development)

1) Install server dependencies and start backend (dev or production mode):

```bash
cd server
npm install
# dev (auto-restart on file changes)
npm run dev
# or start (production)
npm start
```

The server will log the listening URL (by default http://localhost:5000). If you get `EADDRINUSE` the port is already in use — either stop the other process or set `PORT` to a free port.

2) Install client dependencies and start frontend:

```bash
cd client
npm install
npm run dev
```

Vite will print the local URL (usually `http://localhost:3000`, or another free port if 3000 is occupied).

Open the client URL in your browser. The client expects the API at the URL in `VITE_API_BASE`.

## Build for production

Build the client so it can be hosted by any static server (or integrated into a deploy pipeline):

```bash
cd client
npm run build
# then serve the `dist/` folder with your static host of choice
```

## Basic app functionality

- User registration and login (JWT-based)
- Protected task CRUD: create, update, delete tasks tied to the authenticated user
- Task filters (priority/status), search, and sorting
- Password reset flow: `/api/auth/forgot-password` generates a reset token and attempts to email it using configured SMTP; `/api/auth/reset-password` accepts token + new password
- Realtime notifications: a lightweight WebSocket server notifies connected clients when their tasks change

## Important API endpoints (server)

- `POST /api/auth/register` — register a new user
- `POST /api/auth/login` — authenticate and receive a JWT
- `POST /api/auth/forgot-password` — request reset token (email)
- `POST /api/auth/reset-password` — submit token + new password
- `GET /api/tasks` — list tasks (requires Authorization: Bearer <token>)
- `POST /api/tasks` — create task (auth)
- `PUT /api/tasks/:id` — update task (auth)
- `DELETE /api/tasks/:id` — delete task (auth)
- `GET /api/health` — health check

## Troubleshooting

- If the server reports `EADDRINUSE`, another process is using the configured port. Either stop that process or set `PORT` to a free port in `server/.env` before starting.
- If you don't receive password reset emails in development, check `server/.env` SMTP settings; the server has a development fallback that returns the token in the API response for local testing.
- Make sure `MONGO_URI` points to a running MongoDB instance and that the server can reach it.

## Notes

- This README is limited to local development steps. For production deployment you'll want to secure `JWT_SECRET`, configure a reliable SMTP provider, and set up HTTPS and DNS for `APP_URL`.

If you want, I can also add a `Makefile` or simple npm scripts at the repo root to start both server and client concurrently for convenience.

