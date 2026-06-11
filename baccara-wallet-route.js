'use strict';
/**
 * baccara-wallet-route.js — Wallet virtuel + mises Baccara Kouamé
 *
 * Tables : baccara_wallets, baccara_bets, baccara_fund_requests
 */

const express = require('express');
const router  = express.Router();

function requireLogin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}
function getPool() {
  try { return require('./db').pool; } catch { return null; }
}
function getCardsPool() {
  try { return require('./db').pgPoolCards; } catch { return null; }
}

// ── Cotes ─────────────────────────────────────────────────────────────────────
const ODDS = {
  // 1X2
  player: 2.10, banker: 2.15, tie: 8.00,
  // Paires
  player_pair: 11.00, banker_pair: 11.00,
  // Enseigne Joueur (♠♣♦♥)
  suit_p_S: 1.90, suit_p_C: 1.90, suit_p_D: 1.90, suit_p_H: 1.90,
  // Enseigne Banquier
  suit_b_S: 1.90, suit_b_C: 1.90, suit_b_D: 1.90, suit_b_H: 1.90,
  // Valeur Joueur (R = '1'..'13')
  val_p_r1: 5.40, val_p_r2: 5.40, val_p_r3: 5.40, val_p_r4: 5.40,
  val_p_r5: 5.40, val_p_r6: 5.40, val_p_r7: 5.40, val_p_r8: 5.40,
  val_p_r9: 5.40, val_p_r10:5.40, val_p_r11:5.40, val_p_r12:5.40, val_p_r13:5.40,
  // Valeur Banquier
  val_b_r1: 5.40, val_b_r2: 5.40, val_b_r3: 5.40, val_b_r4: 5.40,
  val_b_r5: 5.40, val_b_r6: 5.40, val_b_r7: 5.40, val_b_r8: 5.40,
  val_b_r9: 5.40, val_b_r10:5.40, val_b_r11:5.40, val_b_r12:5.40, val_b_r13:5.40,
  // Combinaisons de cartes (J:nb / B:nb)
  cards_2_2: 2.40, cards_2_3: 8.00, cards_3_2: 2.30, cards_3_3: 2.40,
  // Joueur reçoit exactement 2 cartes
  player_2cards: 1.95, player_3cards: 1.95,
  // Pair/Impair score Joueur
  p_score_even: 1.91, p_score_odd: 1.91,
  // Pair/Impair total (Joueur + Banquier)
  total_even: 1.95, total_odd: 1.95,
  // Total (somme des scores baccarat)
  total_o7:  1.54, total_u7:  2.47,
  total_o8:  1.78, total_u8:  2.10,
  total_o9:  2.10, total_u9:  1.75,
  total_o10: 2.48, total_u10: 1.54,
  total_o11: 3.07, total_u11: 1.36,
  total_o12: 4.50, total_u12: 1.20,
  // Fin naturelle
  natural:    2.05, no_natural:  1.78,
  // Banquier 3ème carte
  banker_third:  2.30, no_banker_third: 1.60,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function cv(R){ const r=parseInt(R); return (isNaN(r)||r>=10)?0:r; }
function score(cards){ return cards.reduce((s,c)=>s+cv(c.R),0)%10; }
// Normalise les enseignes : supprime le sélecteur de variation U+FE0F (♥️ → ♥)
function ns(s){ return s ? String(s).replace(/\uFE0F/g,'') : ''; }

// ── Cache persistant des jeux terminés ────────────────────────────────────────
// Clé = game_number (int), valeur = { winner, player_cards, banker_cards }
const _finishedGamesMap = new Map();
const MAX_FG_CACHE = 200;

/**
 * Appelé par games.js chaque fois qu'un jeu terminé est détecté dans le cache.
 * Stocke le résultat dans _finishedGamesMap ET dans baccara_finished_games (DB).
 */
function notifyGameResult(game) {
  if (!game || !game.game_number || !game.winner || !game.is_finished) return;
  if (_finishedGamesMap.has(game.game_number)) return; // déjà enregistré
  const entry = {
    winner:       game.winner,
    player_cards: game.player_cards || [],
    banker_cards: game.banker_cards || [],
    is_finished:  true,
  };
  _finishedGamesMap.set(game.game_number, entry);
  // Purge si le cache grossit trop
  if (_finishedGamesMap.size > MAX_FG_CACHE) {
    const oldest = [..._finishedGamesMap.keys()].sort((a,b)=>a-b)[0];
    _finishedGamesMap.delete(oldest);
  }
  // Persister en DB (async, silencieux)
  const pool = getPool();
  if (pool) {
    pool.query(
      `INSERT INTO baccara_finished_games(game_number,winner,player_cards,banker_cards)
       VALUES($1,$2,$3,$4) ON CONFLICT(game_number) DO NOTHING`,
      [game.game_number, game.winner,
       JSON.stringify(entry.player_cards), JSON.stringify(entry.banker_cards)]
    ).catch(()=>{});
  }
}

// ── Résolution d'une mise ─────────────────────────────────────────────────────
function evalBet(type, game) {
  const { winner, player_cards:pc=[], banker_cards:bc=[] } = game;
  if (!winner) return null;

  const pS = score(pc), bS = score(bc), tot = pS + bS;

  switch(type) {
    // 1X2
    case 'player':  return winner === 'Player';
    case 'banker':  return winner === 'Banker';
    case 'tie':     return winner === 'Tie';
    // Paires
    case 'player_pair': return pc.length>=2 && pc[0].R===pc[1].R;
    case 'banker_pair': return bc.length>=2 && bc[0].R===bc[1].R;
    // Enseigne Joueur — ns() supprime le sélecteur de variation ️ (U+FE0F)
    case 'suit_p_H': return pc.some(c=>ns(c.S)==='♥');
    case 'suit_p_D': return pc.some(c=>ns(c.S)==='♦');
    case 'suit_p_S': return pc.some(c=>ns(c.S)==='♠');
    case 'suit_p_C': return pc.some(c=>ns(c.S)==='♣');
    // Enseigne Banquier
    case 'suit_b_H': return bc.some(c=>ns(c.S)==='♥');
    case 'suit_b_D': return bc.some(c=>ns(c.S)==='♦');
    case 'suit_b_S': return bc.some(c=>ns(c.S)==='♠');
    case 'suit_b_C': return bc.some(c=>ns(c.S)==='♣');
    // Combinaisons cartes
    case 'cards_2_2': return pc.length===2&&bc.length===2;
    case 'cards_2_3': return pc.length===2&&bc.length===3;
    case 'cards_3_2': return pc.length===3&&bc.length===2;
    case 'cards_3_3': return pc.length===3&&bc.length===3;
    // Total
    case 'total_o7':  return tot>7;
    case 'total_u7':  return tot<=7;
    case 'total_o8':  return tot>8;
    case 'total_u8':  return tot<=8;
    case 'total_o9':  return tot>9;
    case 'total_u9':  return tot<=9;
    case 'total_o10': return tot>10;
    case 'total_u10': return tot<=10;
    case 'total_o11': return tot>11;
    case 'total_u11': return tot<=11;
    case 'total_o12': return tot>12;
    case 'total_u12': return tot<=12;
    // Joueur reçoit exactement 2 ou 3 cartes
    case 'player_2cards':   return pc.length===2;
    case 'player_3cards':   return pc.length===3;
    // Pair/Impair score Joueur (0,2,4,6,8 = pair ; 1,3,5,7,9 = impair)
    case 'p_score_even':    return pS%2===0;
    case 'p_score_odd':     return pS%2!==0;
    // Pair/Impair total (somme points joueur + banquier)
    case 'total_even':      return (pS+bS)%2===0;
    case 'total_odd':       return (pS+bS)%2!==0;
    // Fin naturelle
    case 'natural':         return pc.length===2&&bc.length===2;
    case 'no_natural':      return pc.length>2||bc.length>2;
    // Banquier 3ème carte
    case 'banker_third':    return bc.length===3;
    case 'no_banker_third': return bc.length===2;
    default:
      // Valeur Joueur : val_p_rN (R = '1'..'13' en string)
      if (type.startsWith('val_p_r')) { const r=type.slice(7); return pc.some(c=>String(c.R)===r); }
      // Valeur Banquier : val_b_rN
      if (type.startsWith('val_b_r')) { const r=type.slice(7); return bc.some(c=>String(c.R)===r); }
      return false;
  }
}

// ── Init tables ───────────────────────────────────────────────────────────────
async function ensureTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS baccara_wallets (
      user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'XOF',
      balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, currency)
    );
    CREATE TABLE IF NOT EXISTS baccara_bets (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      game_number   INTEGER NOT NULL,
      bet_type      TEXT NOT NULL,
      amount        NUMERIC(14,2) NOT NULL,
      currency      TEXT NOT NULL,
      potential_win NUMERIC(14,2) NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      win_amount    NUMERIC(14,2) DEFAULT 0,
      actual_winner TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      resolved_at   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS baccara_bets_user_idx   ON baccara_bets(user_id);
    CREATE INDEX IF NOT EXISTS baccara_bets_status_idx ON baccara_bets(status);
    CREATE TABLE IF NOT EXISTS baccara_fund_requests (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount          NUMERIC(14,2) NOT NULL,
      currency        TEXT NOT NULL,
      note            TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      approved_amount NUMERIC(14,2),
      admin_note      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS baccara_fund_req_user_idx ON baccara_fund_requests(user_id);
    CREATE TABLE IF NOT EXISTS baccara_finished_games (
      game_number   INTEGER PRIMARY KEY,
      winner        TEXT NOT NULL,
      player_cards  JSONB NOT NULL DEFAULT '[]',
      banker_cards  JSONB NOT NULL DEFAULT '[]',
      saved_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

let _tablesReady = false;
async function withTables(pool) {
  if (_tablesReady) return;
  try { await ensureTables(pool); _tablesReady = true; }
  catch(e) { console.warn('[BaccaraWallet] ensureTables:', e.message); }
}

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get('/me', requireLogin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.json({ balance:0, currency:'XOF', pending_bets:[], history:[], fund_requests:[] });
  await withTables(pool);
  const userId = req.session.userId;
  const currency = req.query.currency || 'XOF';
  try {
    // Assurer ligne wallet
    await pool.query(
      `INSERT INTO baccara_wallets(user_id,currency,balance) VALUES($1,$2,0) ON CONFLICT DO NOTHING`,
      [userId, currency]
    );
    // Résoudre les mises en attente
    try {
      const { getGamesCache } = require('./games');
      const liveCache = getGamesCache() || [];
      // Construire une map unifiée : cache live + cache persistant des jeux terminés
      const gameMap = new Map();
      for (const g of liveCache) if (g.game_number) gameMap.set(g.game_number, g);
      for (const [gn, g] of _finishedGamesMap) if (!gameMap.has(gn)) gameMap.set(gn, g);

      const pending = await pool.query(`SELECT * FROM baccara_bets WHERE user_id=$1 AND status='pending'`,[userId]);
      if (pending.rows.length > 0) {
        // Trouver les jeux manquants dans la map (pas en mémoire) et les chercher en DB
        const missingGNs = [...new Set(
          pending.rows.map(b=>b.game_number).filter(gn=>!gameMap.has(gn))
        )];
        if (missingGNs.length > 0) {
          // 1. Chercher dans baccara_finished_games (table dédiée, pool principal)
          try {
            const fgRes = await pool.query(
              `SELECT game_number, winner, player_cards, banker_cards
               FROM baccara_finished_games WHERE game_number = ANY($1)`,
              [missingGNs]
            );
            for (const r of fgRes.rows) {
              let pc = r.player_cards, bc = r.banker_cards;
              if (typeof pc === 'string') try { pc = JSON.parse(pc); } catch { pc=[]; }
              if (typeof bc === 'string') try { bc = JSON.parse(bc); } catch { bc=[]; }
              gameMap.set(r.game_number, { winner:r.winner, player_cards:pc||[], banker_cards:bc||[], is_finished:true });
            }
          } catch(_) {}

          // 2. Fallback : chercher dans game_cards (base cartes Singapore)
          const stillMissing = missingGNs.filter(gn => !gameMap.has(gn));
          if (stillMissing.length > 0) {
            const cardsPool = getCardsPool();
            if (cardsPool) {
              try {
                const gcRes = await cardsPool.query(
                  `SELECT DISTINCT ON (game_number) game_number, winner, player_cards, banker_cards
                   FROM game_cards WHERE game_number = ANY($1) AND winner IS NOT NULL
                   ORDER BY game_number, id DESC`,
                  [stillMissing]
                );
                for (const r of gcRes.rows) {
                  let pc = r.player_cards, bc = r.banker_cards;
                  if (typeof pc === 'string') try { pc = JSON.parse(pc); } catch { pc=[]; }
                  if (typeof bc === 'string') try { bc = JSON.parse(bc); } catch { bc=[]; }
                  gameMap.set(r.game_number, { winner:r.winner, player_cards:pc||[], banker_cards:bc||[], is_finished:true });
                  // Mettre en cache dans baccara_finished_games pour éviter de requery
                  pool.query(
                    `INSERT INTO baccara_finished_games(game_number,winner,player_cards,banker_cards)
                     VALUES($1,$2,$3,$4) ON CONFLICT(game_number) DO NOTHING`,
                    [r.game_number, r.winner, JSON.stringify(pc||[]), JSON.stringify(bc||[])]
                  ).catch(()=>{});
                }
              } catch(gcErr) {
                console.warn('[BaccaraWallet] Erreur lecture game_cards (cards DB):', gcErr.message);
              }
            }
          }
        }

        // Limite d'expiration : 10 minutes sans résolution
        const expireMs = 10 * 60 * 1000;
        const now = Date.now();

        for (const bet of pending.rows) {
          const game = gameMap.get(bet.game_number);
          if (!game || !game.is_finished || !game.winner) {
            // Jeu introuvable partout — expirer après 10 min
            const age = now - new Date(bet.created_at).getTime();
            if (age > expireMs) {
              await pool.query(
                `UPDATE baccara_bets SET status='expired',resolved_at=NOW() WHERE id=$1`,
                [bet.id]
              );
              console.log(`[BaccaraWallet] Mise #${bet.id} (jeu ${bet.game_number}) expirée après 10min`);
            }
            continue;
          }
          const won = evalBet(bet.bet_type, game);
          if (won === null) continue;
          const odd = ODDS[bet.bet_type] || 1;
          const winAmount = won ? Math.floor(parseFloat(bet.amount) * odd) : 0;
          await pool.query(
            `UPDATE baccara_bets SET status=$1,win_amount=$2,resolved_at=NOW(),actual_winner=$3 WHERE id=$4`,
            [won?'won':'lost', winAmount, game.winner, bet.id]
          );
          if (won) {
            await pool.query(
              `UPDATE baccara_wallets SET balance=balance+$1 WHERE user_id=$2 AND currency=$3`,
              [winAmount, userId, bet.currency]
            );
          }
        }
      }
    } catch(e) { console.warn('[BaccaraWallet] resolve bets:', e.message); }
    // Données fraiches
    const wRes = await pool.query(
      `SELECT balance FROM baccara_wallets WHERE user_id=$1 AND currency=$2`,[userId,currency]
    );
    const balance = parseFloat(wRes.rows[0]?.balance||0);
    const pRes = await pool.query(
      `SELECT * FROM baccara_bets WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC`,[userId]
    );
    const hRes = await pool.query(
      `SELECT * FROM baccara_bets WHERE user_id=$1 AND status!='pending' ORDER BY resolved_at DESC LIMIT 50`,[userId]
    );
    const fRes = await pool.query(
      `SELECT * FROM baccara_fund_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`,[userId]
    );
    res.json({ balance, currency, pending_bets:pRes.rows, history:hRes.rows, fund_requests:fRes.rows });
  } catch(e) {
    console.error('[BaccaraWallet] /me:', e.message);
    res.status(500).json({ error:e.message });
  }
});

// ── POST /bet ─────────────────────────────────────────────────────────────────
router.post('/bet', requireLogin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error:'DB indisponible' });
  await withTables(pool);
  const userId = req.session.userId;
  const { bet_type, amount, currency, game_number } = req.body;
  const odd = ODDS[bet_type] ?? (bet_type?.startsWith('val_')?2.50:null);
  if (!odd)        return res.status(400).json({ error:'Type de mise invalide' });
  if (!amount||amount<=0) return res.status(400).json({ error:'Montant invalide' });
  if (!currency)   return res.status(400).json({ error:'Devise manquante' });
  if (!game_number)return res.status(400).json({ error:'Numéro de jeu manquant' });
  // Vérifier que les cartes ne sont pas encore distribuées pour ce jeu
  try {
    const { getGamesCache } = require('./games');
    const liveGames = getGamesCache() || [];
    const targetGame = liveGames.find(g => g.game_number === parseInt(game_number));
    if (targetGame) {
      const pc = targetGame.player_cards || [];
      const bc = targetGame.banker_cards || [];
      if (targetGame.is_finished) return res.status(400).json({ error:'Ce jeu est terminé — paris fermés' });
      if (pc.length > 0 || bc.length > 0) return res.status(400).json({ error:'Distribution commencée — paris fermés' });
    }
  } catch(_) {}
  try {
    const wRes = await pool.query(`SELECT balance FROM baccara_wallets WHERE user_id=$1 AND currency=$2`,[userId,currency]);
    const balance = parseFloat(wRes.rows[0]?.balance||0);
    if (balance < parseFloat(amount)) return res.status(400).json({ error:'Solde insuffisant', balance });
    // Doublons
    const dup = await pool.query(
      `SELECT id FROM baccara_bets WHERE user_id=$1 AND game_number=$2 AND bet_type=$3 AND status='pending'`,
      [userId,game_number,bet_type]
    );
    if (dup.rows.length) return res.status(400).json({ error:'Mise déjà placée pour ce type sur ce jeu' });
    // Déduire
    await pool.query(`UPDATE baccara_wallets SET balance=balance-$1 WHERE user_id=$2 AND currency=$3`,[amount,userId,currency]);
    const potential = Math.floor(parseFloat(amount)*odd);
    const betRes = await pool.query(
      `INSERT INTO baccara_bets(user_id,game_number,bet_type,amount,currency,potential_win) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId,game_number,bet_type,amount,currency,potential]
    );
    const nWRes = await pool.query(`SELECT balance FROM baccara_wallets WHERE user_id=$1 AND currency=$2`,[userId,currency]);
    res.json({ ok:true, bet:betRes.rows[0], balance:parseFloat(nWRes.rows[0]?.balance||0) });
  } catch(e) {
    console.error('[BaccaraWallet] /bet:', e.message);
    res.status(500).json({ error:e.message });
  }
});

// ── POST /fund-request ────────────────────────────────────────────────────────
router.post('/fund-request', requireLogin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error:'DB indisponible' });
  await withTables(pool);
  const userId = req.session.userId;
  const { amount, currency, note } = req.body;
  if (!amount||parseFloat(amount)<=0) return res.status(400).json({ error:'Montant invalide' });
  if (!currency) return res.status(400).json({ error:'Devise manquante' });
  try {
    const ex = await pool.query(`SELECT id FROM baccara_fund_requests WHERE user_id=$1 AND status='pending' LIMIT 1`,[userId]);
    if (ex.rows.length) return res.status(400).json({ error:'Vous avez déjà une demande en attente.' });
    const r = await pool.query(
      `INSERT INTO baccara_fund_requests(user_id,amount,currency,note) VALUES($1,$2,$3,$4) RETURNING *`,
      [userId,amount,currency,note||null]
    );
    res.json({ ok:true, request:r.rows[0] });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── GET /fund-requests ────────────────────────────────────────────────────────
router.get('/fund-requests', requireLogin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.json([]);
  await withTables(pool);
  try {
    const r = await pool.query(`SELECT * FROM baccara_fund_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,[req.session.userId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
router.get('/admin/fund-requests', requireAdmin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.json([]);
  await withTables(pool);
  try {
    const r = await pool.query(`
      SELECT r.*,u.username,u.first_name,u.last_name FROM baccara_fund_requests r
      JOIN users u ON r.user_id=u.id
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/admin/fund-requests/:id/approve', requireAdmin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error:'DB indisponible' });
  await withTables(pool);
  const reqId = parseInt(req.params.id);
  try {
    const r = await pool.query(`SELECT * FROM baccara_fund_requests WHERE id=$1`,[reqId]);
    if (!r.rows[0]) return res.status(404).json({ error:'Introuvable' });
    const request = r.rows[0];
    const amt = parseFloat(req.body.amount||request.amount);
    await pool.query(
      `INSERT INTO baccara_wallets(user_id,currency,balance) VALUES($1,$2,$3)
       ON CONFLICT(user_id,currency) DO UPDATE SET balance=baccara_wallets.balance+EXCLUDED.balance`,
      [request.user_id,request.currency,amt]
    );
    await pool.query(
      `UPDATE baccara_fund_requests SET status='approved',approved_amount=$1,admin_note=$2,resolved_at=NOW() WHERE id=$3`,
      [amt, req.body.admin_note||null, reqId]
    );
    res.json({ ok:true, credited:amt, currency:request.currency });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

router.post('/admin/fund-requests/:id/reject', requireAdmin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error:'DB indisponible' });
  await withTables(pool);
  try {
    await pool.query(
      `UPDATE baccara_fund_requests SET status='rejected',admin_note=$1,resolved_at=NOW() WHERE id=$2`,
      [req.body.admin_note||null, parseInt(req.params.id)]
    );
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── DELETE /bets/:id — supprimer une mise résolue de l'historique ────────────
router.delete('/bets/:id', requireLogin, async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error:'DB indisponible' });
  await withTables(pool);
  const betId = parseInt(req.params.id);
  const userId = req.session.userId;
  if (!betId) return res.status(400).json({ error:'ID invalide' });
  try {
    const r = await pool.query(
      `SELECT id, status FROM baccara_bets WHERE id=$1 AND user_id=$2`,
      [betId, userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error:'Mise introuvable' });
    if (r.rows[0].status === 'pending') return res.status(400).json({ error:'Impossible de supprimer une mise en attente' });
    await pool.query(`DELETE FROM baccara_bets WHERE id=$1 AND user_id=$2`, [betId, userId]);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── GET /past-games — historique des jeux terminés (50 derniers) ──────────────
router.get('/past-games', requireLogin, async (req, res) => {
  try {
    // 1. Depuis le cache persistant en mémoire (plus récent)
    const fromMem = [..._finishedGamesMap.entries()]
      .sort((a,b)=>b[0]-a[0])
      .slice(0, 80)
      .map(([gn, g]) => ({ game_number:gn, ...g }));

    // 2. Depuis la DB game_cards si disponible (fallback + complément)
    let fromDb = [];
    try {
      const { getLastGameCards } = require('./db');
      const rows = await getLastGameCards('', 80);
      if (rows && rows.length) {
        fromDb = rows.map(r => ({
          game_number:  r.game_number,
          winner:       r.winner,
          player_cards: r.player_cards || [],
          banker_cards: r.banker_cards || [],
          is_finished:  true,
        }));
      }
    } catch(_) {}

    // Fusionner : mémoire prioritaire, DB en supplément
    const seen = new Set(fromMem.map(g=>g.game_number));
    const merged = [...fromMem, ...fromDb.filter(g=>!seen.has(g.game_number))]
      .sort((a,b)=>b.game_number-a.game_number)
      .slice(0, 100);

    res.json(merged);
  } catch(e) {
    res.status(500).json({ error:e.message });
  }
});

module.exports = router;
module.exports.notifyGameResult = notifyGameResult;
