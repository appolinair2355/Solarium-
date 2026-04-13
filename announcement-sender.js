const axios = require('axios');

async function sendAnnouncement(ann) {
  const BASE = `https://api.telegram.org/bot${ann.bot_token}`;
  const chatId = ann.channel_id;

  if (ann.media_type === 'image' && ann.media_url) {
    await axios.post(`${BASE}/sendPhoto`, { chat_id: chatId, photo: ann.media_url, caption: ann.text, parse_mode: 'HTML' });
  } else if (ann.media_type === 'video' && ann.media_url) {
    await axios.post(`${BASE}/sendVideo`, { chat_id: chatId, video: ann.media_url, caption: ann.text, parse_mode: 'HTML' });
  } else {
    await axios.post(`${BASE}/sendMessage`, { chat_id: chatId, text: ann.text, parse_mode: 'HTML' });
  }
}

module.exports = { sendAnnouncement };
