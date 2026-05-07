'use strict';
/**
 * tg-announce-scheduler.js — Planificateur d'annonces Telegram (nouveau système DB)
 *
 * Deux modes :
 *   - interval : toutes les X heures aux heures rondes (0h, Xh, 2Xh…)
 *   - fixed    : à des heures précises (12, 17, 19…) pile à l'heure
 *
 * Utilise sendTelegramMsg() de announcement-sender.js (envoi sans signature).
 */

const { sendTelegramMsg } = require('./announcement-sender');
let _timer = null;

/**
 * Envoie immédiatement une annonce.
 * Compatible avec les enregistrements de la table tg_announcements.
 */
async function sendAnnouncementNow(ann) {
  return sendTelegramMsg({
    bot_token:      ann.bot_token,
    channel_id:     ann.channel_id,
    text:           ann.message_text || '',
    media_type:     ann.media_type   || null,
    media_data:     ann.media_data   || null,
    media_filename: ann.media_filename || null,
  });
}

// ── Détermine si une annonce doit être envoyée maintenant ────────────────────
function _shouldSend(ann, nowDate) {
  if (nowDate.getMinutes() !== 0) return false;

  const hour = nowDate.getHours();

  if (ann.schedule_type === 'interval') {
    const intervalH = Math.max(1, parseInt(ann.interval_hours) || 1);
    return hour % intervalH === 0;
  }

  if (ann.schedule_type === 'fixed') {
    let hours = ann.fixed_hours;
    if (typeof hours === 'string') { try { hours = JSON.parse(hours); } catch { hours = []; } }
    if (!Array.isArray(hours)) return false;
    return hours.map(h => parseInt(h)).includes(hour);
  }

  return false;
}

// ── Tick principal — déclenché toutes les 60 secondes ───────────────────────
async function _tick() {
  let pool;
  try { pool = require('./db').pool; } catch { return; }
  if (!pool) return;

  try {
    const now = new Date();
    const r   = await pool.query('SELECT * FROM tg_announcements WHERE enabled = TRUE');

    for (const ann of r.rows) {
      if (!_shouldSend(ann, now)) continue;
      try {
        await sendAnnouncementNow(ann);
        await pool.query('UPDATE tg_announcements SET last_sent_at = NOW() WHERE id = $1', [ann.id]);
        console.log(`[TgAnnounce] ✅ "${ann.name}" → canal ${ann.channel_id}`);
      } catch (e) {
        console.warn(`[TgAnnounce] ❌ "${ann.name}": ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[TgAnnounce] Erreur tick:', e.message);
  }
}

function startTgAnnounceScheduler() {
  if (_timer) return;
  const now        = new Date();
  const msToNext   = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    _tick().catch(() => {});
    _timer = setInterval(_tick, 60_000);
  }, msToNext);
  console.log('[TgAnnounce] Planificateur démarré (vérif. toutes les 60 s)');
}

function stopTgAnnounceScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startTgAnnounceScheduler, stopTgAnnounceScheduler, sendAnnouncementNow };
