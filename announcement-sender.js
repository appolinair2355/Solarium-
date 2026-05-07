// announcement-sender.js — Envoi d'annonces Telegram (texte, image, vidéo).
//
// Deux exports :
//   sendTelegramMsg(params)  → envoi bas niveau SANS signature
//   sendAnnouncement(ann)    → envoi AVEC signature (ancien système — onglet Telegram admin)

'use strict';
const axios    = require('axios');
const FormData = require('form-data');

function guessMime(filename, fallback) {
  if (!filename) return fallback;
  const ext = String(filename).toLowerCase().split('.').pop();
  const map  = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    webm: 'video/webm', mkv: 'video/x-matroska',
  };
  return map[ext] || fallback;
}

const ANNOUNCEMENT_SIGNATURE = `\n\n✨〰️〰️〰️〰️〰️〰️〰️〰️〰️✨\n🏆 <b>Développeur</b> : <b>Sossou Kouamé</b> 🎯\n💎 Prédictions Baccarat Pro\n📲 Pour plus d'informations contactez-moi :\n👉🏻 <a href="https://t.me/Kouamappoloak">t.me/Kouamappoloak</a>\n✨〰️〰️〰️〰️〰️〰️〰️〰️〰️✨`;

/**
 * sendTelegramMsg — envoi bas niveau sans signature
 * @param {object} p
 * @param {string} p.bot_token
 * @param {string} p.channel_id
 * @param {string} p.text
 * @param {string} [p.media_type]    'image' | 'video'
 * @param {string} [p.media_data]    base64
 * @param {string} [p.media_filename]
 * @param {string} [p.media_url]     URL distante (fallback)
 */
async function sendTelegramMsg(p) {
  const BASE   = `https://api.telegram.org/bot${p.bot_token}`;
  const chatId = String(p.channel_id);
  const text   = (p.text || '').trim();

  // ── Fichier base64 (multipart) ──
  if (p.media_type && p.media_data) {
    const buf      = Buffer.from(p.media_data, 'base64');
    const filename = p.media_filename || (p.media_type === 'video' ? 'video.mp4' : 'image.jpg');
    const mime     = guessMime(filename, p.media_type === 'video' ? 'video/mp4' : 'image/jpeg');
    const field    = p.media_type === 'video' ? 'video' : 'photo';
    const endpoint = p.media_type === 'video' ? 'sendVideo' : 'sendPhoto';

    const form = new FormData();
    form.append('chat_id', chatId);
    if (text) { form.append('caption', text); form.append('parse_mode', 'HTML'); }
    form.append(field, buf, { filename, contentType: mime });

    await axios.post(`${BASE}/${endpoint}`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength:    Infinity,
      timeout: 30000,
    });
    return;
  }

  // ── URL distante ──
  if (p.media_type === 'image' && p.media_url) {
    await axios.post(`${BASE}/sendPhoto`, { chat_id: chatId, photo: p.media_url, caption: text, parse_mode: 'HTML' }, { timeout: 15000 });
    return;
  }
  if (p.media_type === 'video' && p.media_url) {
    await axios.post(`${BASE}/sendVideo`, { chat_id: chatId, video: p.media_url, caption: text, parse_mode: 'HTML' }, { timeout: 15000 });
    return;
  }

  // ── Texte uniquement ──
  if (text) {
    await axios.post(`${BASE}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML' }, { timeout: 15000 });
  }
}

/**
 * sendAnnouncement — envoi AVEC signature (compatibilité ancien système)
 * Attend ann.text (pas ann.message_text).
 */
async function sendAnnouncement(ann) {
  return sendTelegramMsg({
    ...ann,
    text: (ann.text || '') + ANNOUNCEMENT_SIGNATURE,
  });
}

module.exports = { sendAnnouncement, sendTelegramMsg };
