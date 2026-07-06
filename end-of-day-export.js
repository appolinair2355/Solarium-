/**
 * end-of-day-export.js
 * Export COMPLET de toutes les données vers un canal Telegram.
 * Déclenché automatiquement au jeu #1439 ou manuellement depuis l'admin.
 *
 * Contenu :
 *   - db.json complet (utilisateurs, prédictions, canaux Telegram, TOUS les paramètres)
 *   - Stratégies personnalisées (config + états moteur : compteurs, pending, historique)
 *   - Compteurs de costumes (suit-counter-service : config + états)
 *
 * Config dans les paramètres (Admin → Backup) :
 *   eod_bot_token  — token du bot Telegram qui envoie le fichier
 *   eod_channel_id — ID du canal / chat destination (ex: -1001234567890)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// Garde anti-doublon pour l'envoi automatique (un seul envoi par jour)
let _sentDate = null;

// ── Collecte COMPLÈTE de toutes les données ─────────────────────────────────
function _collectAll() {
  const jsondb = require('./jsondb');

  // ── 1. Données persistées (db.json) ────────────────────────────────────────
  const dbPath = path.join(__dirname, 'data', 'db.json');
  let rawDb = null;
  try { rawDb = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch {}

  // ── 2. Utilisateurs (sans hash de mot de passe) ────────────────────────────
  const users = jsondb.getAllUsers().map(({ password_hash, ...safe }) => safe);

  // ── 3. Prédictions (toutes) ────────────────────────────────────────────────
  const predictions = jsondb.getPredictions({ limit: 0 });

  // ── 4. Canaux Telegram configurés ─────────────────────────────────────────
  const telegram_config = jsondb.getTelegramConfigs();

  // ── 5. TOUS les paramètres (sans aucun masquage) ───────────────────────────
  const settings = jsondb.getAllSettings();

  // ── 6. États moteur : stratégies personnalisées ────────────────────────────
  let engine_states = {};
  try {
    const engine = require('./engine');
    if (engine && engine.custom) {
      for (const [id, s] of Object.entries(engine.custom)) {
        engine_states[id] = {
          config:        s.config  || null,
          counts:        s.counts  || {},
          pending:       s.pending || {},
          lastOutcomes:  s.lastOutcomes || [],
          history:       (s.history || []).slice(-20),
          snakeActive:   s.snakeActive  || false,
          snakeSuit:     s.snakeSuit    || null,
          parityCounts:  s.parityCounts || null,
          c2v3Counts:    s.c2v3Counts   || null,
          abs2k3k:       s.abs2k3k      || null,
          mirrorCounts:  s.mirrorCounts || null,
        };
      }
    }
  } catch (e) {
    engine_states = { _error: e.message };
  }

  // ── 7. Compteurs de costumes ───────────────────────────────────────────────
  let suit_counters = { list: [], states: {} };
  try {
    const scs = require('./suit-counter-service');
    suit_counters = {
      list:   scs.getCountersList ? scs.getCountersList() : [],
      states: scs.getAllStates    ? scs.getAllStates()     : {},
    };
  } catch (e) {
    suit_counters = { _error: e.message };
  }

  return {
    exported_at:    new Date().toISOString(),
    users,
    predictions,
    telegram_config,
    settings,
    engine_states,
    suit_counters,
    _raw_db:        rawDb,  // db.json brut pour restauration complète
  };
}

// ── Envoi du fichier JSON vers Telegram ────────────────────────────────────
async function _sendToTelegram(botToken, channelId, allData, caption) {
  const fetch    = require('node-fetch');
  const FormData = require('form-data');

  const today    = new Date().toISOString().slice(0, 10);
  const json     = JSON.stringify(allData, null, 2);
  const filename = `baccarat-backup-${today}.json`;
  const tmpPath  = path.join(__dirname, 'data', filename);

  fs.writeFileSync(tmpPath, json, 'utf8');
  const sizeKo = (json.length / 1024).toFixed(1);
  console.log(`[EOD] 📄 Fichier généré : ${filename} (${sizeKo} Ko)`);

  try {
    const form = new FormData();
    form.append('chat_id',    String(channelId));
    form.append('caption',    caption);
    form.append('parse_mode', 'Markdown');
    form.append('document',   fs.createReadStream(tmpPath), { filename });

    const res  = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method:  'POST',
      body:    form,
      headers: form.getHeaders(),
    });
    const data = await res.json();

    if (data.ok) {
      console.log(`[EOD] ✅ Backup envoyé → canal ${channelId} (msg_id=${data.result?.message_id})`);
      return {
        ok: true,
        msg_id:  data.result?.message_id,
        sizeKo,
        users:       allData.users.length,
        predictions: allData.predictions.length,
        strategies:  Object.keys(allData.engine_states).length,
      };
    } else {
      const err = `Telegram refus : ${data.description}`;
      console.error('[EOD] ❌ ' + err);
      throw new Error(err);
    }
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── Export automatique (jeu #1439 — garde anti-doublon par jour) ────────────
async function runExport() {
  const jsondb = require('./jsondb');
  const today  = new Date().toISOString().slice(0, 10);

  if (_sentDate === today) {
    console.log(`[EOD] ℹ️  Export déjà effectué aujourd'hui (${today}) — ignoré.`);
    return;
  }

  const botToken  = jsondb.getSetting('eod_bot_token');
  const channelId = jsondb.getSetting('eod_channel_id');

  if (!botToken || !channelId) {
    console.warn('[EOD] ⚠️  eod_bot_token ou eod_channel_id non configuré → Admin → Backup.');
    return;
  }

  console.log('[EOD] 🕛 Jeu #1439 → export COMPLET de toutes les données…');
  const allData = _collectAll();
  allData.exported_at_game = 1439;

  const caption =
    `📦 *Backup Complet — Baccarat Pro — ${today}*\n` +
    `Jeu #1439 atteint — export automatique.\n` +
    `👥 ${allData.users.length} utilisateurs · 🎯 ${allData.predictions.length} prédictions · ⚙️ ${Object.keys(allData.engine_states).length} stratégies`;

  try {
    const result = await _sendToTelegram(botToken, channelId, allData, caption);
    _sentDate = today;
    return result;
  } catch (e) {
    console.error('[EOD] ❌ Erreur envoi :', e.message);
    throw e;
  }
}

// ── Export forcé / test (bypass garde journalière) ─────────────────────────
async function runExportForce() {
  const jsondb = require('./jsondb');

  const botToken  = jsondb.getSetting('eod_bot_token');
  const channelId = jsondb.getSetting('eod_channel_id');

  if (!botToken || !channelId)
    throw new Error('eod_bot_token ou eod_channel_id non configuré dans Admin → Backup.');

  const today   = new Date().toISOString().slice(0, 10);
  const allData = _collectAll();
  allData.exported_at_game = 'TEST';

  const strats  = Object.keys(allData.engine_states).length;
  const caption =
    `🧪 *Test Backup Complet — ${today}*\n` +
    `Export manuel depuis le panneau Admin.\n` +
    `👥 ${allData.users.length} utilisateurs · 🎯 ${allData.predictions.length} prédictions · ⚙️ ${strats} stratégies`;

  console.log('[EOD] 🧪 Export de test manuel déclenché…');
  const result = await _sendToTelegram(botToken, channelId, allData, caption);

  return (
    `✅ Backup envoyé au canal ${channelId}\n` +
    `📊 ${result.users} utilisateurs · ${result.predictions} prédictions · ${strats} stratégies · ${result.sizeKo} Ko`
  );
}

module.exports = { runExport, runExportForce };
