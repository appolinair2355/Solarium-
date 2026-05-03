'use strict';
/**
 * annonce-sequence.js — Rotateur Promo
 *
 * Logique complète :
 *  1. L'admin définit combien de temps (annonce_duration) chaque stratégie est active.
 *  2. Quand une stratégie change → envoi immédiat d'un message "🚀 Démarrage de la stratégie [Nom]".
 *  3. Pendant son activité → envoi d'annonces promotionnelles toutes les annonce_interval minutes.
 *  4. La rotation suit l'ordre : S1 → S2 → S3 → … → S1 → …
 */

const db = require('./db');

let _timer = null;
// État par rotateur : { currentIndex, stratStartedAt, lastPromoSentAt, initialized }
let _state = {};

// ── Message de DÉMARRAGE — envoyé lors d'un changement de stratégie ──────────
function buildStartMessage(feat, orderNum, totalCount, durationMin) {
  const name = (feat?.name || 'Stratégie').trim();
  const durStr = durationMin >= 1440
    ? `${Math.round(durationMin / 1440)} jour(s)`
    : durationMin >= 60
      ? `${Math.round(durationMin / 60)} heure(s)`
      : `${durationMin} minute(s)`;

  const lines = [
    `🚀 *CHANGEMENT DE STRATÉGIE — ROTATION PROMO*`,
    ``,
    `La rotation vient de changer. La nouvelle stratégie active est :`,
    ``,
    `🎯 *${name}*`,
    ``,
    `Cette stratégie prend maintenant le relais et génère les prédictions dans vos canaux Baccarat 1xBet.`,
    ``,
    `⏱ *Durée d'activité :* ${durStr}`,
  ];
  if (totalCount > 1) {
    lines.push(`📌 Position *${orderNum} / ${totalCount}* dans la rotation`);
  }
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📲 *Suivez les signaux en temps réel sur notre plateforme !*`);
  return lines.join('\n');
}

// ── Message PROMOTIONNEL — envoyé à chaque intervalle ────────────────────────
function buildPromoMessage(feat, customText, orderNum, totalCount) {
  const name = (feat?.name || 'Stratégie').trim();
  const lines = [
    `🔥 *STRATÉGIE EN VEDETTE — ${name}*`,
    ``,
    `✨ *${name}* est la stratégie active de la rotation. Elle prédit actuellement avec la plus grande précision sur la plateforme Baccarat 1xBet.`,
    `Elle analyse les jeux en temps réel et génère des signaux fiables pour vous aider à maximiser vos gains.`,
  ];

  if (customText && customText.trim()) {
    lines.push(``);
    lines.push(`📝 ${customText.trim()}`);
  }

  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`💰 *COMMENT ACQUÉRIR CETTE STRATÉGIE ?*`);
  lines.push(``);
  lines.push(`💵 Prix : *75$*`);
  lines.push(`📦 Après paiement : vous recevez votre *licence personnelle* + le *fichier ZIP* complet et prêt à déployer`);
  lines.push(`🤖 Déployez votre bot Telegram et envoyez les prédictions dans vos propres canaux`);
  lines.push(``);
  lines.push(`👉 *Étapes pour acheter :*`);
  lines.push(`1️⃣ Inscrivez-vous sur notre plateforme`);
  lines.push(`2️⃣ Allez dans la section *"Acheter Stratégie"*`);
  lines.push(`3️⃣ Sélectionnez *${name}* et soumettez votre capture de paiement`);
  lines.push(`4️⃣ Après validation par l'administrateur, téléchargez votre licence et votre ZIP`);
  lines.push(``);
  lines.push(`🔒 Licence unique — liée à votre compte`);
  if (totalCount > 1) {
    lines.push(`📌 Stratégie ${orderNum} / ${totalCount} dans la rotation`);
  }
  return lines.join('\n');
}

// ── Envoi Telegram vers tous les canaux cibles ───────────────────────────────
async function _sendToChannels(seqStrat, text) {
  const fetch   = (...a) => import('node-fetch').then(m => m.default(...a));
  const TOKEN   = await db.getSetting('bot_token').catch(() => null);
  const custom  = Array.isArray(seqStrat.tg_targets)
    ? seqStrat.tg_targets.filter(t => t.bot_token && t.channel_id)
    : [];

  if (custom.length > 0) {
    for (const t of custom) {
      try {
        await fetch(`https://api.telegram.org/bot${t.bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: t.channel_id, text, parse_mode: 'Markdown' }),
        });
      } catch (e) { console.warn(`[AnnonceSeq] Erreur canal custom ${t.channel_id}:`, e.message); }
    }
  } else if (TOKEN) {
    const cfgs = await db.getTelegramConfigs().catch(() => []);
    for (const c of cfgs) {
      if (!c.tg_id) continue;
      try {
        await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: c.tg_id, text, parse_mode: 'Markdown' }),
        });
      } catch (e) { console.warn(`[AnnonceSeq] Erreur canal global ${c.tg_id}:`, e.message); }
    }
  } else {
    console.warn(`[AnnonceSeq] S${seqStrat.id} : aucun token/canal configuré`);
  }
}

// ── Tick principal — appelé toutes les 60 secondes ───────────────────────────
async function _tick() {
  try {
    const raw       = await db.getSetting('custom_strategies').catch(() => null);
    const strats    = raw ? JSON.parse(raw) : [];
    const seqStrats = strats.filter(s => s.mode === 'annonce_sequence' && s.enabled);

    for (const seqStrat of seqStrats) {
      try {
        const seqIds = Array.isArray(seqStrat.annonce_sequence_ids) ? seqStrat.annonce_sequence_ids : [];
        if (seqIds.length === 0) continue;

        // Résolution des stratégies de la séquence
        const ordered = seqIds.map(id => strats.find(s => String(s.id) === String(id))).filter(Boolean);
        if (ordered.length === 0) continue;

        const stateKey    = String(seqStrat.id);
        const durationMin = Math.max(1, parseInt(seqStrat.annonce_duration) || 120);
        const intervalMin = Math.max(1, parseInt(seqStrat.annonce_interval) || 60);
        const now         = Date.now();

        // ── Initialisation (premier démarrage) ─────────────────────────────
        if (!_state[stateKey]?.initialized) {
          const savedIdx = _state[stateKey]?.currentIndex ?? 0;
          const idx      = Math.min(savedIdx, ordered.length - 1);
          _state[stateKey] = {
            currentIndex:    idx,
            stratStartedAt:  now,
            lastPromoSentAt: 0,
            initialized:     true,
          };
          // Annoncer la stratégie de départ
          const feat     = ordered[idx];
          const startMsg = buildStartMessage(feat, idx + 1, ordered.length, durationMin);
          await _sendToChannels(seqStrat, startMsg);
          console.log(`[AnnonceSeq] S${seqStrat.id} → Démarrage initial : "${feat.name}" (durée ${durationMin}min)`);
          continue; // attendre le prochain tick pour les promos
        }

        const st             = _state[stateKey];
        const elapsedDurMin  = (now - st.stratStartedAt)  / 60000;
        const elapsedPromin  = (now - st.lastPromoSentAt) / 60000;

        // ── La durée de la stratégie active est écoulée → rotation ─────────
        if (elapsedDurMin >= durationMin) {
          const newIdx = (st.currentIndex + 1) % ordered.length;
          const feat   = ordered[newIdx];

          _state[stateKey].currentIndex    = newIdx;
          _state[stateKey].stratStartedAt  = now;
          _state[stateKey].lastPromoSentAt = now; // reset le compteur promo

          const startMsg = buildStartMessage(feat, newIdx + 1, ordered.length, durationMin);
          await _sendToChannels(seqStrat, startMsg);
          console.log(`[AnnonceSeq] S${seqStrat.id} → Rotation vers "${feat.name}" (${newIdx + 1}/${ordered.length})`);
          continue; // pas de promo sur ce même tick
        }

        // ── L'intervalle promo est écoulé → envoyer annonce promotionnelle ─
        if (elapsedPromin >= intervalMin) {
          const idx  = st.currentIndex;
          const feat = ordered[idx];
          const text = buildPromoMessage(feat, seqStrat.annonce_text || '', idx + 1, ordered.length);
          await _sendToChannels(seqStrat, text);
          _state[stateKey].lastPromoSentAt = now;
          console.log(`[AnnonceSeq] S${seqStrat.id} → Promo "${feat.name}" (pos ${idx + 1}/${ordered.length})`);
        }

      } catch (e) {
        console.error(`[AnnonceSeq] Erreur stratégie S${seqStrat.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[AnnonceSeq] Erreur tick:', e.message);
  }
}

// ── API publique ─────────────────────────────────────────────────────────────

function startAnnonceSequenceScheduler() {
  if (_timer) return;
  _timer = setInterval(_tick, 60 * 1000);
  console.log('[AnnonceSeq] Rotateur Promo démarré (vérification toutes les 60s)');
}

function stopAnnonceSequenceScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

/**
 * Envoi immédiat depuis le bouton admin "Envoyer maintenant".
 * Envoie le message promotionnel pour la stratégie courante.
 */
async function sendNow(stratId) {
  const raw    = await db.getSetting('custom_strategies').catch(() => null);
  const strats = raw ? JSON.parse(raw) : [];
  const seqStrat = strats.find(s => String(s.id) === String(stratId));
  if (!seqStrat || seqStrat.mode !== 'annonce_sequence') throw new Error('Stratégie introuvable ou mode incorrect');

  const seqIds  = Array.isArray(seqStrat.annonce_sequence_ids) ? seqStrat.annonce_sequence_ids : [];
  const ordered = seqIds.map(id => strats.find(s => String(s.id) === String(id))).filter(Boolean);
  if (ordered.length === 0) throw new Error('Aucune stratégie dans la séquence');

  const stateKey    = String(stratId);
  const idx         = (_state[stateKey]?.currentIndex ?? 0) % ordered.length;
  const feat        = ordered[idx];
  const text        = buildPromoMessage(feat, seqStrat.annonce_text || '', idx + 1, ordered.length);
  await _sendToChannels(seqStrat, text);
  if (_state[stateKey]) _state[stateKey].lastPromoSentAt = Date.now();
  console.log(`[AnnonceSeq] sendNow S${stratId} → promo "${feat.name}"`);
}

/**
 * Réinitialise l'état d'un rotateur (force le redémarrage depuis S1 au prochain tick).
 */
function resetState(stratId) {
  delete _state[String(stratId)];
  console.log(`[AnnonceSeq] État S${stratId} réinitialisé`);
}

module.exports = { startAnnonceSequenceScheduler, stopAnnonceSequenceScheduler, sendNow, resetState };
