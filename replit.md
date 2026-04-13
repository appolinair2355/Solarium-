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

## Admin Panel Tab Structure

5 tabs, each with a clear domain:
- **👥 Utilisateurs** — user management, premium generation, approvals
- **⚙️ Créer Stratégie** — strategy list, "Séquences de Relance" card, creation/edit form
- **📊 Bilan** — per-strategy win/loss statistics grid (C1, C2, C3, DC + custom)
- **✈️ Telegram** — ALL Telegram configuration: global bot token, message format previews, canaux par défaut (C1-C4 with token+format+channelId), stratégies personnalisées, canaux globaux, announcements
- **🔀 Routage** — ONLY routing: which global channels receive C1/C2/C3/DC predictions

## Key Features

- **Mirror pairs** (Miroir Taux mode): UI selector with 6 pair toggle buttons, per-pair threshold B, purple bars on Dashboard
- **Per-pair threshold B**: `mirror_pairs` format `[{a, b, threshold}]`; null = use global B
- **Clone strategy**: 📋 Dupliquer button pre-fills form with "Copie de [name]"
- **Séquences de Relance** (in Créer Stratégie tab): loss-based relay sequences per strategy or per-strategy form
- **Per-strategy relance form fields**: `relance_enabled`, `relance_pertes` (1-20), `relance_types` (1-20 multi-select), `relance_nombre`
- **Announcements**: scheduled Telegram messages (interval or fixed times) in Telegram tab
- **Bilan per strategy**: fetches `/api/predictions/stats` and displays wins/losses/win% per channel and custom strategy
- **Auto-clear blocked predictions (22 min)**: engine runs `_clearExpiredByTime()` every 2 min; predictions `en_cours` older than 22 min are set to status `expire` in DB and removed from in-memory pending cache
- **External Render DB sync** (`render-sync.js`): all resolved predictions synced to an external PostgreSQL URL (stored in settings key `render_db_url`); admin UI in Routage tab (🔀) with connect/disconnect/stats/reset actions
- **Auto-reset on game #1**: when engine detects game_number === 1 for the first time in a session, it calls `renderSync.handleGameOne()` which deletes all rows in `predictions_export` table on Render DB

## Deployment Package

`baccarat-pro-deploy.zip` contains all production files (dist/, backend .js files, package.json, data/) excluding node_modules, src/, .git, .local.
