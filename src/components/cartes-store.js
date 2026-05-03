// cartes-store.js
// ─────────────────────────────────────────────────────────────────────────────
// Module dédié à l'enregistrement des CARTES de chaque main de baccarat
// (joueur 1/2/3 + banquier 1/2/3) avec toutes les CATÉGORIES dérivées.
//
// • Base de données SÉPARÉE de l'application principale (`les_cartes`).
//   Connexion via la variable d'environnement `LES_CARTES_DATABASE_URL`.
//   Fallback : URL externe Singapore fournie par l'utilisateur.
//
// • Une table `cartes_jeu` enregistre, pour chaque numéro de jeu :
//     date, game_number,
//     p1_R/p1_S, p2_R/p2_S, p3_R/p3_S,
//     b1_R/b1_S, b2_R/b2_S, b3_R/b3_S,
//     winner, p_score, b_score, np, nb,
//     dist (2/2, 2/3, 3/2, 3/3),
//     p_high (>6.5), p_low (<4.5), b_high, b_low,
//     winner_pair, p_pair, b_pair
//
// • Une API utilitaire `cartesAPI` est exposée et passée aux scripts Pro
//   (sandbox JS) pour permettre :
//     - getCard(gameNumber, side, position) → { R, S }
//     - byGameNumber(n)                     → enregistrement complet
//     - byDate('YYYY-MM-DD')                → liste
//     - getNear(currentGn, h, p)            → cartes dans plage proche (live)
//     - zk(go, h)                           → numéro = go - h
//     - nlv(go, h)                          → numéro = go + h
//
// La fonction « proche de » : à la différence du « décalage » (qui fixe
// l'écart entre déclencheur et numéro à prédire), « proche de » se base sur le
// numéro EN LIVE et autorise une fenêtre de tolérance ±p.

const { Pool } = require('pg');

// ─── URL DE LA BASE `les_cartes` — HARDCODÉE ──────────────────────────────
// L'URL est intentionnellement écrite EN DUR ici (pas dans une variable
// d'environnement Render). Pour changer de DB, modifier cette ligne et
// redéployer.
const URL =
  'postgresql://les_cartes_user:W67e5gDzArVEgYqTk8eH1j2zacKQX3Jg' +
  '@dpg-d7phtjegvqtc73a9gbn0-a.singapore-postgres.render.com/les_cartes';

let pool = null;
let initialized = false;
let initPromise = null;

function getPool() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (e) => console.error('[CartesStore] pg error:', e.message));
  return pool;
}

async function init() {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS cartes_jeu (
        game_number   INTEGER PRIMARY KEY,
        date          DATE        NOT NULL DEFAULT CURRENT_DATE,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        p1_r TEXT, p1_s TEXT,
        p2_r TEXT, p2_s TEXT,
        p3_r TEXT, p3_s TEXT,
        b1_r TEXT, b1_s TEXT,
        b2_r TEXT, b2_s TEXT,
        b3_r TEXT, b3_s TEXT,
        winner   TEXT,
        p_score  INTEGER,
        b_score  INTEGER,
        np       INTEGER,
        nb       INTEGER,
        dist     TEXT,
        p_high   BOOLEAN,
        p_low    BOOLEAN,
        b_high   BOOLEAN,
        b_low    BOOLEAN,
        winner_pair BOOLEAN,
        p_pair      BOOLEAN,
        b_pair      BOOLEAN,
        raw       JSONB
      )
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_cartes_jeu_date ON cartes_jeu(date)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_cartes_jeu_winner ON cartes_jeu(winner)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_cartes_jeu_dist ON cartes_jeu(dist)`);
    initialized = true;
    console.log('[CartesStore] ✅ Table cartes_jeu prête (db=les_cartes)');
  })().catch((e) => {
    initPromise = null;
    console.error('[CartesStore] ❌ init error:', e.message);
    throw e;
  });
  return initPromise;
}

// ── Helpers de calcul ──────────────────────────────────────────────────────
function cardValue(c) {
  if (!c || c.R == null) return 0;
  let r = c.R;
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
  return cards.reduce((acc, c) => acc + cardValue(c), 0) % 10;
}

function normalizeSuit(s) {
  if (!s) return null;
  const m = { '♠️':'♠','♣️':'♣','♦️':'♦','♥️':'♥','❤️':'♥','❤':'♥' };
  return m[s] || s;
}

function deriveWinner(rawWinner, ps, bs, np, nb) {
  let w = (rawWinner || '').toString().trim().toLowerCase();
  if (w === 'tie' || w === 't' || w === 'égalité' || w === 'egalite' || w === 'match nul') return 'Tie';
  if (w === 'player' || w === 'p' || w === 'joueur') return 'Player';
  if (w === 'banker' || w === 'b' || w === 'banquier') return 'Banker';
  if (ps != null && bs != null && np >= 2 && nb >= 2) {
    if (ps === bs) return 'Tie';
    return ps > bs ? 'Player' : 'Banker';
  }
  return null;
}

// ── Enregistrement d'un jeu terminé ────────────────────────────────────────
async function recordGame(game) {
  if (!game || !game.is_finished || game.game_number == null) return false;
  try {
    await init();
  } catch { return false; }
  const p = getPool();

  const pCards = game.player_cards || [];
  const bCards = game.banker_cards || [];
  const np = pCards.length;
  const nb = bCards.length;
  const ps = handScore(pCards);
  const bs = handScore(bCards);
  const winner = deriveWinner(game.winner, ps, bs, np, nb);
  const winScore = winner === 'Player' ? ps : winner === 'Banker' ? bs : (winner === 'Tie' ? ps : null);
  const dist = (np >= 2 && nb >= 2) ? `${Math.min(np,3)}/${Math.min(nb,3)}` : null;

  const slot = (cards, idx) => {
    const c = cards[idx];
    return {
      r: c?.R != null ? String(c.R) : null,
      s: c?.S != null ? normalizeSuit(c.S) : null,
    };
  };
  const p1 = slot(pCards, 0), p2 = slot(pCards, 1), p3 = slot(pCards, 2);
  const b1 = slot(bCards, 0), b2 = slot(bCards, 1), b3 = slot(bCards, 2);

  try {
    await p.query(
      `INSERT INTO cartes_jeu (
         game_number, date, ts,
         p1_r, p1_s, p2_r, p2_s, p3_r, p3_s,
         b1_r, b1_s, b2_r, b2_s, b3_r, b3_s,
         winner, p_score, b_score, np, nb, dist,
         p_high, p_low, b_high, b_low,
         winner_pair, p_pair, b_pair, raw
       ) VALUES (
         $1, CURRENT_DATE, NOW(),
         $2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,
         $24,$25,$26,$27
       )
       ON CONFLICT (game_number) DO UPDATE SET
         p1_r=EXCLUDED.p1_r, p1_s=EXCLUDED.p1_s,
         p2_r=EXCLUDED.p2_r, p2_s=EXCLUDED.p2_s,
         p3_r=EXCLUDED.p3_r, p3_s=EXCLUDED.p3_s,
         b1_r=EXCLUDED.b1_r, b1_s=EXCLUDED.b1_s,
         b2_r=EXCLUDED.b2_r, b2_s=EXCLUDED.b2_s,
         b3_r=EXCLUDED.b3_r, b3_s=EXCLUDED.b3_s,
         winner=EXCLUDED.winner, p_score=EXCLUDED.p_score, b_score=EXCLUDED.b_score,
         np=EXCLUDED.np, nb=EXCLUDED.nb, dist=EXCLUDED.dist,
         p_high=EXCLUDED.p_high, p_low=EXCLUDED.p_low,
         b_high=EXCLUDED.b_high, b_low=EXCLUDED.b_low,
         winner_pair=EXCLUDED.winner_pair, p_pair=EXCLUDED.p_pair, b_pair=EXCLUDED.b_pair,
         raw=EXCLUDED.raw`,
      [
        game.game_number,
        p1.r, p1.s, p2.r, p2.s, p3.r, p3.s,
        b1.r, b1.s, b2.r, b2.s, b3.r, b3.s,
        winner, ps, bs, np, nb, dist,
        ps != null ? ps >= 7 : null,
        ps != null ? ps <= 4 : null,
        bs != null ? bs >= 7 : null,
        bs != null ? bs <= 4 : null,
        winScore != null ? (winScore % 2 === 0) : null,
        ps != null ? (ps % 2 === 0) : null,
        bs != null ? (bs % 2 === 0) : null,
        JSON.stringify({ player_cards: pCards, banker_cards: bCards, raw_winner: game.winner }),
      ]
    );
    return true;
  } catch (e) {
    console.warn('[CartesStore] recordGame fail:', e.message);
    return false;
  }
}

// ── Lectures ───────────────────────────────────────────────────────────────
async function byGameNumber(gn) {
  if (gn == null) return null;
  try { await init(); } catch { return null; }
  const r = await getPool().query('SELECT * FROM cartes_jeu WHERE game_number = $1', [Number(gn)]);
  return r.rows[0] || null;
}

async function byDate(dateStr) {
  if (!dateStr) return [];
  try { await init(); } catch { return []; }
  const r = await getPool().query('SELECT * FROM cartes_jeu WHERE date = $1::date ORDER BY game_number ASC', [dateStr]);
  return r.rows;
}

async function listRecent(limit = 100, filters = {}) {
  try { await init(); } catch { return []; }
  const conds = []; const params = []; let i = 1;
  if (filters.date)        { conds.push(`date = $${i++}::date`); params.push(filters.date); }
  if (filters.winner)      { conds.push(`winner = $${i++}`);     params.push(filters.winner); }
  if (filters.dist)        { conds.push(`dist = $${i++}`);       params.push(filters.dist); }
  if (filters.gameNumber)  { conds.push(`game_number = $${i++}`); params.push(Number(filters.gameNumber)); }
  if (filters.fromGn)      { conds.push(`game_number >= $${i++}`); params.push(Number(filters.fromGn)); }
  if (filters.toGn)        { conds.push(`game_number <= $${i++}`); params.push(Number(filters.toGn)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(Math.max(1, Math.min(1000, parseInt(limit) || 100)));
  const r = await getPool().query(
    `SELECT * FROM cartes_jeu ${where} ORDER BY game_number DESC LIMIT $${i}`,
    params
  );
  return r.rows;
}

async function statsGlobal() {
  try { await init(); } catch { return null; }
  const r = await getPool().query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE winner = 'Player') AS win_p,
      COUNT(*) FILTER (WHERE winner = 'Banker') AS win_b,
      COUNT(*) FILTER (WHERE winner = 'Tie')    AS win_tie,
      COUNT(*) FILTER (WHERE dist = '2/2') AS d22,
      COUNT(*) FILTER (WHERE dist = '2/3') AS d23,
      COUNT(*) FILTER (WHERE dist = '3/2') AS d32,
      COUNT(*) FILTER (WHERE dist = '3/3') AS d33,
      COUNT(*) FILTER (WHERE np = 2) AS p_2k,
      COUNT(*) FILTER (WHERE np = 3) AS p_3k,
      COUNT(*) FILTER (WHERE nb = 2) AS b_2k,
      COUNT(*) FILTER (WHERE nb = 3) AS b_3k,
      COUNT(*) FILTER (WHERE p_high) AS p_high,
      COUNT(*) FILTER (WHERE p_low)  AS p_low,
      COUNT(*) FILTER (WHERE b_high) AS b_high,
      COUNT(*) FILTER (WHERE b_low)  AS b_low,
      COUNT(*) FILTER (WHERE winner_pair) AS w_pair,
      COUNT(*) FILTER (WHERE NOT winner_pair) AS w_imp,
      COUNT(*) FILTER (WHERE p_pair) AS p_pair,
      COUNT(*) FILTER (WHERE NOT p_pair) AS p_imp,
      COUNT(*) FILTER (WHERE b_pair) AS b_pair,
      COUNT(*) FILTER (WHERE NOT b_pair) AS b_imp,
      MIN(game_number) AS gn_min,
      MAX(game_number) AS gn_max
    FROM cartes_jeu
  `);
  return r.rows[0] || null;
}

// ── API exposée aux scripts Pro (sandbox JS) ───────────────────────────────
//
// Mode « décalage »  : on connaît l'écart entre le déclencheur et la cible
//                       (target = trigger + decalage). Comportement classique.
//
// Mode « proche de » : la cible est un numéro proche du numéro EN LIVE,
//                       avec une fenêtre de tolérance ±p. La carte source
//                       (zk) est lue à `go - h` (h = recul), et on prédit
//                       autour de `go + p`.
//
// Variables suggérées dans les scripts :
//   const live = ctx.live.gameNumber;            // numéro EN LIVE
//   const go   = live + p;                       // numéro à prédire
//   const zk   = go - h;                         // numéro source (back-look)
//   const card = await ctx.cartes.getCard(zk, 'player', 1);
//   return { suit: card.s, mode: 'proche', p };
function buildCartesAPI(ctx = {}) {
  const liveGn = ctx.liveGameNumber || null;
  return {
    // Lecture brute
    byGameNumber: async (gn) => byGameNumber(gn),
    byDate:       async (d)  => byDate(d),
    listRecent:   async (limit, filters) => listRecent(limit, filters),

    // Helper pratique : récupère UNE carte d'un jeu donné
    //   side     : 'player' | 'banker' | 'p' | 'b'
    //   position : 1 | 2 | 3
    getCard: async (gn, side, position) => {
      const row = await byGameNumber(gn);
      if (!row) return null;
      const sd = String(side || '').toLowerCase();
      const isP = sd === 'player' || sd === 'p' || sd === 'joueur' || sd === 'j';
      const idx = Math.max(1, Math.min(3, parseInt(position) || 1));
      const r = row[`${isP ? 'p' : 'b'}${idx}_r`];
      const s = row[`${isP ? 'p' : 'b'}${idx}_s`];
      if (r == null && s == null) return null;
      return { R: r, S: s };
    },

    // Recherche dans une plage proche d'un numéro de référence (par défaut le live)
    //   p : tolérance en avant / arrière (entier ≥ 0)
    getNear: async (p = 2, refGn = null) => {
      const ref = refGn != null ? Number(refGn) : liveGn;
      if (ref == null) return [];
      const a = ref - p, b = ref + p;
      try { await init(); } catch { return []; }
      const r = await getPool().query(
        'SELECT * FROM cartes_jeu WHERE game_number BETWEEN $1 AND $2 ORDER BY ABS(game_number - $3) ASC',
        [a, b, ref]
      );
      return r.rows;
    },

    // Helpers de notation de l'utilisateur :
    //   zk(go, h)  → numéro où LIRE la carte source       (= go - h)
    //   nlv(go, h) → numéro EN LIVE théorique correspondant (= go + h)
    zk:  (go, h) => Number(go) - Number(h),
    nlv: (go, h) => Number(go) + Number(h),

    // Numéro EN LIVE courant (utile pour le mode "proche de")
    liveGameNumber: liveGn,
  };
}

module.exports = {
  init,
  recordGame,
  byGameNumber,
  byDate,
  listRecent,
  statsGlobal,
  buildCartesAPI,
};
