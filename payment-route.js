'use strict';
/**
 * payment-route.js — Gestion des abonnements payants
 *
 * Flux :
 *   1. Utilisateur expiré clique sur un plan (1j/1sem/2sem/1mois)
 *   2. Backend crée une payment_request "awaiting_screenshot" et renvoie
 *      le lien WhatsApp + l'id de la requête
 *   3. Utilisateur paie via WhatsApp puis upload une capture d'écran
 *   4. L'IA Gemini Vision analyse l'image :
 *        - Si valide → status='ai_validated', accès temporaire 2 h
 *        - Sinon    → status='pending_admin', pas d'accès temporaire
 *   5. L'admin voit la liste des paiements en attente, valide ou rejette
 *   6. À l'approbation : la durée du plan est ajoutée à l'abonnement,
 *      les canaux sont assignés selon account_type (simple/premium),
 *      et le bonus 20 % est crédité au parrain (1ère fois seulement)
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const { analyzePaymentScreenshot } = require('./ai-route');

// ── Helper : envoyer un message système dans la boîte d'un utilisateur ──
async function sendSystemMessage(userId, text) {
  try {
    const raw = await db.getSetting('user_messages');
    const messages = raw ? JSON.parse(raw) : [];
    messages.unshift({
      id: Date.now() + Math.floor(Math.random() * 1000),
      userId,
      username: '__system__',
      text,
      date: new Date().toISOString(),
      read: false,
      type: 'system',
      from_system: true,
    });
    if (messages.length > 300) messages.splice(300);
    await db.setSetting('user_messages', JSON.stringify(messages));
  } catch (e) {
    console.warn('[sendSystemMessage] erreur:', e.message);
  }
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Plans d'abonnement (prix de base = compte SIMPLE) ──────────────
const BASE_PLANS = {
  '1j':  { id: '1j',  label: '1 jour',     base_usd: 2,  duration_minutes: 24 * 60 },
  '1s':  { id: '1s',  label: '1 semaine',  base_usd: 12, duration_minutes: 7 * 24 * 60 },
  '2s':  { id: '2s',  label: '2 semaines', base_usd: 20, duration_minutes: 14 * 24 * 60 },
  '1m':  { id: '1m',  label: '1 mois',     base_usd: 40, duration_minutes: 30 * 24 * 60 },
};

// Majoration selon le type de compte (choisi à l'inscription, FIXE)
//   simple  = base
//   pro     = base + 20%
//   premium = base + 10%
const TYPE_SURCHARGE = { simple: 0, pro: 0.20, premium: 0.10 };

function priceForType(baseUsd, accountType) {
  const pct = TYPE_SURCHARGE[accountType] ?? 0;
  return Math.round(baseUsd * (1 + pct) * 100) / 100;
}

function plansFor(accountType) {
  const pct = TYPE_SURCHARGE[accountType] ?? 0;
  return Object.values(BASE_PLANS).map(p => ({
    id: p.id,
    label: p.label,
    amount_usd: priceForType(p.base_usd, accountType),
    base_usd: p.base_usd,
    surcharge_percent: Math.round(pct * 100),
    duration_minutes: p.duration_minutes,
    account_type: accountType,
  }));
}

const WHATSAPP_NUMBER = '+2290195501564';
const WHATSAPP_LINK   = 'https://wa.me/2290195501564';

const REFERRAL_BONUS_PERCENT = 20;       // % de durée pour le parrain
const REFERRAL_DISCOUNT_PERCENT = 20;    // % de remise pour l'utilisateur
const AI_TEMP_HOURS = 2;                 // accès temporaire si IA valide

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

// ── Liste des plans (renvoie le tarif adapté au type de compte connecté) ──
router.get('/plans', async (req, res) => {
  let accountType = 'simple';
  if (req.session?.userId) {
    try {
      const u = await db.getUser(req.session.userId);
      if (u?.account_type) accountType = u.account_type;
    } catch {}
  }
  res.json({
    account_type: accountType,
    surcharge_percent: Math.round((TYPE_SURCHARGE[accountType] ?? 0) * 100),
    plans: plansFor(accountType),
    // Prix de base + tarifs par type pour affichage comparatif
    pricing_grid: Object.values(BASE_PLANS).map(p => ({
      id: p.id, label: p.label, duration_minutes: p.duration_minutes,
      simple:  priceForType(p.base_usd, 'simple'),
      premium: priceForType(p.base_usd, 'premium'),
      pro:     priceForType(p.base_usd, 'pro'),
    })),
    whatsapp: { number: WHATSAPP_NUMBER, link: WHATSAPP_LINK },
    referral: {
      discount_percent: REFERRAL_DISCOUNT_PERCENT,
      bonus_percent: REFERRAL_BONUS_PERCENT,
    },
  });
});

// ── Créer une demande de paiement (étape 1) ─────────────────────────
router.post('/request', requireAuth, async (req, res) => {
  const { plan_id } = req.body;
  const basePlan = BASE_PLANS[plan_id];
  if (!basePlan) return res.status(400).json({ error: 'Plan invalide' });

  try {
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    // Le type est défini à l'inscription — on l'utilise tel quel
    const accountType = user.account_type || 'simple';
    const fullPrice = priceForType(basePlan.base_usd, accountType);

    // Remise 20 % si l'utilisateur a un parrain ET n'a jamais utilisé son bonus
    let amount = fullPrice;
    let discount = false;
    if (user.referrer_user_id && !user.referral_bonus_used) {
      amount = Math.round(amount * (1 - REFERRAL_DISCOUNT_PERCENT / 100) * 100) / 100;
      discount = true;
    }

    const pr = await db.createPaymentRequest({
      user_id: user.id,
      plan_id: basePlan.id,
      plan_label: basePlan.label,
      amount_usd: amount,
      duration_minutes: basePlan.duration_minutes,
      status: 'awaiting_screenshot',
      discount_applied: discount,
    });

    // Message pré-rempli pour WhatsApp (format demandé par l'utilisateur)
    const typeLabel = accountType === 'premium' ? 'PREMIUM' : accountType === 'pro' ? 'PRO' : 'SIMPLE';
    const msg =
`Je veux payer l'abonnement ${basePlan.label}.
Compte : ${typeLabel}
Abonnement : ${basePlan.label}
Montant à payer : ${amount} $
Identifiant : ${user.username}
Référence : #${pr.id}

Je veux le lien de paiement.`;
    const whatsappLink = `${WHATSAPP_LINK}?text=${encodeURIComponent(msg)}`;

    res.json({
      ok: true,
      request: {
        id: pr.id,
        plan_id: pr.plan_id,
        plan_label: pr.plan_label,
        amount_usd: amount,
        full_price_usd: fullPrice,
        base_usd: basePlan.base_usd,
        account_type: accountType,
        duration_minutes: pr.duration_minutes,
        discount_applied: discount,
        status: pr.status,
      },
      whatsapp_link: whatsappLink,
      whatsapp_number: WHATSAPP_NUMBER,
    });
  } catch (e) {
    console.error('payment/request error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Upload d'une capture (étape 2) — l'IA analyse + accès temporaire 2 h ──
router.post('/:id/screenshot', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { image_base64, mime_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'image_base64 requis' });
  // Limite raisonnable : 8 Mo de base64 (~6 Mo binaire)
  if (String(image_base64).length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image trop volumineuse (max 6 Mo)' });
  }

  try {
    const pr = await db.getPaymentRequest(id);
    if (!pr) return res.status(404).json({ error: 'Demande introuvable' });
    if (pr.user_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
    if (pr.status === 'approved' || pr.status === 'rejected') {
      return res.status(400).json({ error: 'Demande déjà traitée' });
    }

    // Stocker la capture (base64 brut, sans header data:)
    const cleanB64 = String(image_base64).replace(/^data:[^;]+;base64,/, '');
    const mime = mime_type || 'image/jpeg';

    // Analyse IA
    let aiResult = null;
    let aiError  = null;
    try {
      aiResult = await analyzePaymentScreenshot(cleanB64, mime, pr.amount_usd);
    } catch (e) {
      aiError = e.message;
      console.warn('[Payment] IA Vision indisponible :', e.message);
    }

    // Décision : si l'IA valide → on applique la DURÉE COMPLÈTE du plan
    // (sous réserve de vérification administrateur). Si l'admin rejette plus tard,
    // la durée sera retirée. Si l'IA n'est pas sûre → attente admin sans durée.
    const isValid = aiResult && aiResult.is_payment_screenshot && (aiResult.confidence || 0) >= 50;
    let provisionalExpiry = null;
    let newStatus = 'pending_admin';

    if (isValid) {
      newStatus = 'ai_validated';
      // Étendre l'abonnement de la durée complète du plan
      const u = await db.getUser(pr.user_id);
      const baseDate = u.subscription_expires_at && new Date(u.subscription_expires_at) > new Date()
        ? new Date(u.subscription_expires_at) : new Date();
      provisionalExpiry = new Date(baseDate.getTime() + pr.duration_minutes * 60 * 1000);

      const accountType = u.account_type || 'simple';
      const isPremium   = accountType === 'premium';
      const isPro       = accountType === 'pro';

      await db.updateUser(pr.user_id, {
        is_approved: true,
        is_premium: isPremium,
        is_pro: isPro,
        subscription_expires_at: provisionalExpiry.toISOString(),
        subscription_duration_minutes: (u.subscription_duration_minutes || 0) + pr.duration_minutes,
      });

      // Assigner les canaux par défaut si pas encore fait
      if (db.pool) {
        try {
          for (const sid of ['C1', 'C2', 'C3', 'DC']) {
            await db.pool.query(
              'INSERT INTO user_strategy_visible (user_id, strategy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [pr.user_id, sid]
            );
          }
        } catch (_) {}
      }
    }

    await db.updatePaymentRequest(id, {
      screenshot_data: cleanB64,
      ai_analysis: aiResult || { error: aiError, is_payment_screenshot: false },
      ai_temp_access_until: provisionalExpiry,
      status: newStatus,
    });

    res.json({
      ok: true,
      ai_validated: isValid,
      ai_temp_access_until: provisionalExpiry,
      provisional_expiry: provisionalExpiry,
      duration_minutes: pr.duration_minutes,
      ai_analysis: aiResult || { error: aiError },
      status: newStatus,
      message: isValid
        ? `✅ Paiement détecté par l'IA — votre durée complète de ${pr.plan_label} a été créditée à votre compte (sous réserve de vérification de l'administrateur).`
        : `📤 Capture reçue. L'IA n'a pas pu confirmer automatiquement — l'administrateur va la vérifier manuellement.`,
    });
  } catch (e) {
    console.error('payment/screenshot error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Mes demandes ─────────────────────────────────────────────────────
router.get('/my-requests', requireAuth, async (req, res) => {
  try {
    const list = await db.getUserPaymentRequests(req.session.userId, 30);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN : liste des paiements en attente ──────────────────────────
router.get('/admin/pending', requireAdmin, async (req, res) => {
  try {
    const list = await db.getPendingPaymentRequests();
    // Ne pas envoyer la capture en pleine taille dans la liste — juste un flag
    res.json(list.map(p => ({
      ...p,
      has_screenshot: !!p.screenshot_data,
      screenshot_data: undefined,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN : voir une capture ────────────────────────────────────────
router.get('/admin/:id/screenshot', requireAdmin, async (req, res) => {
  try {
    const pr = await db.getPaymentRequest(parseInt(req.params.id));
    if (!pr || !pr.screenshot_data) return res.status(404).json({ error: 'Capture introuvable' });
    res.json({ image_base64: pr.screenshot_data, ai_analysis: pr.ai_analysis });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN : valider une demande ─────────────────────────────────────
router.post('/admin/:id/approve', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pr = await db.getPaymentRequest(id);
    if (!pr) return res.status(404).json({ error: 'Demande introuvable' });
    if (pr.status === 'approved') return res.status(400).json({ error: 'Déjà approuvée' });

    const user = await db.getUser(pr.user_id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Étendre l'abonnement à partir d'aujourd'hui (ou de l'expiration actuelle si encore valide)
    const baseDate = user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date()
      ? new Date(user.subscription_expires_at) : new Date();
    const newExpiry = new Date(baseDate.getTime() + pr.duration_minutes * 60 * 1000);

    // Le type est FIXE depuis l'inscription — l'admin ne peut pas le changer
    const accountType = user.account_type || 'simple';
    const isPremium   = accountType === 'premium';
    const isPro       = accountType === 'pro';

    await db.updateUser(user.id, {
      is_approved: true,
      is_premium: isPremium,
      is_pro: isPro,
      // account_type reste inchangé : c'est le choix de l'utilisateur à l'inscription
      subscription_expires_at: newExpiry.toISOString(),
      subscription_duration_minutes: (user.subscription_duration_minutes || 0) + pr.duration_minutes,
    });

    // Auto-assignation des canaux par défaut C1/C2/C3/DC
    if (db.pool) {
      try {
        for (const sid of ['C1', 'C2', 'C3', 'DC']) {
          await db.pool.query(
            'INSERT INTO user_strategy_visible (user_id, strategy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user.id, sid]
          );
        }
      } catch (_) {}
    }

    // ── Bonus parrain : 20 % de la durée du plan, 1ère fois seulement ──
    let referrerBonus = 0;
    if (user.referrer_user_id && !user.referral_bonus_used) {
      referrerBonus = Math.round(pr.duration_minutes * REFERRAL_BONUS_PERCENT / 100);
      const ref = await db.getUser(user.referrer_user_id);
      if (ref) {
        const refBase = ref.subscription_expires_at && new Date(ref.subscription_expires_at) > new Date()
          ? new Date(ref.subscription_expires_at) : new Date();
        const refExpiry = new Date(refBase.getTime() + referrerBonus * 60 * 1000);
        const newTotalBonus = (ref.bonus_minutes_earned || 0) + referrerBonus;

        await db.updateUser(ref.id, {
          is_approved: true,
          subscription_expires_at: refExpiry.toISOString(),
          subscription_duration_minutes: (ref.subscription_duration_minutes || 0) + referrerBonus,
          bonus_minutes_earned: newTotalBonus,
        });

        // ── Notification système dans la boîte du parrain ──────────────
        const remainingMs = refExpiry - new Date();
        const remainingMin = Math.max(0, Math.floor(remainingMs / 60000));
        const notifText =
`🎁 BONUS PARRAIN REÇU !

Félicitations ! Votre filleul ${user.username} vient de souscrire à un abonnement (${pr.plan_label}).

✅ +${fmtMinutes(referrerBonus)} ont été ajoutés à votre abonnement.

📅 Votre abonnement expire désormais le :
   ${fmtDate(refExpiry)}

⏱️ Durée totale restante : ${fmtMinutes(remainingMin)}

🏆 Total bonus parrain gagné à ce jour : ${fmtMinutes(newTotalBonus)}

Continuez à partager votre code promo pour gagner encore plus de temps !`;

        await sendSystemMessage(ref.id, notifText);
        console.log(`[Payment] 🎁 Parrain ${ref.username} crédité de ${referrerBonus} min grâce à ${user.username} — notification envoyée`);
      }
      await db.updateUser(user.id, { referral_bonus_used: true });
    }

    await db.updatePaymentRequest(id, {
      status: 'approved',
      admin_validated_at: new Date(),
      admin_validated_by: req.session.userId,
      referrer_bonus_minutes: referrerBonus,
      admin_note: req.body?.note || null,
    });

    res.json({
      ok: true,
      message: `Abonnement activé pour ${user.username} (${pr.plan_label})`,
      new_expiry: newExpiry,
      account_type: accountType,
      referrer_bonus_minutes: referrerBonus,
    });
  } catch (e) {
    console.error('payment/approve error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN : rejeter ─────────────────────────────────────────────────
router.post('/admin/:id/reject', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pr = await db.getPaymentRequest(id);
    if (!pr) return res.status(404).json({ error: 'Demande introuvable' });

    // Si l'IA avait accordé un accès temporaire, le retirer
    if (pr.ai_temp_access_until) {
      const u = await db.getUser(pr.user_id);
      if (u && u.subscription_expires_at &&
          new Date(u.subscription_expires_at).getTime() === new Date(pr.ai_temp_access_until).getTime()) {
        await db.updateUser(pr.user_id, { subscription_expires_at: null });
      }
    }

    await db.updatePaymentRequest(id, {
      status: 'rejected',
      admin_validated_at: new Date(),
      admin_validated_by: req.session.userId,
      admin_note: req.body?.note || 'Rejetée par l\'administrateur',
    });

    res.json({ ok: true, message: 'Demande rejetée' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.BASE_PLANS = BASE_PLANS;
module.exports.plansFor = plansFor;
module.exports.priceForType = priceForType;
