import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import TalkingMascot from '../components/TalkingMascot';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    username: '', email: '', password: '', confirm: '',
    account_type: 'simple', promo_code: '',
  });
  const [profilePhoto, setProfilePhoto] = useState(''); // dataURL base64
  const [photoError, setPhotoError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [generatedPromoCode, setGeneratedPromoCode] = useState('');
  const [referrerApplied, setReferrerApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mascotDone, setMascotDone] = useState(false);
  const progressTimer = useRef(null);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // Upload + redimensionnement client de la photo (max 400px, ~80 ko)
  const handlePhotoFile = (file) => {
    setPhotoError('');
    if (!file) { setProfilePhoto(''); return; }
    if (!/^image\//.test(file.type)) {
      setPhotoError('Veuillez choisir une image (JPG, PNG, WebP)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Image trop grande (max 5 Mo avant compression)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let { width, height } = img;
        if (width > height) {
          if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        } else {
          if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setProfilePhoto(dataUrl);
      };
      img.onerror = () => setPhotoError('Image illisible');
      img.src = reader.result;
    };
    reader.onerror = () => setPhotoError('Lecture impossible');
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (loading) {
      setProgress(8);
      progressTimer.current = setInterval(() => {
        setProgress(p => p >= 92 ? p : p + Math.max(1, (92 - p) * 0.06));
      }, 110);
    } else {
      if (progressTimer.current) clearInterval(progressTimer.current);
    }
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [loading]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Les mots de passe ne correspondent pas');
    if (form.password.length < 6) return setError('Mot de passe trop court (6 caractères minimum)');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
          account_type: form.account_type,
          promo_code: form.promo_code.trim() || undefined,
          profile_photo: profilePhoto || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur d'inscription");
      setProgress(100);
      setGeneratedPromoCode(data.promo_code || '');
      setReferrerApplied(!!data.referrer_applied);
      await new Promise(r => setTimeout(r, 450));
      setSuccess(true);
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    if (!generatedPromoCode) return;
    try { navigator.clipboard.writeText(generatedPromoCode); } catch {}
  };

  // ── SUCCESS SCREEN ──
  if (success) {
    const username = form.username || 'cher utilisateur';
    const lines = [
      `Bienvenue ${username} !`,
      `Votre compte ${form.account_type === 'premium' ? 'PREMIUM' : form.account_type === 'pro' ? 'PRO' : 'SIMPLE'} est créé.`,
      `Voici votre code promotionnel personnel : ${generatedPromoCode || 'généré'}.`,
      `Partagez-le : si quelqu'un l'utilise lors de son 1er paiement, il a 20 % de réduction et vous gagnez 20 % de sa durée d'abonnement !`,
      referrerApplied
        ? `Bonne nouvelle : votre code parrain a bien été appliqué — vous aurez 20 % de réduction sur votre 1er paiement.`
        : `Vous pourrez aussi acheter un abonnement après validation de votre compte.`,
    ];
    return (
      <div className="auth-page mascot-page">
        <div className="auth-bg-orb orb1" />
        <div className="auth-bg-orb orb2" />

        <div className="auth-box success-box mascot-box">
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 100,
              background: 'rgba(34,197,94,0.13)', border: '1px solid rgba(34,197,94,0.3)',
              color: '#86efac', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
            }}>
              <span style={{ fontSize: 14 }}>✅</span> INSCRIPTION RÉUSSIE
            </div>
            <h2 style={{ marginTop: 14, fontSize: '1.45rem' }}>Bienvenue à bord !</h2>
          </div>

          {generatedPromoCode && (
            <div style={{
              margin: '10px 0 18px',
              padding: '14px 16px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(245,158,11,0.08))',
              border: '2px solid rgba(251,191,36,0.45)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', letterSpacing: 1, marginBottom: 6 }}>
                🎁 VOTRE CODE PROMO PERSONNEL
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: 22, fontWeight: 900,
                color: '#fff', letterSpacing: 2, wordBreak: 'break-all',
                padding: '8px 4px',
              }}>
                {generatedPromoCode}
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 6, fontSize: 11 }}
              >
                📋 Copier le code
              </button>
              <div style={{ fontSize: 11, color: '#fcd34d', marginTop: 8, lineHeight: 1.4 }}>
                Partagez ce code à vos amis. Lors de leur 1er paiement,<br />
                ils ont <b>20 % de remise</b> et vous gagnez <b>20 %</b> de leur durée.
              </div>
            </div>
          )}

          <TalkingMascot
            lines={lines}
            primaryColor="#fbbf24"
            character="🧑‍💼"
            onDone={() => setMascotDone(true)}
          />

          <div className="alert alert-info" style={{ marginTop: 22 }}>
            📬 Vous pourrez vous connecter et acheter un abonnement (1 j / 1 sem / 2 sem / 1 mois) depuis votre espace.
          </div>

          <Link to="/connexion" className="btn btn-gold btn-auth" style={{ marginTop: 4 }}>
            {mascotDone ? '🚀 Se connecter maintenant' : 'Se connecter'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-orb orb1" />
      <div className="auth-bg-orb orb2" />

      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-icon">🎲</div>
          <h1>Prediction Baccara Pro</h1>
          <p>Créer un nouveau compte</p>
        </div>

        {error && <div className="alert alert-error"><span>⚠️</span> {error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Nom d'utilisateur</label>
            <div className="input-wrap">
              <span className="input-icon">👤</span>
              <input className="form-input has-icon" type="text" placeholder="votre_pseudo"
                value={form.username} onChange={set('username')} required autoFocus />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Adresse email</label>
            <div className="input-wrap">
              <span className="input-icon">📧</span>
              <input className="form-input has-icon" type="email" placeholder="email@exemple.com"
                value={form.email} onChange={set('email')} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Type de compte</label>
            <div className="input-wrap">
              <span className="input-icon">🎯</span>
              <select
                className="form-input has-icon"
                value={form.account_type}
                onChange={set('account_type')}
                style={{ cursor: 'pointer' }}
              >
                <option value="simple">👤 Compte Utilisateur</option>
                <option value="pro">💎 Compte Pro</option>
                <option value="premium">⭐ Compte Premium</option>
              </select>
            </div>
          </div>

          {/* Photo de profil (optionnelle) */}
          <div className="form-group">
            <label className="form-label">Photo de profil <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optionnelle)</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: profilePhoto ? `url(${profilePhoto}) center/cover` : 'rgba(148,163,184,0.18)',
                border: '2px solid rgba(251,191,36,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, color: '#94a3b8', flexShrink: 0,
              }}>
                {!profilePhoto && '📷'}
              </div>
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => handlePhotoFile(e.target.files?.[0])}
                  style={{ fontSize: 12, color: '#cbd5e1', width: '100%' }}
                />
                {profilePhoto && (
                  <button
                    type="button"
                    onClick={() => { setProfilePhoto(''); setPhotoError(''); }}
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 6, fontSize: 11 }}
                  >
                    🗑 Retirer la photo
                  </button>
                )}
                {photoError && (
                  <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4 }}>⚠ {photoError}</div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Image automatiquement réduite à 400px (max 500 Ko après compression).
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Code promotionnel <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optionnel)</span></label>
            <div className="input-wrap">
              <span className="input-icon">🎁</span>
              <input
                className="form-input has-icon"
                type="text"
                placeholder="Code d'un parrain (laissez vide si vous n'en avez pas)"
                value={form.promo_code}
                onChange={e => setForm(f => ({ ...f, promo_code: e.target.value.toUpperCase() }))}
                style={{ fontFamily: 'monospace', letterSpacing: 1 }}
                maxLength={24}
              />
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Avec un code valide, vous obtenez <b style={{ color: '#fbbf24' }}>20 % de réduction</b> sur votre 1er paiement.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <PasswordInput
              value={form.password}
              onChange={set('password')}
              placeholder="Minimum 6 caractères"
              iconLeft="🔒"
              showStrength
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirmer le mot de passe</label>
            <PasswordInput
              value={form.confirm}
              onChange={set('confirm')}
              placeholder="Répéter le mot de passe"
              iconLeft="🔐"
            />
            {form.confirm && form.password && form.confirm !== form.password && (
              <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4 }}>
                ⚠ Les mots de passe ne correspondent pas
              </div>
            )}
            {form.confirm && form.confirm === form.password && form.password.length >= 6 && (
              <div style={{ fontSize: 11, color: '#86efac', marginTop: 4 }}>
                ✓ Les mots de passe correspondent
              </div>
            )}
          </div>

          {loading && (
            <div className="register-progress">
              <div className="register-progress-bar" style={{ width: `${progress}%` }} />
              <div className="register-progress-text">
                {progress < 30 && '🔐 Création de votre compte...'}
                {progress >= 30 && progress < 60 && '📝 Génération de votre code promo...'}
                {progress >= 60 && progress < 90 && '📡 Envoi à l\'administrateur...'}
                {progress >= 90 && '✅ Presque terminé !'}
              </div>
            </div>
          )}

          <button className="btn btn-gold btn-auth" type="submit" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Inscription en cours...</> : '✨ Créer mon compte'}
          </button>
        </form>

        <div className="auth-divider"><span>ou</span></div>
        <p className="auth-footer">
          Déjà inscrit ? <Link to="/connexion">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
