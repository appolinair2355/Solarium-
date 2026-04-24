// comptages.js — Suivi des écarts entre événements (suits / victoires / parité /
// distribution / nb de cartes / scores) avec bilan horaire envoyé sur Telegram.
//
// Concept :
//   • Pour chaque sous-catégorie (ex. ♥, Joueur, Pair, 2/2, 2k Joueur, …),
//     on tient un compteur d'écart qui s'incrémente à chaque jeu où l'événement
//     N'EST PAS apparu, et se remet à 0 quand il apparaît.
//   • À tout moment on suit :
//       - cur       : longueur actuelle de la série « sans »
//       - maxAll    : plus grand écart jamais observé (lifetime)
//       - maxPeriod : plus grand écart observé depuis le dernier bilan
//   • Toutes les heures pile (XX:00), on envoie un bilan sur le canal Telegram
//     configuré, et `maxPeriod` est remis à 0 pour la nouvelle période.
//
// Stockage (clés `settings`) :
//   • `comptages_config`      → { bot_token, channel_id, enabled }
//   • `comptages_state`       → { streaks: {key: {cur,maxAll,maxPeriod}}, processed: [n,…] }
//   • `comptages_last_report` → { timestamp, summary: [...] }

const express = require('express');
const fetch   = require('node-fetch');
const db      = require('./db');

const router = express.Router();

// ── Définition des catégories ──────────────────────────────────────────────
//
// Chaque sous-catégorie possède :
//   group  : libellé du groupe (Costume, Victoire, Parité, …)
//   label  : libellé court de la sous-catégorie
//   match  : fonction (ctx) → bool. true ⇒ l'événement est apparu sur ce jeu.

const CATEGORIES = [
  // Costume — apparition d'au moins une carte de cette couleur dans le jeu
  { key: 'suit_heart',   group: '🃏 Costume',     label: '❤️ Cœur',     match: c => c.suits.has('♥') },
  { key: 'suit_club',    group: '🃏 Costume',     label: '♣️ Trèfle',   match: c => c.suits.has('♣') },
  { key: 'suit_spade',   group: '🃏 Costume',     label: '♠️ Pique',    match: c => c.suits.has('♠') },
  { key: 'suit_diamond', group: '🃏 Costume',     label: '♦️ Carreau',  match: c => c.suits.has('♦') },

  // Victoire (Tie ⇒ ne déclenche aucun des deux ⇒ les écarts s'incrémentent)
  { key: 'win_player',   group: '🏆 Victoire',    label: 'Joueur',     match: c => c.winner === 'Player' },
  { key: 'win_banker',   group: '🏆 Victoire',    label: 'Banquier',   match: c => c.winner === 'Banker' },

  // Parité du score gagnant (Tie ⇒ on prend la parité du score commun)
  { key: 'parite_pair',  group: '⚖️ Parité',      label: 'Pair',       match: c => c.winnerScore !== null && c.winnerScore % 2 === 0 },
  { key: 'parite_imp',   group: '⚖️ Parité',      label: 'Impair',     match: c => c.winnerScore !== null && c.winnerScore % 2 === 1 },

  // Distribution — nb de cartes joueur / banquier à la fin de la main
  { key: 'dist_2_2', group: '🎴 Série de cartes', label: '2/2', match: c => c.np === 2 && c.nb === 2 },
  { key: 'dist_2_3', group: '🎴 Série de cartes', label: '2/3', match: c => c.np === 2 && c.nb === 3 },
  { key: 'dist_3_2', group: '🎴 Série de cartes', label: '3/2', match: c => c.np === 3 && c.nb === 2 },
  { key: 'dist_3_3', group: '🎴 Série de cartes', label: '3/3', match: c => c.np === 3 && c.nb === 3 },

  // Nombre de cartes par camp
  { key: 'nbk_p2', group: '🃎 Cartes Joueur',   label: '2k Joueur',    match: c => c.np === 2 },
  { key: 'nbk_p3', group: '🃎 Cartes Joueur',   label: '3k Joueur',    match: c => c.np === 3 },
  { key: 'nbk_b2', group: '🃎 Cartes Banquier', label: '2k Banquier',  match: c => c.nb === 2 },
  { key: 'nbk_b3', group: '🃎 Cartes Banquier', label: '3k Banquier',  match: c => c.nb === 3 },

  // Catégorie « > 6.5 / < 4.5 » (équivaut à ≥ 7 / ≤ 4)
  { key: 'pt_p_high', group: '📊 Points',       label: 'Joueur > 6.5',   match: c => c.ps !== null && c.ps >= 7 },
  { key: 'pt_p_low',  group: '📊 Points',       label: 'Joueur < 4.5',   match: c => c.ps !== null && c.ps <= 4 },
  { key: 'pt_b_high', group: '📊 Points',       label: 'Banquier > 6.5', match: c => c.bs !== null && c.bs >= 7 },
  { key: 'pt_b_low',  group: '📊 Points',       label: 'Banquier < 4.5', match: c => c.bs !== null && c.bs <= 4 },
];

// ── Score baccarat ─────────────────────────────────────────────────────────

function cardValue(card) {
  let r = card?.R;
  if (r === undefined || r === null) return 0;
  if (typeof r === 'string') {
    const u = r.toUpperCase().trim();
    if (u === 'A') return 1;
    if (['J', 'Q', 'K', 'T', '10'].includes(u)) return 0;
    const n = parseInt(u, 10);
    if (Number.isNaN(n)) return 0;
    return n >= 10 ? 0 : n;
  }
  if (typeof r === 'number') {
    if (r === 1) return 1;
    if (r >= 2 && r <= 9) return r;
    return 0;
  }
  return 0;
}

function handScore(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const sum = cards.reduce((acc, c) => acc + cardValue(c), 0);
  return sum % 10;
}

function normalizeSuit(s) {
  if (!s) return '';
  const m = { '♠️':'♠', '♣️':'♣', '♦️':'♦', '♥️':'♥', '❤️':'♥', '❤':'♥' };
  return m[s] || s;
}

function suitsOf(cards) {
  const out = new Set();
  for (const c of (cards || [])) {
    const n = normalizeSuit(c?.S || '');
    if (['♠','♣','♦','♥'].includes(n)) out.add(n);
  }
  return out;
}

// ── État en mémoire ────────────────────────────────────────────────────────

const state = {
  config: { bot_token: '', channel_id: '', enabled: false },
  extraChannels: [],    // [{ id, label, bot_token, channel_id, enabled }]
  streaks: {},          // key → { cur, maxAll, maxPeriod }
  processed: new Set(), // game_numbers déjà comptés
  lastReport: null,     // { timestamp, summary: [{key,group,label,maxPeriod,maxAll}] }
  lastReportHourKey: null, // ex. "2026-04-24T21" — empêche double envoi
};

function freshStreak() { return { cur: 0, maxAll: 0, maxPeriod: 0 }; }

function normalizeChannel(ch) {
  if (!ch || typeof ch !== 'object') return null;
  return {
    id:         String(ch.id || ('c' + Math.random().toString(36).slice(2, 9))),
    label:      typeof ch.label === 'string' ? ch.label : '',
    bot_token:  typeof ch.bot_token === 'string' ? ch.bot_token : '',
    channel_id: typeof ch.channel_id === 'string' ? ch.channel_id : '',
    enabled:    !!ch.enabled,
  };
}

function maskToken(t) {
  return t ? '••••' + String(t).slice(-4) : '';
}

function ensureStreaks() {
  for (const cat of CATEGORIES) {
    if (!state.streaks[cat.key]) state.streaks[cat.key] = freshStreak();
  }
}

ensureStreaks();

// ── Persistance ────────────────────────────────────────────────────────────

async function loadState() {
  try {
    const cfg = await db.getSetting('comptages_config');
    if (cfg) {
      try { state.config = { ...state.config, ...JSON.parse(cfg) }; } catch {}
    }
  } catch {}
  try {
    const raw = await db.getSetting('comptages_extra_channels');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.extraChannels = arr.map(normalizeChannel).filter(Boolean);
    }
  } catch {}
  try {
    const raw = await db.getSetting('comptages_state');
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.streaks) {
        for (const k of Object.keys(obj.streaks)) {
          state.streaks[k] = { ...freshStreak(), ...obj.streaks[k] };
        }
      }
      if (Array.isArray(obj?.processed)) {
        // ne garde que les ~5000 derniers numéros pour borner la taille
        state.processed = new Set(obj.processed.slice(-5000));
      }
      if (obj?.lastReportHourKey) state.lastReportHourKey = obj.lastReportHourKey;
    }
  } catch {}
  try {
    const raw = await db.getSetting('comptages_last_report');
    if (raw) state.lastReport = JSON.parse(raw);
  } catch {}
  ensureStreaks();
}

async function persistState() {
  try {
    await db.setSetting('comptages_state', JSON.stringify({
      streaks: state.streaks,
      processed: Array.from(state.processed).slice(-5000),
      lastReportHourKey: state.lastReportHourKey,
    }));
  } catch (e) {
    console.warn('[Comptages] persist error:', e.message);
  }
}

async function persistLastReport() {
  try {
    await db.setSetting('comptages_last_report',
      state.lastReport ? JSON.stringify(state.lastReport) : '');
  } catch {}
}

// ── Mise à jour des écarts pour un jeu terminé ─────────────────────────────

function buildContext(game) {
  const pCards = game.player_cards || [];
  const bCards = game.banker_cards || [];
  const np = pCards.length;
  const nb = bCards.length;
  const ps = handScore(pCards);
  const bs = handScore(bCards);
  const winner = game.winner || null;
  let winnerScore = null;
  if (winner === 'Player') winnerScore = ps;
  else if (winner === 'Banker') winnerScore = bs;
  else if (winner === 'Tie') winnerScore = ps; // ps === bs en théorie
  const suits = new Set([...suitsOf(pCards), ...suitsOf(bCards)]);
  return { np, nb, ps, bs, winner, winnerScore, suits };
}

function processGame(game) {
  if (!game || !game.is_finished) return false;
  const gn = game.game_number;
  if (gn == null || state.processed.has(gn)) return false;

  // On considère qu'une main est "exploitable" dès qu'on a au moins une carte
  // (sinon on ne peut rien dire de la distribution / du score).
  const np = (game.player_cards || []).length;
  const nb = (game.banker_cards || []).length;
  if (np === 0 && nb === 0) return false;

  ensureStreaks();
  const ctx = buildContext(game);

  for (const cat of CATEGORIES) {
    const s = state.streaks[cat.key];
    let hit = false;
    try { hit = !!cat.match(ctx); } catch { hit = false; }
    if (hit) {
      s.cur = 0;
    } else {
      s.cur += 1;
      if (s.cur > s.maxAll)    s.maxAll    = s.cur;
      if (s.cur > s.maxPeriod) s.maxPeriod = s.cur;
    }
  }

  state.processed.add(gn);
  return true;
}

// ── Construction du bilan ──────────────────────────────────────────────────

function buildSummary() {
  return CATEGORIES.map(cat => {
    const s = state.streaks[cat.key] || freshStreak();
    return {
      key: cat.key,
      group: cat.group,
      label: cat.label,
      cur: s.cur,
      maxPeriod: s.maxPeriod,
      maxAll: s.maxAll,
    };
  });
}

function fmtHourTitle(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  return `${dd}/${mm}/${yy} à ${hh}:00`;
}

function buildReportText(now, summary, prevSummary) {
  const lines = [];
  lines.push(`🕐 <b>Bilan horaire des écarts</b>`);
  lines.push(`<i>${fmtHourTitle(now)}</i>`);
  lines.push('');

  // Index pour comparer avec le précédent bilan
  const prevByKey = {};
  if (prevSummary && Array.isArray(prevSummary)) {
    for (const r of prevSummary) prevByKey[r.key] = r;
  }

  let currentGroup = null;
  for (const row of summary) {
    if (row.group !== currentGroup) {
      currentGroup = row.group;
      lines.push('');
      lines.push(`<b>${currentGroup}</b>`);
    }
    const prev = prevByKey[row.key];
    const prevMaxAll = prev ? prev.maxAll : 0;
    const newRecord = row.maxAll > prevMaxAll;
    const tag = newRecord ? '  📈 <b>nouveau record</b>' : '';
    // « écart période » = max écart observé depuis le dernier bilan
    // « max global » = plus grand écart jamais vu
    lines.push(
      `• ${row.label} — heure : <b>${row.maxPeriod}</b> | max : <b>${row.maxAll}</b>${tag}`
    );
  }

  // Petit rappel pédagogique de lecture
  lines.push('');
  lines.push(`<i>« heure » = plus grand écart de la dernière heure ; « max » = record toutes périodes confondues.</i>`);
  return lines.join('\n');
}

// ── Envoi Telegram ─────────────────────────────────────────────────────────

async function sendOne(bot_token, channel_id, text) {
  if (!bot_token || !channel_id) throw new Error('Bot token ou channel id manquant');
  const resp = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channel_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`Telegram HTTP ${resp.status} — ${errTxt.slice(0, 200)}`);
  }
  return resp.json();
}

// Envoie le bilan sur tous les canaux actifs (principal + extras).
// Retourne la liste des résultats par canal.
async function sendToAllChannels(text) {
  const targets = [];
  const cfg = state.config || {};
  if (cfg.enabled && cfg.bot_token && cfg.channel_id) {
    targets.push({ id: 'main', label: 'Canal principal', bot_token: cfg.bot_token, channel_id: cfg.channel_id });
  }
  for (const ch of (state.extraChannels || [])) {
    if (ch.enabled && ch.bot_token && ch.channel_id) {
      targets.push({ id: ch.id, label: ch.label || `Canal ${ch.channel_id}`, bot_token: ch.bot_token, channel_id: ch.channel_id });
    }
  }
  const results = [];
  for (const t of targets) {
    try { await sendOne(t.bot_token, t.channel_id, text); results.push({ id: t.id, label: t.label, sent: true }); }
    catch (e) { results.push({ id: t.id, label: t.label, sent: false, error: e.message }); }
  }
  return results;
}

// ── Bilan horaire ──────────────────────────────────────────────────────────

async function runReport(forced = false) {
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}`;
  if (!forced && state.lastReportHourKey === hourKey) return { skipped: true, reason: 'already-sent' };

  const summary = buildSummary();
  const prev = state.lastReport ? state.lastReport.summary : null;
  const text = buildReportText(now, summary, prev);

  // Envoi multi-canaux (principal + extras actifs)
  const sendResults = await sendToAllChannels(text);
  const sent = sendResults.some(r => r.sent);
  const sendError = sendResults.find(r => !r.sent && r.error)?.error || null;
  if (sendResults.length === 0) {
    console.log('[Comptages] aucun canal actif — bilan généré mais non envoyé');
  } else {
    for (const r of sendResults) {
      if (r.sent) console.log(`[Comptages] ✅ bilan envoyé sur ${r.label}`);
      else        console.warn(`[Comptages] ❌ envoi échoué sur ${r.label}: ${r.error}`);
    }
  }

  // Mémoriser ce bilan (pour comparaison) et reset du maxPeriod
  state.lastReport = { timestamp: now.toISOString(), summary, sent, error: sendError, channels: sendResults };
  for (const cat of CATEGORIES) {
    const s = state.streaks[cat.key];
    if (s) s.maxPeriod = 0;
  }
  if (!forced) state.lastReportHourKey = hourKey;
  await persistLastReport();
  await persistState();
  return { skipped: false, sent, error: sendError, text };
}

// ── Scheduler : déclenchement à chaque heure pile ──────────────────────────

let _schedTimer = null;
function startScheduler() {
  if (_schedTimer) return;
  // tick toutes les minutes : si on est à minute 0 et qu'on n'a pas encore
  // envoyé pour cette heure, on déclenche le bilan.
  _schedTimer = setInterval(() => {
    const now = new Date();
    if (now.getMinutes() !== 0) return;
    runReport(false).catch(e => console.warn('[Comptages] runReport error:', e.message));
  }, 60_000);
}

// ── Routes admin ───────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.session?.userId || !req.session?.isAdmin)
    return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

// Lecture seule — accessible aux comptes admin / Pro / Premium
function requireViewer(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ error: 'Non connecté' });
  if (req.session.isAdmin || req.session.isPro || req.session.isPremium) return next();
  return res.status(403).json({ error: 'Accès réservé aux comptes Premium / Pro / Admin' });
}

// Vue publique (lecture seule, sans config ni token) — admin / pro / premium
router.get('/view', requireViewer, (req, res) => {
  res.json({
    summary: buildSummary(),
    lastReport: state.lastReport,
    processedCount: state.processed.size,
  });
});

// Helper : liste des canaux qui recevront le bilan (sans tokens, pour affichage)
function listActiveChannelsPublic() {
  const out = [];
  const cfg = state.config || {};
  if (cfg.enabled && cfg.bot_token && cfg.channel_id) {
    out.push({ id: 'main', label: 'Canal principal', channel_id: cfg.channel_id, bot_token_masked: maskToken(cfg.bot_token), enabled: true });
  } else if (cfg.bot_token || cfg.channel_id) {
    out.push({ id: 'main', label: 'Canal principal', channel_id: cfg.channel_id || '—', bot_token_masked: maskToken(cfg.bot_token), enabled: !!cfg.enabled });
  }
  for (const ch of (state.extraChannels || [])) {
    out.push({ id: ch.id, label: ch.label || `Canal ${ch.channel_id}`, channel_id: ch.channel_id, bot_token_masked: maskToken(ch.bot_token), enabled: !!ch.enabled });
  }
  return out;
}

// Calcule la prochaine heure pile (à laquelle le bilan sera envoyé automatiquement)
function nextHourSchedule() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next.toISOString();
}

router.get('/', requireAdmin, (req, res) => {
  res.json({
    config: { ...state.config, bot_token: maskToken(state.config.bot_token) },
    extraChannels: (state.extraChannels || []).map(c => ({ ...c, bot_token: maskToken(c.bot_token) })),
    summary: buildSummary(),
    lastReport: state.lastReport,
    processedCount: state.processed.size,
    activeChannels: listActiveChannelsPublic(),
    nextScheduledAt: nextHourSchedule(),
  });
});

// Aperçu du prochain bilan — texte HTML formaté qui sera envoyé à l'heure pile
router.get('/preview', requireAdmin, (req, res) => {
  const now = new Date();
  const summary = buildSummary();
  const prev = state.lastReport ? state.lastReport.summary : null;
  const text = buildReportText(now, summary, prev);
  res.json({
    text,
    summary,
    activeChannels: listActiveChannelsPublic(),
    nextScheduledAt: nextHourSchedule(),
    processedCount: state.processed.size,
    lastReport: state.lastReport,
  });
});

router.post('/config', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id, enabled } = req.body || {};
    // Si bot_token est vide ou masqué (••••XXXX), on conserve l'ancien
    const newToken = (typeof bot_token === 'string' && bot_token && !bot_token.startsWith('••••'))
      ? bot_token.trim() : state.config.bot_token;
    state.config = {
      bot_token: newToken,
      channel_id: typeof channel_id === 'string' ? channel_id.trim() : state.config.channel_id,
      enabled: !!enabled,
    };
    await db.setSetting('comptages_config', JSON.stringify(state.config));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/test-report', requireAdmin, async (req, res) => {
  try {
    const r = await runReport(true);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Canaux Telegram supplémentaires ────────────────────────────────────────

// Liste complète (token masqué)
router.get('/extra-channels', requireAdmin, (req, res) => {
  res.json({
    channels: (state.extraChannels || []).map(c => ({ ...c, bot_token: maskToken(c.bot_token) })),
  });
});

// Création / mise à jour d'un canal supplémentaire
router.post('/extra-channels', requireAdmin, async (req, res) => {
  try {
    const { id, label, bot_token, channel_id, enabled } = req.body || {};
    const list = state.extraChannels || [];
    const existing = id ? list.find(c => c.id === id) : null;
    // Si bot_token est masqué (••••XXXX), on conserve l'ancien
    const newToken = (typeof bot_token === 'string' && bot_token && !bot_token.startsWith('••••'))
      ? bot_token.trim()
      : (existing ? existing.bot_token : '');
    const ch = normalizeChannel({
      id: existing ? existing.id : undefined,
      label: typeof label === 'string' ? label.trim() : (existing ? existing.label : ''),
      bot_token: newToken,
      channel_id: typeof channel_id === 'string' ? channel_id.trim() : (existing ? existing.channel_id : ''),
      enabled: typeof enabled === 'boolean' ? enabled : (existing ? existing.enabled : true),
    });
    if (!ch.bot_token || !ch.channel_id) {
      return res.status(400).json({ error: 'bot_token et channel_id requis' });
    }
    if (existing) Object.assign(existing, ch);
    else state.extraChannels = [...list, ch];
    await db.setSetting('comptages_extra_channels', JSON.stringify(state.extraChannels));
    res.json({ ok: true, channel: { ...ch, bot_token: maskToken(ch.bot_token) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suppression d'un canal supplémentaire
router.delete('/extra-channels/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    state.extraChannels = (state.extraChannels || []).filter(c => c.id !== id);
    await db.setSetting('comptages_extra_channels', JSON.stringify(state.extraChannels));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Envoi d'un bilan de test à UN seul canal (utile pour vérifier la config)
router.post('/extra-channels/:id/test', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    let target;
    if (id === 'main') {
      target = { bot_token: state.config.bot_token, channel_id: state.config.channel_id, label: 'Canal principal' };
    } else {
      const ch = (state.extraChannels || []).find(c => c.id === id);
      if (!ch) return res.status(404).json({ error: 'Canal introuvable' });
      target = ch;
    }
    if (!target.bot_token || !target.channel_id) {
      return res.status(400).json({ error: 'bot_token ou channel_id manquant' });
    }
    const now = new Date();
    const summary = buildSummary();
    const text = '🧪 <b>Test de canal Comptages</b>\n\n' + buildReportText(now, summary, null);
    await sendOne(target.bot_token, target.channel_id, text);
    res.json({ ok: true, label: target.label || target.channel_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reset', requireAdmin, async (req, res) => {
  try {
    state.streaks = {};
    state.processed = new Set();
    state.lastReport = null;
    state.lastReportHourKey = null;
    ensureStreaks();
    await persistState();
    await persistLastReport();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reset au jeu #1 (nouveau jour) ─────────────────────────────────────────
// Appelé par l'engine dans `_resetOnGameOne()` quand la séquence repart de 1.
async function onGameOneReset() {
  try {
    state.streaks = {};
    state.processed = new Set();
    state.lastReport = null;
    state.lastReportHourKey = null;
    ensureStreaks();
    await persistState();
    await persistLastReport();
    console.log('[Comptages] 🕛 Jeu #1 détecté → écarts remis à zéro (nouveau jour)');
  } catch (e) {
    console.warn('[Comptages] onGameOneReset error:', e.message);
  }
}

// ── Hook depuis l'engine ───────────────────────────────────────────────────
// L'engine appelle `comptages.onFinishedGame(game)` à chaque jeu terminé.
async function onFinishedGame(game) {
  try {
    const updated = processGame(game);
    if (updated) {
      // Persiste de manière paresseuse — pas après chaque jeu pour éviter le spam
      const now = Date.now();
      if (!onFinishedGame._lastSave || now - onFinishedGame._lastSave > 15_000) {
        onFinishedGame._lastSave = now;
        persistState().catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[Comptages] onFinishedGame error:', e.message);
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
let _started = false;
async function init() {
  if (_started) return;
  _started = true;
  await loadState();
  startScheduler();
  console.log('[Comptages] module initialisé');
}

module.exports = {
  router,
  init,
  onFinishedGame,
  onGameOneReset,
  runReport,
  buildSummary,
  CATEGORIES,
  // tests / debug
  _state: state,
  _processGame: processGame,
};
