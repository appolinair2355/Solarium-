import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import TalkingMascot from '../components/TalkingMascot';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mascotDone, setMascotDone] = useState(false);
  const progressTimer = useRef(null);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // Progress bar animation while loading
  useEffect(() => {
    if (loading) {
      setProgress(8);
      progressTimer.current = setInterval(() => {
        setProgress(p => {
          if (p >= 92) return p;
          // ease towards 92
          return p + Math.max(1, (92 - p) * 0.06);
        });
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
      await register(form.username, form.email, form.password);
      setProgress(100);
      // small delay so the user sees the bar fill
      await new Promise(r => setTimeout(r, 450));
      setSuccess(true);
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  // ── SUCCESS SCREEN with talking mascot ──
  if (success) {
    const username = form.username || 'cher utilisateur';
    const lines = [
      `Bienvenue ${username} !`,
      `Vous êtes maintenant inscrit dans Prediction Baccara Pro.`,
      `Veuillez patienter, SOSSOU Kouamé va analyser votre demande et confirmer votre compte très rapidement.`,
      `Pas d'inquiétude, votre accès aux prédictions arrive bientôt. Restez avec nous !`,
      `À tout de suite sur votre tableau de bord. Bonne chance !`,
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

          <TalkingMascot
            lines={lines}
            primaryColor="#fbbf24"
            character="🧑‍💼"
            onDone={() => setMascotDone(true)}
          />

          <div className="alert alert-info" style={{ marginTop: 22 }}>
            📬 Vous recevrez l'accès dès que SOSSOU Kouamé valide votre compte.
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
                {progress >= 30 && progress < 60 && '📝 Enregistrement des informations...'}
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
