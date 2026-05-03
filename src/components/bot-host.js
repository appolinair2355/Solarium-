/**
 * bot-host.js — Hébergement de bots Telegram
 * Détection automatique du fichier principal dans le ZIP.
 * Analyse et correction automatique du paquet ZIP avant déploiement.
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
      id                 SERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      language           TEXT    DEFAULT 'python',
      token              TEXT    NOT NULL,
      channel_id         TEXT    DEFAULT '',
      main_file          TEXT    DEFAULT 'main.py',
      work_dir           TEXT    DEFAULT '',
      detected_files     TEXT    DEFAULT '',
      status             TEXT    DEFAULT 'stopped',
      is_prediction_bot  BOOLEAN DEFAULT false,
      auto_strategy_id   INTEGER DEFAULT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Migrations — ajouter les colonnes si elles n'existent pas encore
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS work_dir TEXT DEFAULT ''`).catch(() => {});
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS detected_files TEXT DEFAULT ''`).catch(() => {});
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS is_prediction_bot BOOLEAN DEFAULT false`).catch(() => {});
  await db.pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS auto_strategy_id INTEGER DEFAULT NULL`).catch(() => {});
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

// ── Analyser et corriger automatiquement le paquet ZIP de déploiement ────────
// Vérifie l'intégrité du ZIP, s'assure qu'un fichier principal est présent,
// ajoute un squelette si aucun script n'est trouvé, supprime les fichiers
// indésirables. Retourne { base64Fixed, report } avec le ZIP corrigé prêt.
async function analyzeAndFixZip(base64, language) {
  const lang = language || 'python';
  const ext  = lang === 'node' ? '.js' : '.py';
  const PRIORITY = lang === 'node'
    ? ['index.js', 'app.js', 'bot.js', 'main.js', 'server.js', 'start.js']
    : ['main.py', 'bot.py', 'app.py', 'run.py', 'start.py', 'bot_telegram.py',
       'telegram_bot.py', 'index.py', 'handler.py'];

  const report = {
    valid:        false,
    filesFound:   [],
    issues:       [],
    fixes:        [],
    mainDetected: null,
  };

  // 1. Vérifier que le buffer base64 est valide
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 4) throw new Error('Tampon trop court');
  } catch (e) {
    report.issues.push(`ZIP corrompu ou base64 invalide : ${e.message}`);
    console.error('[BotHost][ZIP-Analyse] ❌ Base64 invalide :', e.message);
    return { base64Fixed: base64, report };
  }

  // 2. Charger le ZIP
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    report.issues.push(`Impossible d'ouvrir le ZIP : ${e.message}`);
    console.error('[BotHost][ZIP-Analyse] ❌ Lecture ZIP impossible :', e.message);
    return { base64Fixed: base64, report };
  }

  // 3. Inventaire complet des fichiers
  const allFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
  report.filesFound = allFiles.map(([n]) => n);
  console.log(`[BotHost][ZIP-Analyse] 📦 ${report.filesFound.length} fichier(s) trouvé(s) dans le ZIP`);

  // 4. Supprimer les fichiers indésirables (.DS_Store, __MACOSX, Thumbs.db, .exe, .bat)
  const UNWANTED = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
  const UNWANTED_EXT = ['.exe', '.bat', '.cmd', '.sh.exe'];
  const UNWANTED_DIR = ['__MACOSX'];
  for (const [filename] of allFiles) {
    const base = path.basename(filename);
    const parts = filename.split('/');
    const inBadDir = parts.some(p => UNWANTED_DIR.includes(p));
    const isBadFile = UNWANTED.includes(base) || UNWANTED_EXT.some(e => base.endsWith(e));
    if (inBadDir || isBadFile) {
      delete zip.files[filename];
      report.fixes.push(`Fichier indésirable supprimé : ${filename}`);
      console.log(`[BotHost][ZIP-Analyse] 🗑 Supprimé : ${filename}`);
    }
  }

  // 5. Vérifier la présence d'un script principal
  const remainingFiles = Object.entries(zip.files).filter(([, f]) => !f.dir);
  const scriptFiles = remainingFiles
    .map(([n]) => n)
    .filter(n => n.endsWith(ext));

  let hasMain = false;
  for (const prio of PRIORITY) {
    if (scriptFiles.some(f => path.basename(f) === prio)) {
      report.mainDetected = prio;
      hasMain = true;
      break;
    }
  }

  // Fallback : n'importe quel script du bon type
  if (!hasMain && scriptFiles.length > 0) {
    report.mainDetected = path.basename(scriptFiles[0]);
    hasMain = true;
  }

  // 6. Aucun script trouvé → injecter un squelette minimal
  if (!hasMain) {
    report.issues.push(`Aucun script ${ext} trouvé dans le ZIP — squelette par défaut injecté`);
    const defaultMain = lang === 'node' ? 'index.js' : 'main.py';
    const skeleton = lang === 'node'
      ? `// Bot Telegram Node.js — squelette généré automatiquement\n` +
        `const TelegramBot = require('node-telegram-bot-api');\n` +
        `const token = process.env.BOT_TOKEN || '';\n` +
        `if (!token) { console.error('BOT_TOKEN manquant'); process.exit(1); }\n` +
        `const bot = new TelegramBot(token, { polling: true });\n` +
        `bot.on('message', msg => bot.sendMessage(msg.chat.id, 'Bonjour ! Je suis en ligne.'));\n` +
        `console.log('Bot Node.js démarré');\n`
      : `# Bot Telegram Python — squelette généré automatiquement\n` +
        `import os, telebot\n` +
        `token = os.environ.get('BOT_TOKEN', '')\n` +
        `if not token:\n    print('BOT_TOKEN manquant'); exit(1)\n` +
        `bot = telebot.TeleBot(token)\n` +
        `@bot.message_handler(func=lambda m: True)\n` +
        `def echo(m): bot.reply_to(m, 'Bonjour ! Je suis en ligne.')\n` +
        `print('Bot Python démarré')\n` +
        `bot.infinity_polling()\n`;

    zip.file(defaultMain, skeleton);
    report.fixes.push(`Squelette ${defaultMain} injecté automatiquement`);
    report.mainDetected = defaultMain;
    console.log(`[BotHost][ZIP-Analyse] 🔧 Squelette ${defaultMain} injecté`);
  }

  // 7. Pour Python : vérifier la présence de requirements.txt
  if (lang === 'python') {
    const hasReqs = Object.keys(zip.files).some(f => path.basename(f) === 'requirements.txt');
    if (!hasReqs) {
      zip.file('requirements.txt', 'pyTelegramBotAPI\n');
      report.fixes.push('requirements.txt manquant — créé avec dépendance de base (pyTelegramBotAPI)');
      console.log('[BotHost][ZIP-Analyse] 🔧 requirements.txt créé');
    }
  }

  // 8. Pour Node.js : vérifier la présence de package.json
  if (lang === 'node') {
    const hasPkg = Object.keys(zip.files).some(f => path.basename(f) === 'package.json');
    if (!hasPkg) {
      zip.file('package.json', JSON.stringify({
        name: 'telegram-bot', version: '1.0.0', main: report.mainDetected || 'index.js',
        dependencies: { 'node-telegram-bot-api': '^0.61.0' },
      }, null, 2));
      report.fixes.push('package.json manquant — créé avec dépendance de base (node-telegram-bot-api)');
      console.log('[BotHost][ZIP-Analyse] 🔧 package.json créé');
    }
  }

  // 9. Re-générer le ZIP corrigé
  let base64Fixed = base64;
  try {
    const fixedBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    base64Fixed = fixedBuffer.toString('base64');
    console.log(`[BotHost][ZIP-Analyse] ✅ ZIP corrigé généré (${fixedBuffer.length} octets)`);
  } catch (e) {
    report.issues.push(`Erreur régénération ZIP : ${e.message}`);
    console.error('[BotHost][ZIP-Analyse] ❌ Erreur régénération :', e.message);
  }

  report.valid = true;
  if (report.fixes.length === 0) {
    console.log('[BotHost][ZIP-Analyse] ✅ ZIP valide — aucune correction nécessaire');
  } else {
    console.log(`[BotHost][ZIP-Analyse] 🔧 ${report.fixes.length} correction(s) appliquée(s)`);
  }

  return { base64Fixed, report };
}

// ── Détection de code de prédiction automatique ───────────────────────────────
// Analyse le contenu des fichiers extraits et détecte les mots-clés typiques
// d'un bot de prédiction Baccarat. Retourne un objet de résultat.
function detectPredictionCode(botDir) {
  // Mots-clés qui identifient un code de prédiction automatique
  const PREDICTION_KEYWORDS = [
    'predict', 'prédiction', 'prediction', 'baccarat', 'baccara',
    'banker', 'banquier', 'player', 'joueur', 'suit', 'costume',
    'absence', 'manquant', 'rattrapage', 'strategy', 'stratégie',
    'send_prediction', 'envoyer_pred', 'auto_predict', 'auto_pred',
    'hearts', 'spades', 'clubs', 'diamonds',
    'coeur', 'carreau', 'trefle', 'trèfle', 'pique',
  ];

  const result = {
    isPredictionBot: false,
    keywords:        [],
    confidence:      0,   // 0-100%
    filesScanned:    0,
  };

  if (!fs.existsSync(botDir)) return result;

  // Scanner tous les fichiers texte du bot
  const scanDir = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scanDir(full);
        } else if (/\.(py|js|txt|json|cfg|ini|env)$/i.test(entry)) {
          try {
            const content = fs.readFileSync(full, 'utf8').toLowerCase();
            result.filesScanned++;
            for (const kw of PREDICTION_KEYWORDS) {
              if (content.includes(kw.toLowerCase()) && !result.keywords.includes(kw)) {
                result.keywords.push(kw);
              }
            }
          } catch {}
        }
      }
    } catch {}
  };
  scanDir(botDir);

  // Calculer un score de confiance (plus de mots-clés = plus de certitude)
  result.confidence = Math.min(100, Math.round(result.keywords.length / PREDICTION_KEYWORDS.length * 100 * 3));
  result.isPredictionBot = result.keywords.length >= 3; // ≥ 3 mots-clés → considéré comme bot de prédiction

  if (result.isPredictionBot) {
    console.log(`[BotHost] 🎯 Code de PRÉDICTION détecté — confiance: ${result.confidence}% — mots-clés: ${result.keywords.slice(0,5).join(', ')}`);
  } else {
    console.log(`[BotHost] ℹ Code générique — ${result.keywords.length} mot(s)-clé(s) prédiction trouvé(s) (seuil: 3)`);
  }

  return result;
}

// ── Configuration automatique du canal de prédiction ─────────────────────────
// Si le code déployé est un bot de prédiction, crée automatiquement :
//  1. Un canal Telegram dans le système (upsertTelegramConfig)
//  2. Une stratégie custom "manquants" liée à ce canal
//  3. Recharge le moteur de prédictions
// Retourne { ok, channelDbId, strategyId, message }
async function setupPredictionChannel(bot) {
  const { id: botId, name: botName, token, channel_id: channelId } = bot;
  if (!channelId || !token) {
    return { ok: false, message: 'channel_id ou token manquant — configuration auto ignorée' };
  }

  try {
    console.log(`[BotHost] 🔧 Mise en place automatique du canal de prédiction pour bot #${botId} "${botName}"...`);

    // 1. Créer ou mettre à jour le canal Telegram dans le système
    const channelName = `Bot-${botName}`.replace(/[^a-zA-Z0-9\-_\s]/g, '').trim();
    const existing = await db.pool.query(
      `SELECT id FROM telegram_config WHERE channel_id=$1`, [channelId]
    ).catch(() => ({ rows: [] }));

    let channelDbId;
    if (existing.rows.length > 0) {
      channelDbId = existing.rows[0].id;
      console.log(`[BotHost] ℹ Canal ${channelId} déjà enregistré en base (id=${channelDbId})`);
    } else {
      await db.upsertTelegramConfig(channelId, channelName);
      const newRow = await db.pool.query(
        `SELECT id FROM telegram_config WHERE channel_id=$1`, [channelId]
      );
      channelDbId = newRow.rows[0]?.id;
      console.log(`[BotHost] ✅ Canal Telegram "${channelName}" (${channelId}) créé en base (id=${channelDbId})`);
    }

    // 2. Créer une stratégie custom liée à ce canal
    //    Mode "manquants" par défaut — prédit le costume le plus absent
    const v          = await db.getSetting('custom_strategies').catch(() => null);
    const strategies = v ? JSON.parse(v) : [];

    // Vérifier si une stratégie pour ce bot existe déjà
    const alreadyExists = strategies.find(s =>
      s.tg_targets && s.tg_targets.some(t => String(t.channel_id) === String(channelId))
    );

    let strategyId = null;
    if (alreadyExists) {
      strategyId = alreadyExists.id;
      console.log(`[BotHost] ℹ Stratégie liée à ce canal déjà existante (id=${strategyId})`);
    } else {
      const nextId = strategies.length > 0 ? Math.max(...strategies.map(s => s.id || 0)) + 1 : 7;
      const newStrat = {
        id:               nextId,
        name:             `Auto-${botName}`,
        mode:             'manquants',
        hand:             'joueur',
        threshold:        5,
        max_rattrapage:   2,
        enabled:          true,
        visibility:       'admin',
        mappings:         { '♠': ['♠'], '♥': ['♥'], '♦': ['♦'], '♣': ['♣'] },
        exceptions:       [],
        prediction_offset: 1,
        tg_targets:       [{ bot_token: token, channel_id: channelId }],
        created_at:       new Date().toISOString(),
        _auto_created:    true,
        _from_bot_id:     botId,
      };

      strategies.push(newStrat);
      await db.setSetting('custom_strategies', JSON.stringify(strategies));
      strategyId = nextId;
      console.log(`[BotHost] ✅ Stratégie auto "${newStrat.name}" créée (id=${strategyId}) → canal ${channelId}`);

      // 3. Recharger le moteur de prédictions
      try {
        require('./engine').reloadCustomStrategies(strategies);
        console.log(`[BotHost] ✅ Moteur rechargé avec la nouvelle stratégie auto`);
      } catch (e) {
        console.warn(`[BotHost] ⚠ Rechargement moteur échoué : ${e.message}`);
      }
    }

    // 4. Enregistrer l'association dans la table hosted_bots
    await db.pool.query(
      `ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS is_prediction_bot BOOLEAN DEFAULT false`
    ).catch(() => {});
    await db.pool.query(
      `ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS auto_strategy_id INTEGER DEFAULT NULL`
    ).catch(() => {});
    await db.pool.query(
      `UPDATE hosted_bots SET is_prediction_bot=true, auto_strategy_id=$1 WHERE id=$2`,
      [strategyId, botId]
    );

    const msg = `Canal "${channelName}" (${channelId}) + stratégie "Auto-${botName}" (id=${strategyId}) créés automatiquement`;
    console.log(`[BotHost] ✅ Configuration auto terminée : ${msg}`);
    return { ok: true, channelDbId, strategyId, message: msg };

  } catch (e) {
    console.error(`[BotHost] ❌ Erreur configuration auto prédiction : ${e.message}`);
    return { ok: false, message: e.message };
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

  // 3. Analyser et corriger automatiquement le ZIP avant extraction
  let zipToUse  = zip_base64;
  let zipReport = null;
  if (zip_base64) {
    console.log(`[BotHost] 🔍 Analyse du ZIP de déploiement pour le bot #${bot.id} "${name}"...`);
    const analysis = await analyzeAndFixZip(zip_base64, lang);
    zipToUse  = analysis.base64Fixed;
    zipReport = analysis.report;
    if (zipReport.fixes.length > 0) {
      console.log(`[BotHost] 🔧 ZIP corrigé (${zipReport.fixes.length} correction(s)) : ${zipReport.fixes.join(' | ')}`);
    }
    if (zipReport.issues.length > 0) {
      console.warn(`[BotHost] ⚠ Problèmes ZIP détectés : ${zipReport.issues.join(' | ')}`);
    }
  }

  // 4. Extraire le ZIP (potentiellement corrigé)
  let detectedFiles = [];
  if (zipToUse) {
    detectedFiles = await extractZip(bot.id, zipToUse);
  }

  // 5. Détecter le fichier principal automatiquement
  const botDir   = path.join(BOTS_DIR, String(bot.id));
  const detected = detectMainFile(botDir, lang);

  if (!detected) {
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

  // 6. Envoyer "bienvenu bot configurer" via l'API token au canal
  const botUsername = valid.bot?.username || name;
  let welcomeResult = { ok: false, error: 'channel_id non fourni' };
  if (channel_id) {
    welcomeResult = await sendMessage(token, channel_id, 'bienvenu bot configurer');
    if (welcomeResult.ok) {
      console.log(`[BotHost] ✅ Message "bienvenu bot configurer" envoyé via API token → ${channel_id}`);
    } else {
      console.warn(`[BotHost] ⚠ Envoi "bienvenu bot configurer" échoué : ${welcomeResult.error}`);
    }
  } else {
    console.log(`[BotHost] ℹ Pas de channel_id — message "bienvenu bot configurer" ignoré`);
  }

  // 7. Vérification post-déploiement : détecter si c'est un code de prédiction automatique
  const botDirPred  = path.join(BOTS_DIR, String(bot.id));
  const predDetect  = detectPredictionCode(botDirPred);
  let   autoSetup   = null;

  if (predDetect.isPredictionBot) {
    console.log(`[BotHost] 🎯 Bot de prédiction détecté (confiance ${predDetect.confidence}%) — configuration automatique...`);
    // Récupérer le bot mis à jour avec main_file/work_dir avant de passer à setupPredictionChannel
    const botUpdated = (await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [bot.id])).rows[0];
    autoSetup = await setupPredictionChannel({ ...botUpdated, token, channel_id });

    // Envoyer un message de confirmation au canal Telegram
    if (autoSetup.ok && channel_id) {
      const confirmMsg = `✅ Bot de prédiction configuré automatiquement !\n\nStratégie "${botUpdated.name}" créée et active.\nLes prédictions démarreront au prochain jeu.`;
      await sendMessage(token, channel_id, confirmMsg).catch(() => {});
    }
  } else {
    console.log(`[BotHost] ℹ Bot générique (${predDetect.keywords.length} mot(s)-clé préd. détecté(s)) — pas de configuration auto`);
  }

  console.log(`[BotHost] Bot #${bot.id} "${name}" créé (${lang}) — ${detectedFiles.length} fichiers`);

  // Retourner le bot mis à jour avec le rapport d'analyse et le résultat de détection
  const updated = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [bot.id]);
  return {
    ...updated.rows[0],
    _welcome:          welcomeResult,
    _zipReport:        zipReport,
    _predDetection:    predDetect,
    _autoSetup:        autoSetup,
  };
}

// ── Mettre à jour le code d'un bot (re-déploiement ZIP) ───────────────────────
async function updateCode(botId, zip_base64) {
  const wasRunning = !!running[botId];
  if (wasRunning) stopBot(botId);

  const rBot = await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [botId]);
  if (!rBot.rows.length) throw new Error('Bot introuvable');
  const bot = rBot.rows[0];

  // Analyser et corriger le ZIP avant extraction
  console.log(`[BotHost] 🔍 Analyse du ZIP de mise à jour pour le bot #${botId}...`);
  const analysis = await analyzeAndFixZip(zip_base64, bot.language);
  const zipToUse = analysis.base64Fixed;
  const zipReport = analysis.report;
  if (zipReport.fixes.length > 0) {
    console.log(`[BotHost] 🔧 ZIP corrigé (${zipReport.fixes.length} correction(s)) : ${zipReport.fixes.join(' | ')}`);
  }

  const detectedFiles = await extractZip(botId, zipToUse);
  const botDir = path.join(BOTS_DIR, String(botId));
  const detected = detectMainFile(botDir, bot.language);

  if (detected) {
    await db.pool.query(
      `UPDATE hosted_bots SET main_file=$1, work_dir=$2, detected_files=$3, updated_at=NOW() WHERE id=$4`,
      [detected.mainFile, detected.workDir, detectedFiles.join('|'), botId]
    );
    console.log(`[BotHost] Code mis à jour — fichier principal: ${detected.relPath}`);
  }

  // Vérification post-mise à jour : re-détecter si c'est un code de prédiction
  const botDirUpdate   = path.join(BOTS_DIR, String(botId));
  const predDetectUpd  = detectPredictionCode(botDirUpdate);
  let   autoSetupUpd   = null;

  // Si c'est un bot de prédiction ET qu'il n'a pas encore de stratégie auto → la créer
  const botRowUpd = (await db.pool.query('SELECT * FROM hosted_bots WHERE id=$1', [botId])).rows[0];
  if (predDetectUpd.isPredictionBot && !botRowUpd?.auto_strategy_id) {
    autoSetupUpd = await setupPredictionChannel({ ...botRowUpd, token: bot.token });
  }

  if (wasRunning) await startBot(botId);
  return {
    ok: true,
    detected:       detected ? detected.relPath : null,
    _zipReport:     zipReport,
    _predDetection: predDetectUpd,
    _autoSetup:     autoSetupUpd,
  };
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

// ── Installer les dépendances avant de lancer le bot ─────────────────────────
function _installDeps(bot, workDir, state) {
  return new Promise((resolve) => {
    const lang = bot.language || 'python';
    const addLog = (s, msg) => {
      state.logs.push({ t: Date.now(), s, m: msg });
      if (state.logs.length > 500) state.logs.shift();
    };

    let cmd, args, label;
    if (lang === 'node') {
      const pkgJson = path.join(workDir, 'package.json');
      if (!fs.existsSync(pkgJson)) {
        addLog('out', '[Install] Pas de package.json — installation ignorée');
        return resolve(true);
      }
      cmd = 'npm'; args = ['install', '--prefer-offline', '--no-audit', '--no-fund']; label = 'npm install';
    } else {
      const reqTxt = path.join(workDir, 'requirements.txt');
      if (!fs.existsSync(reqTxt)) {
        addLog('out', '[Install] Pas de requirements.txt — installation ignorée');
        return resolve(true);
      }
      cmd = 'pip3'; args = ['install', '-r', 'requirements.txt', '--quiet', '--disable-pip-version-check']; label = 'pip3 install -r requirements.txt';
    }

    addLog('out', `[Install] ⏳ ${label}...`);
    console.log(`[BotHost] 📦 Bot #${bot.id} — ${label} dans ${workDir}`);

    const proc = spawn(cmd, args, { cwd: workDir, env: process.env });
    proc.stdout.on('data', d => {
      const m = d.toString().trim(); if (m) addLog('out', `[Install] ${m}`);
    });
    proc.stderr.on('data', d => {
      const m = d.toString().trim(); if (m) addLog('err', `[Install] ${m}`);
    });
    proc.on('close', code => {
      if (code === 0) {
        addLog('out', `[Install] ✅ ${label} terminé avec succès`);
        console.log(`[BotHost] ✅ Bot #${bot.id} — dépendances installées`);
        resolve(true);
      } else {
        addLog('err', `[Install] ❌ ${label} échoué (code=${code}) — le bot ne pourra pas démarrer correctement`);
        console.error(`[BotHost] ❌ Bot #${bot.id} — installation échouée (code=${code})`);
        resolve(false); // On continue quand même mais on loggue l'erreur
      }
    });
    proc.on('error', e => {
      addLog('err', `[Install] ❌ Impossible de lancer ${cmd} : ${e.message}`);
      console.error(`[BotHost] ❌ Bot #${bot.id} — erreur spawn install : ${e.message}`);
      resolve(false);
    });
  });
}

// ── Lancer le processus ───────────────────────────────────────────────────────
async function _spawnBot(bot, workDir, mainFilePath) {
  const botId = bot.id;
  const lang  = bot.language || 'python';
  const cmd   = lang === 'node' ? 'node' : 'python3';

  // Initialiser l'état (avec préservation des logs existants)
  const state = {
    proc:        null,
    logs:        running[botId]?.logs || [],
    restarts:    running[botId]?.restarts || 0,
    autoRestart: true,
    installing:  true,
  };
  running[botId] = state;
  db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['installing', botId]).catch(() => {});

  // 1. Installer les dépendances
  await _installDeps(bot, workDir, state);
  state.installing = false;

  // Vérifier si le bot a été arrêté pendant l'installation
  if (!running[botId]?.autoRestart) {
    console.log(`[BotHost] Bot #${botId} annulé pendant l'installation`);
    return;
  }

  if (!fs.existsSync(mainFilePath)) {
    state.logs.push({ t: Date.now(), s: 'err', m: `❌ Fichier introuvable : ${mainFilePath}` });
    db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['stopped', botId]).catch(() => {});
    console.error(`[BotHost] ❌ Bot #${botId} — fichier principal introuvable : ${mainFilePath}`);
    return;
  }

  // 2. Lancer le bot
  console.log(`[BotHost] ▶ Bot #${botId} "${bot.name}" → ${cmd} ${mainFilePath} (CWD: ${workDir})`);
  state.logs.push({ t: Date.now(), s: 'out', m: `▶ Démarrage : ${cmd} ${path.basename(mainFilePath)}` });

  const webPort = 10000 + botId;
  const proc = spawn(cmd, [mainFilePath], {
    cwd: workDir,
    env: {
      ...process.env,
      BOT_TOKEN:  bot.token,
      CHANNEL_ID: bot.channel_id || '',
      PORT:       String(webPort),
      PYTHONUNBUFFERED: '1',
    },
  });
  state.proc = proc;

  const addLog = (s, data) => {
    const m = data.toString().trim();
    if (!m) return;
    state.logs.push({ t: Date.now(), s, m });
    if (state.logs.length > 500) state.logs.shift();
  };
  proc.stdout.on('data', d => addLog('out', d));
  proc.stderr.on('data', d => addLog('err', d));

  proc.on('close', code => {
    console.log(`[BotHost] ⏹ Bot #${botId} terminé (code=${code})`);
    if (running[botId]?.autoRestart && code !== null) {
      running[botId].restarts++;
      const delay = Math.min(5000 * running[botId].restarts, 30000); // Backoff progressif
      console.log(`[BotHost] 🔄 Redémarrage auto bot #${botId} dans ${delay / 1000}s`);
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
      }, delay);
    } else {
      delete running[botId];
      db.pool.query('UPDATE hosted_bots SET status=$1,updated_at=NOW() WHERE id=$2', ['stopped', botId]).catch(() => {});
    }
  });

  proc.on('error', e => {
    addLog('err', `❌ Impossible de lancer ${cmd} : ${e.message}`);
    console.error(`[BotHost] ❌ Bot #${botId} — erreur spawn : ${e.message}`);
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

// ── Nettoyage périodique des logs en mémoire ─────────────────────────────────
// Appelé toutes les 20 minutes depuis index.js
// Conserve seulement les N dernières lignes par bot
function purgeMemoryLogs(keepLast = 30) {
  let total = 0;
  for (const [id, state] of Object.entries(running)) {
    if (!state || !Array.isArray(state.logs)) continue;
    const before = state.logs.length;
    if (before > keepLast) {
      state.logs.splice(0, before - keepLast);
      total += before - keepLast;
    }
  }
  if (total > 0) console.log(`[BotHost] 🧹 Nettoyage mémoire : ${total} ligne(s) de logs supprimée(s) (bots actifs: ${Object.keys(running).length})`);
}

module.exports = {
  initDB, getAll, createBot, updateCode,
  startBot, stopBot, deleteBot, getLogs,
  restoreRunningBots, validateToken, analyzeAndFixZip,
  detectPredictionCode, setupPredictionChannel,
  purgeMemoryLogs,
};
