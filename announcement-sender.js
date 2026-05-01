// announcement-sender.js — Envoi d'annonces Telegram (texte, image, vidéo).
//
// Supporte 3 sources de média :
//   1) media_url   → URL distante (Telegram télécharge depuis cette URL)
//   2) media_data  → fichier en base64 (téléversé depuis l'admin) — envoyé en multipart
//   3) Aucun       → message texte simple
//
// Pour les fichiers téléversés (media_data), on utilise FormData pour
// envoyer le fichier en multipart à l'API Telegram (sendPhoto / sendVideo).

const axios   = require('axios');
const FormData = require('form-data');

function guessMime(filename, fallback) {
  if (!filename) return fallback;
  const ext = String(filename).toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    webm: 'video/webm', mkv: 'video/x-matroska',
  };
  return map[ext] || fallback;
}

// ── Signature ajoutée automatiquement à chaque annonce ──────────────────────
const ANNOUNCEMENT_SIGNATURE = `\n\n✨〰️〰️〰️〰️〰️〰️〰️〰️〰️✨\n🏆 <b>Développeur</b> : <b>Sossou Kouamé</b> 🎯\n💎 Prédictions Baccarat Pro\n📲 Pour plus d'informations contactez-moi :\n👉🏻 <a href="https://t.me/Kouamappoloak">t.me/Kouamappoloak</a>\n✨〰️〰️〰️〰️〰️〰️〰️〰️〰️✨`;

function withSignature(text) {
  return (text || '') + ANNOUNCEMENT_SIGNATURE;
}

async function sendAnnouncement(ann) {
  const BASE = `https://api.telegram.org/bot${ann.bot_token}`;
  const chatId = ann.channel_id;

  // ── Cas 1 : fichier téléversé (base64) → envoi multipart ──
  if (ann.media_type && ann.media_data) {
    const buf = Buffer.from(ann.media_data, 'base64');
    const filename = ann.media_filename || (ann.media_type === 'video' ? 'video.mp4' : 'image.jpg');
    const mime = guessMime(filename, ann.media_type === 'video' ? 'video/mp4' : 'image/jpeg');

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', withSignature(ann.text));
    form.append('parse_mode', 'HTML');
    const fieldName = ann.media_type === 'video' ? 'video' : 'photo';
    form.append(fieldName, buf, { filename, contentType: mime });

    const endpoint = ann.media_type === 'video' ? 'sendVideo' : 'sendPhoto';
    await axios.post(`${BASE}/${endpoint}`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength:   Infinity,
    });
    return;
  }

  // ── Cas 2 : URL distante ──
  if (ann.media_type === 'image' && ann.media_url) {
    await axios.post(`${BASE}/sendPhoto`, { chat_id: chatId, photo: ann.media_url, caption: withSignature(ann.text), parse_mode: 'HTML' });
    return;
  }
  if (ann.media_type === 'video' && ann.media_url) {
    await axios.post(`${BASE}/sendVideo`, { chat_id: chatId, video: ann.media_url, caption: withSignature(ann.text), parse_mode: 'HTML' });
    return;
  }

  // ── Cas 3 : texte uniquement ──
  await axios.post(`${BASE}/sendMessage`, { chat_id: chatId, text: withSignature(ann.text), parse_mode: 'HTML' });
}

module.exports = { sendAnnouncement };
