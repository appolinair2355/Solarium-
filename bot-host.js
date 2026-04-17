/**
 * bot-host.js — Hébergement de bots Telegram
 * Détection automatique du fichier principal dans le ZIP.
 * Supporte Python et Node.js avec redémarrage automatique.
 */
'use strict';

const { spawn }  = require('child_process');
const fs          = require('fs');
const path        = require('path');
const JSZip       = require('jszip');
const fetch       = require('node-fetch');
const db          = require('./db');

const BOTS_DIR = path.join(__dirname, 'bot_instances');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });

// ── Etat en mémoire ──────────────────────────────────────────────────────────
const running = {};

// ── Init table DB ────────────────────────────────────────────────────────────
async function initDB() {
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS hosted_bots (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      language    TEXT    DEFAULT 'python',
      token       TEXT    NOT NULL,
      channel_id  TEXT    DEFAULT '',
      main_file   TEXT    DEFAULT 'main.py',
      work_dir    TEXT    DEFAULT '',
      detected_files TEXT DEFAULT '',
      status      TEXT    DEFAULT 'stopped',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Ajouter work_dir si la table existe déjà sans cette colonne
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS work_dir TEXT DEFAULT ''`).catch(() => {});
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS detected_files TEXT DEFAULT ''`).catch(() => {});
}

// ── Lister tous les bots ─────────────────────────────────────────────────────
async function getAll() {
  const r = await db.pool.query('SELECT * FROM hosted_bots ORDER BY id');
  return r.rows.map(b => ({
    ...b,
    running:    !!running[b.id],
    restarts:   running[b.id]?.restarts  || 0,
    recentLogs: (running[b.id]?.logs || []).slice(-30),
  }));
}

// ── Valider un token Telegram ─────────────────────────────────────────────────
async function validateToken(token) {
  try {
    const r    = await fetch(`https://api.telegram.org/bot${token}/getMe`, { timeout: 6000 });
    const data = await r.json();
    return data.ok ? { ok: true, bot: data.result } : { ok: false, error: data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Envoyer un message Telegram ───────────────────────────────────────────────
async function sendMessage(token, chatId, text) {
  if (!chatId || !token) return { ok: false, error: 'token ou channel_id manquant' };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      timeout: 8000,
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error(`[BotHost] sendMessage Telegram error: ${data.description} (chat_id=${chatId})`);
      // Retry sans parse_mode si erreur de formatting
      if (data.description && data.description.includes("can't parse")) {
        const r2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          timeout: 8000,
        });
        const d2 = await r2.json();
        return d2.ok ? { ok: true } : { ok: false, error: d2.description };
      }
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (e) {
    console.error('[BotHost] sendMessage error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Extraire un ZIP (base64) dans bot_instances/<botId>/ ─────────────────────
async function extractZip(botId, base64) {
  const dir = path.join(BOTS_DIR, String(botId));
  // Nettoyer le dossier si re-déploiement
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });

  const buffer = Buffer.from(base64, 'base64');
  const zip    = await JSZip.loadAsync(buffer);
  const files  = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const content = await file.async('nodebuffer');
    const dest    = path.join(dir, filename);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    files.push(filename);
  }

  console.log(`[BotHost] ZIP extrait → ${dir} (${files.length} fichiers)`);
  return files;
}

// ── Détecter automatiquement le fichier principal ────────────────────────────
// Retourne { mainFile, workDir, relPath } ou null
function detectMainFile(botDir, language) {
  const PRIORITY = language === 'node'
    ? ['index.js', 'app.js', 'bot.js', 'main.js', 'server.js', 'start.js']
    : ['main.py', 'bot.py', 'app.py', 'run.py', 'start.py', 'bot_telegram.py',
       'telegram_bot.py', 'index.py', 'handler.py'];

  const ext = language === 'node' ? '.js' : '.py';

  // Collecter tous les scripts du bon type
  const scripts = [];
  function scan(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full    = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      const stat    = fs.statSync(full);
      if (stat.isDirectory()) {
        scan(full, relPath);
      } else if (entry.endsWith(ext)) {
        scripts.push({ name: entry, full, relPath, dir: path.dirname(full) });
      }
    }
  }
  scan(botDir, '');

  if (scripts.length === 0) return null;

  // 1. Chercher dans les noms prioritaires (n'importe quel niveau)
  for (const prio of PRIORITY) {
    const found = scripts.find(s => s.name === prio);
    if (found) return { mainFile: found.name, workDir: found.dir, relPath: found.relPath };
  }

  // 2. Préférer les fichiers à la racine
  const rootScripts = scripts.filter(s => !s.relPath.includes('/'));
  if (rootScripts.length > 0) {
    return { mainFile: rootScripts[0].name, workDir: rootScripts[0].dir, relPath: rootScripts[0].relPath };
  }

  // 3. Premier trouvé à n'importe quel niveau
  return { mainFile: scripts[0].name, workDir: scripts[0].dir, relPath: scripts[0].relPath };
}

// ── Créer un nouveau bot ──────────────────────────────────────────────────────
async function createBot({ name, language, token, channel_id, zip_base64 }) {
  const lang = language || 'python';

  // 1. Valider le token
  const valid = await validateToken(token);
  if (!valid.ok) throw new Error(`Token invalide : ${valid.error}`);

  // 2. Créer en DB (fichier principal sera mis à jour après extraction)
  const r = await db.pool.query(
    `INSERT INTO hosted_bots(name,language,token,channel_id,main_file,work_dir,status)
     VALUES($1,$2,$3,$4,'auto','','stopped') RETURNING *`,
    [name.trim(), lang, token, channel_id || '']
  );
  const bot = r.rows[0];

  // 3. Extraire le ZIP
  let detectedFiles = [];
  if (zip_base64) {
    detectedFiles = await extractZip(bot.id, zip_base64);
  }

  // 4. Détecter le fichier principal automatiquement
  const botDir   = path.join(BOTS_DIR, String(bot.id));
  const detected = detectMainFile(botDir, lang);

  if (!detected) {
    // Aucun script trouvé — mettre quand même un défaut
    const defMain = lang === 'node' ? 'index.js' : 'main.py';
    await db.pool.query(
      `UPDATE hosted_bots SET main_file=$1, work_dir=$2, detected_files=$3, updated_at=NOW() WHERE id=$4`,
      [defMain, botDir, detectedFiles.join('|'), bot.id]
    );
    console.log(`[BotHost] ⚠ Aucun script ${lang} trouvé — défaut: ${defMain}`);
  } else {
    await db.pool.query(
      `UPDATE hosted_bots SET main_file=$1, work_dir=$2, detected_files=$3, updated_at=NOW() WHERE id=$4`,
      [detected.mainFile, detected.workDir, detectedFiles.join('|'), bot.id]
    );
    console.log(`[BotHost] ✅ Fichier principal détecté : ${detected.relPath} (CWD: ${detected.workDir})`);
  }

  // 5. Message de bienvenue
  const botUsername = valid.bot?.username || name;
  let welcomeResult = { ok: false, error: 'channel_id non fourni' };
  if (channel_id) {
    const mainInfo = detected ? `Fichier : ${detected.relPath}` : 'Aucun script détecté';
    welcomeResult = await sendMessage(token, channel_id,
      `✅ Bot ${name} déployé !\n` +
      `🤖 @${botUsername} est prêt.\n` +
      `${mainInfo}\n` +
      `📦 ${detectedFiles.length} fichier(s) chargé(s)\n\n` +
      `Démarrez-le depuis l'interface Admin.`
    );
    if (welcomeResult.ok) {
      console.log(`[BotHost] ✅ Message bienvenue envoyé → ${channel_id}`);
    } else {
      console.warn(`[BotHost] ⚠ Message bienvenue échoué : ${welcomeResult.error}`);
    }
  } else {
    console.log(`[BotHost] ℹ Pas de channel_id — message bienvenue ignoré`);
  }

  console.log(`[BotHost] Bot #${bot.id} "${name}" créé (${lang}) — ${detectedFiles.length} fichiers`);

  // Retourner le bot mis à jour
  const updated = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [bot.id]);
  return { ...updated.rows[0], _welcome: welcomeResult };
}

// ── Mettre à jour le code d'un bot (re-déploiement ZIP) ───────────────────────
async function updateCode(botId, zip_base64) {
  const wasRunning = !!running[botId];
  if (wasRunning) stopBot(botId);

  const rBot = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [botId]);
  if (!rBot.rows.length) throw new Error('Bot introuvable');
  const bot = rBot.rows[0];

  const detectedFiles = await extractZip(botId, zip_base64);
  const botDir = path.join(BOTS_DIR, String(botId));
  const detected = detectMainFile(botDir, bot.language);

  if (detected) {
    await db.pool.query(
      `UPDATE hosted_bots SET main_file=$1, work_dir=$2, detected_files=$3, updated_at=NOW() WHERE id=$4`,
      [detected.mainFile, detected.workDir, detectedFiles.join('|'), botId]
    );
    console.log(`[BotHost] Code mis à jour — fichier principal: ${detected.relPath}`);
  }

  if (wasRunning) await startBot(botId);
  return { ok: true, detected: detected ? detected.relPath : null };
}

// ── Démarrer un bot ───────────────────────────────────────────────────────────
async function startBot(botId) {
  if (running[botId]) return { ok: false, error: 'Déjà en cours d\'exécution' };
  const r = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [botId]);
  if (!r.rows.length) return { ok: false, error: 'Bot introuvable' };
  const bot = r.rows[0];

  // Déterminer le répertoire de travail
  const workDir  = bot.work_dir || path.join(BOTS_DIR, String(botId));
  const mainFile = path.join(workDir, bot.main_file);

  if (!fs.existsSync(workDir)) return { ok: false, error: 'Code source absent — uploadez un ZIP' };
  if (!fs.existsSync(mainFile)) {
    // Re-tenter la détection automatique
    const botDir   = path.join(BOTS_DIR, String(botId));
    const detected = detectMainFile(botDir, bot.language);
    if (!detected) return { ok: false, error: `Fichier principal introuvable : ${bot.main_file}. Re-uploadez le ZIP.` };
    // Mettre à jour en DB et utiliser la nouvelle détection
    await db.pool.query(
      `UPDATE hosted_bots SET main_file=$1, work_dir=$2, updated_at=NOW() WHERE id=$3`,
      [detected.mainFile, detected.workDir, botId]
    );
    _spawnBot({ ...bot, main_file: detected.mainFile, work_dir: detected.workDir }, detected.workDir, path.join(detected.workDir, detected.mainFile));
    return { ok: true, detected: detected.relPath };
  }

  _spawnBot(bot, workDir, mainFile);
  return { ok: true };
}

// ── Lancer le processus ───────────────────────────────────────────────────────
function _spawnBot(bot, workDir, mainFilePath) {
  const botId = bot.id;
  const lang  = bot.language || 'python';
  const cmd   = lang === 'node' ? 'node' : 'python3';

  console.log(`[BotHost] ▶ Bot #${botId} "${bot.name}" → ${cmd} ${mainFilePath} (CWD: ${workDir})`);

  const webPort = 10000 + botId;
  const proc  = spawn(cmd, [mainFilePath], {
    cwd: workDir,
    env: { ...process.env, BOT_TOKEN: bot.token, CHANNEL_ID: bot.channel_id, PORT: String(webPort) },
  });

  const state = {
    proc,
    logs:        running[botId]?.logs || [],
    restarts:    running[botId]?.restarts || 0,
    autoRestart: true,
  };
  running[botId] = state;

  const addLog = (s, data) => {
    const m = data.toString().trim();
    if (!m) return;
    state.logs.push({ t: Date.now(), s, m });
    if (state.logs.length > 300) state.logs.shift();
  };
  proc.stdout.on('data', d => addLog('out', d));
  proc.stderr.on('data', d => {
    addLog('err', d);
  });

  proc.on('close', code => {
    console.log(`[BotHost] ⏹ Bot #${botId} terminé (code=${code})`);
    if (running[botId]?.autoRestart && code !== null) {
      running[botId].restarts++;
      console.log(`[BotHost] 🔄 Redémarrage auto bot #${botId} dans 5s`);
      setTimeout(async () => {
        if (!running[botId]?.autoRestart) return;
        const r2 = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [botId]).catch(() => ({ rows: [] }));
        if (!r2.rows.length) return;
        const bot2     = r2.rows[0];
        const workDir2 = bot2.work_dir || path.join(BOTS_DIR, String(botId));
        const mf2      = path.join(workDir2, bot2.main_file);
        const prev     = running[botId];
        delete running[botId];
        if (prev) running[botId] = { proc: null, logs: prev.logs, restarts: prev.restarts, autoRestart: true };
        _spawnBot(bot2, workDir2, mf2);
      }, 5000);
    } else {
      delete running[botId];
      db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['stopped', botId]).catch(() => {});
    }
  });

  db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['running', botId]).catch(() => {});
}

// ── Arrêter un bot ────────────────────────────────────────────────────────────
function stopBot(botId) {
  if (!running[botId]) return { ok: false, error: 'Non en cours d\'exécution' };
  running[botId].autoRestart = false;
  try { running[botId].proc?.kill('SIGTERM'); } catch {}
  delete running[botId];
  db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['stopped', botId]).catch(() => {});
  console.log(`[BotHost] ⏹ Bot #${botId} arrêté manuellement`);
  return { ok: true };
}

// ── Supprimer un bot ──────────────────────────────────────────────────────────
async function deleteBot(botId) {
  stopBot(botId);
  await db.pool.query('DELETE FROM hosted_bots WHERE id=$1', [botId]);
  const dir = path.join(BOTS_DIR, String(botId));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  return { ok: true };
}

// ── Logs d'un bot ─────────────────────────────────────────────────────────────
function getLogs(botId) {
  return running[botId]?.logs || [];
}

// ── Restaurer les bots actifs au démarrage serveur ────────────────────────────
async function restoreRunningBots() {
  try {
    const r = await db.pool.query("SELECT * FROM hosted_bots WHERE status='running'");
    for (const bot of r.rows) {
      const workDir  = bot.work_dir || path.join(BOTS_DIR, String(bot.id));
      const mainFile = path.join(workDir, bot.main_file);
      if (fs.existsSync(workDir) && fs.existsSync(mainFile)) {
        console.log(`[BotHost] ♻ Restauration bot #${bot.id} "${bot.name}"`);
        _spawnBot(bot, workDir, mainFile);
      } else {
        await db.pool.query('UPDATE hosted_bots SET status=$1 WHERE id=$2', ['stopped', bot.id]);
        console.log(`[BotHost] ⚠ Bot #${bot.id} non restauré — fichiers manquants`);
      }
    }
  } catch (e) {
    console.error('[BotHost] restoreRunningBots error:', e.message);
  }
}

module.exports = {
  initDB, getAll, createBot, updateCode,
  startBot, stopBot, deleteBot, getLogs,
  restoreRunningBots, validateToken,
};
