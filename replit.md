# Baccarat Pro

A real-time Baccarat prediction system for 1xBet. It includes a prediction engine, user management with admin approval, Telegram integration, and a React frontend.

## Architecture

- **Backend**: Node.js + Express 5, running on port 5000
- **Frontend**: React 18 + Vite, pre-built into `dist/` and served by Express
- **Database**: PostgreSQL (via `DATABASE_URL` env var) or local JSON fallback (`jsondb.js`)
- **Sessions**: PostgreSQL session store (or in-memory via `memorystore` in JSON mode)
- **Telegram**: Optional bot integration for sending predictions to channels

## Project Structure

- `index.js` — Express server entry point (serves API + static frontend)
- `engine.js` — Baccarat prediction engine (runs continuously)
- `db.js` — Data access layer (PostgreSQL or JSON)
- `jsondb.js` — Local JSON database implementation
- `auth.js`, `admin.js`, `predictions.js`, `games.js` — API route handlers
- `telegram-route.js`, `telegram-service.js` — Telegram bot integration
- `bilan.js` — Daily stats/reporting
- `src/` — React frontend source
- `dist/` — Pre-built frontend (served by Express)
- `vite.config.js` — Vite config (dev server on port 5173, proxy to backend on 5000)

## Running the App

The app runs as a single process (`node index.js`) on port 5000.

In development, the Vite dev server can also be started (`npm run dev`) on port 5173 with API proxying.

## Environment Variables

See `.env.example` for all available options:
- `PORT` — Server port (default: 5000)
- `NODE_ENV` — Environment (`development`/`production`)
- `SESSION_SECRET` — Session signing secret
- `DATABASE_URL` — PostgreSQL connection string (optional; uses JSON local DB if absent)
- `BOT_TOKEN` — Telegram bot token (optional)

## Default Admin Account

- Username: `buzzinfluence`
- Password: `arrow2025`

## Deployment

Configured as a VM deployment (always-running) to support the persistent prediction engine and Telegram bot.
