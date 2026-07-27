const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('./db');
const router  = express.Router();

function getUserStatus(user) {
  if (user.is_admin) return 'active';
  if (!user.is_approved) return 'pending';
  if (!user.subscription_expires_at) return 'expired';
  return new Date(user.subscription_expires_at) > new Date() ? 'active' : 'expired';
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    is_admin: u.is_admin, is_approved: u.is_approved,
    is_premium: !!(u.is_premium || u.account_type === 'premium'),
    is_pro: !!(u.is_pro || u.account_type === 'pro'),
    account_type: u.account_type || 'simple',
    promo_code: u.promo_code || null,
    bonus_minutes_earned: u.bonus_minutes_earned || 0,
    subscription_expires_at: u.subscription_expires_at,
    status: getUserStatus(u),
    admin_level: u.admin_level || 2,
    profile_photo: u.profile_photo || null,
    allowed_channels: u.allowed_channels || null,
    allowed_modes: (() => {
      const v = u.allowed_modes;
      if (!v) return null;
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch { return null; }
    })(),
    show_counter_channels: (() => {
      const v = u.show_counter_channels;
      if (!v) return null;
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch { return null; }
    })(),
    language: u.language || 'fr',
  };
}

// ── Génération du code promo ─────────────────────────────────────────
// Format : 3 lettres FR + 3 chiffres + HHMM + 2 caractères spéciaux + 2 lettres + DDMM
// Total : 18 caractères
const FRENCH_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS         = '0123456789';
const SPECIALS       = '!@#$%&*+=?';

function pick(str, n) {
  let out = '';
  for (let i = 0; i < n; i++) out += str[Math.floor(Math.random() * str.length)];
  return out;
}

function generatePromoCode(now = new Date()) {
  const HH   = String(now.getHours()).padStart(2, '0');
  const MM   = String(now.getMinutes()).padStart(2, '0');
  const DD   = String(now.getDate()).padStart(2, '0');
  const MO   = String(now.getMonth() + 1).padStart(2, '0');
  const part1 = pick(FRENCH_LETTERS, 3);   // 3 lettres
  const part2 = pick(DIGITS, 3);           // 3 chiffres
  const part3 = HH + MM;                   // heure d'inscription
  const part4 = pick(SPECIALS, 2);         // 2 caractères spéciaux
  const part5 = pick(FRENCH_LETTERS, 2);   // 2 lettres
  const part6 = DD + MO;                   // date
  return part1 + part2 + part3 + part4 + part5 + part6;
}

async function generateUniquePromoCode(now = new Date()) {
  for (let i = 0; i < 12; i++) {
    const c = generatePromoCode(now);
    // eslint-disable-next-line no-await-in-loop
    if (!(await db.isPromoCodeTaken(c))) return c;
  }
  // Fallback ultra-rare : on ajoute la seconde
  return generatePromoCode(now) + String(now.getSeconds()).padStart(2, '0');
}

router.post('/register', async (req, res) => {
  const { username, email, password, account_type, promo_code, profile_photo, language } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe: 6 caractères minimum' });

  // Types autorisés à l'inscription : simple / premium / partenaire
  const ALLOWED_TYPES = ['simple', 'premium', 'partenaire'];
  const accountType = ALLOWED_TYPES.includes(account_type) ? account_type : 'simple';

  // Validation de la photo de profil (optionnelle, max ~600 ko base64 = ~450 ko binaire)
  let profilePhoto = null;
  if (profile_photo && typeof profile_photo === 'string') {
    if (profile_photo.length > 800_000) {
      return res.status(413).json({ error: 'Photo trop volumineuse (max 500 Ko)' });
    }
    if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(profile_photo)) {
      profilePhoto = profile_photo;
    }
  }

  // Validation du code admin partenaire (obligatoire pour compte partenaire)
  const { admin_partner_code } = req.body;
  let partnerCodeEntry = null;
  if (accountType === 'partenaire') {
    if (!admin_partner_code || !String(admin_partner_code).trim()) {
      return res.status(400).json({ error: 'Un code admin est requis pour créer un compte partenaire' });
    }
    partnerCodeEntry = await db.getPartnerCodeByCode(String(admin_partner_code).trim());
    if (!partnerCodeEntry) {
      return res.status(400).json({ error: 'Code admin partenaire invalide' });
    }
    if (partnerCodeEntry.used) {
      return res.status(400).json({ error: 'Ce code admin a déjà été utilisé' });
    }
  }

  // Validation du code promo (optionnel, seulement pour comptes non-partenaires)
  let referrerUserId = null;
  if (accountType !== 'partenaire' && promo_code && String(promo_code).trim()) {
    const referrer = await db.getUserByPromoCode(String(promo_code).trim());
    if (!referrer) {
      return res.status(400).json({ error: 'Code promotionnel invalide' });
    }
    referrerUserId = referrer.id;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const newPromoCode = await generateUniquePromoCode(new Date());

    const ALLOWED_LANGS = ['fr','en','es','de','ar','ru','pt','it'];
    const userLang = ALLOWED_LANGS.includes(language) ? language : 'fr';

    const user = await db.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password_hash: hash,
      plain_password: password,
      account_type: accountType,
      is_premium: accountType === 'premium',
      is_pro: accountType === 'pro',
      is_approved: accountType === 'partenaire', // partenaires approuvés automatiquement
      promo_code: newPromoCode,
      referrer_user_id: referrerUserId,
      profile_photo: profilePhoto,
      language: userLang,
    });

    // Marquer le code admin partenaire comme utilisé et copier les modes autorisés
    if (partnerCodeEntry) {
      await db.markPartnerCodeUsed(partnerCodeEntry.code, user.id);
      // Copier les allowed_modes du code partenaire vers l'utilisateur
      if (Array.isArray(partnerCodeEntry.allowed_modes) && partnerCodeEntry.allowed_modes.length > 0) {
        await db.updateUser(user.id, { allowed_modes: JSON.stringify(partnerCodeEntry.allowed_modes) });
      }
    }

    const isPartner = accountType === 'partenaire';
    res.json({
      message: isPartner
        ? 'Compte partenaire créé avec succès. Vous pouvez vous connecter immédiatement.'
        : "Inscription réussie. En attente de validation par l'administrateur.",
      user: publicUser(user),
      promo_code: newPromoCode,
      referrer_applied: !!referrerUserId,
      is_partner: isPartner,
    });
  } catch (err) {
    if (err.code === '23505' || err.message === 'username taken' || err.message === 'email taken') {
      const field = (err.field === 'email' || (err.detail && err.detail.includes('email'))) ? 'email' : "nom d'utilisateur";
      return res.status(409).json({ error: `Ce ${field} est déjà utilisé` });
    }
    console.error('register error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Identifiants requis' });

  // ── Accès secret vers l'espace programmation ──────────────────────
  if (username.trim() === 'admin' && password === '123456') {
    req.session.progAuth = true;
    return res.json({ redirect: '/programmation' });
  }

  try {
    const user = await db.getUserByLogin(username.trim());
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });
    req.session.userId      = user.id;
    req.session.username    = user.username;
    req.session.isAdmin     = user.is_admin;
    req.session.isPremium   = user.is_premium || false;
    req.session.isPro       = user.is_pro || false;
    req.session.adminLevel  = user.admin_level || 2;
    req.session.accountType = user.account_type || 'simple';
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Déconnecté' }));
});

router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalide' });
    // ── Re-synchronise les drapeaux de session depuis la base ─────────
    // Sans ça, si l'admin active is_pro / is_admin pendant que l'utilisateur
    // est déjà connecté, sa session conserve l'ancienne valeur et toutes les
    // routes /admin/pro-* renvoient 403 → panneaux Config Pro & Telegram vides.
    const freshIsAdmin    = !!user.is_admin;
    const freshIsPro      = !!user.is_pro;
    const freshIsPremium  = !!(user.is_premium || user.account_type === 'premium');
    const freshAccountType = user.account_type || 'simple';
    const needsSync = req.session.isAdmin    !== freshIsAdmin
                   || req.session.isPro      !== freshIsPro
                   || req.session.isPremium  !== freshIsPremium
                   || req.session.accountType !== freshAccountType;
    if (needsSync) {
      req.session.isAdmin     = freshIsAdmin;
      req.session.isPro       = freshIsPro;
      req.session.isPremium   = freshIsPremium;
      req.session.accountType = freshAccountType;
      // Persiste immédiatement la session mise à jour avant de répondre
      req.session.save(() => res.json(publicUser(user)));
      return;
    }
    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Backfill : génère un code promo pour un user qui n'en a pas (auto)
router.post('/ensure-promo-code', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalide' });
    if (user.promo_code) return res.json({ promo_code: user.promo_code });
    const code = await generateUniquePromoCode(new Date());
    await db.updateUser(user.id, { promo_code: code });
    res.json({ promo_code: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.generateUniquePromoCode = generateUniquePromoCode;
module.exports.publicUser = publicUser;
