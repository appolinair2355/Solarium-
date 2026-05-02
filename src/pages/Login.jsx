import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import PasswordInput from '../components/PasswordInput';
import TalkingMascot from '../components/TalkingMascot';

function formatRemaining(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  const parts = [];
  if (days)    parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours)   parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  if (minutes && !days) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  return parts.join(' et ') || 'quelques instants';
}

export default function Login() {
  const { login } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [welcome, setWelcome] = useState(null);
  const progressTimer = useRef(null);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (loading) {
      setProgress(10);
      progressTimer.current = setInterval(() => {
        setProgress(p => p >= 92 ? p : p + Math.max(1, (92 - p) * 0.07));
      }, 100);
    } else if (progressTimer.current) {
      clearInterval(progressTimer.current);
    }
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [loading]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(form.username, form.password);
      setProgress(100);
      await new Promise(r => setTimeout(r, 350));

      // Apply user's preferred language on login
      if (result?.language) setLang(result.language);

      if (result?.redirect) {
        navigate(result.redirect, { replace: true });
        return;
      }
      if (result?.is_admin) {
        navigate('/admin', { replace: true });
        return;
      }
      setWelcome({ user: result, redirect: '/choisir' });
    } catch (err) {
      setError(err.message);
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  // ── WELCOME MASCOT after successful login ──
  if (welcome) {
    const u = welcome.user || {};
    const username = u.username || 'cher utilisateur';
    const status = u.status;

    let lines;
    let mascotChar = '🧑‍💼';
    let mascotColor = '#fbbf24';

    if (status === 'active') {
      const remaining = formatRemaining(u.subscription_expires_at) || 'le temps restant à votre abonnement';
      lines = [
        `${t('app.name')} — ${username}`,
        `Bienvenue dans Prediction Baccara Pro.`,
        `Vous avez accès aux prédictions pendant ${remaining}.`,
        `Pensez à regarder votre temps restant en haut de l'écran.`,
        `Bonne chance et bonnes prédictions !`,
      ];
      mascotChar = '😊';
      mascotColor = '#22c55e';
    } else if (status === 'pending') {
      lines = [
        `Bonjour ${username}, content de vous revoir !`,
        `Votre compte est encore en attente de validation.`,
        `SOSSOU Kouamé étudie votre demande, ce ne sera plus très long.`,
        `Merci pour votre patience, vous allez bientôt accéder aux prédictions.`,
      ];
      mascotChar = '🤗';
      mascotColor = '#fbbf24';
    } else {
      lines = [
        `Bonjour ${username}.`,
        `Votre abonnement est arrivé à expiration.`,
        `Contactez SOSSOU Kouamé pour renouveler votre accès aux prédictions.`,
      ];
      mascotChar = '😌';
      mascotColor = '#ef4444';
    }

    return (
      <div className="auth-page mascot-page">
        <div className="auth-bg-orb orb1" />
        <div className="auth-bg-orb orb2" />
        <div className="auth-box mascot-box success-box">
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 100,
              background: status === 'active' ? 'rgba(34,197,94,0.13)' :
                          status === 'pending' ? 'rgba(251,191,36,0.13)' :
                                                 'rgba(239,68,68,0.13)',
              border: `1px solid ${mascotColor}40`,
              color: mascotColor, fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
            }}>
              {status === 'active'  && <>✅ {t('status.active').toUpperCase()}</>}
              {status === 'pending' && <>⏳ {t('status.pending').toUpperCase()}</>}
              {status === 'expired' && <>⏰ {t('dash.subscription_expired').toUpperCase()}</>}
            </div>
            <h2 style={{ marginTop: 14, fontSize: '1.45rem' }}>
              {status === 'active' ? `${t('auth.success.title')} ${username} !` : `Bonjour ${username}`}
            </h2>
          </div>
          <TalkingMascot
            lines={lines}
            primaryColor={mascotColor}
            character={mascotChar}
            onDone={() => navigate(welcome.redirect, { replace: true })}
          />
          <button
            className="btn btn-gold btn-auth"
            style={{ marginTop: 22 }}
            onClick={() => navigate(welcome.redirect, { replace: true })}
          >
            {t('action.continue')}
          </button>
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
          <h1>{t('app.name')}</h1>
          <p>{t('auth.login.title')}</p>
        </div>

        {error && (
          <div className="alert alert-error">
            <span>⚠️</span> {error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('auth.field.identifier')}</label>
            <div className="input-wrap">
              <span className="input-icon">👤</span>
              <input
                className="form-input has-icon"
                type="text"
                placeholder="votre_pseudo"
                value={form.username}
                onChange={set('username')}
                required autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('auth.field.password')}</label>
            <PasswordInput
              value={form.password}
              onChange={set('password')}
              placeholder="••••••••"
              iconLeft="🔒"
            />
          </div>

          {loading && (
            <div className="register-progress">
              <div className="register-progress-bar" style={{ width: `${progress}%` }} />
              <div className="register-progress-text">
                {progress < 50 && t('loading.checking')}
                {progress >= 50 && progress < 90 && t('loading.connecting')}
                {progress >= 90 && t('loading.connected')}
              </div>
            </div>
          )}

          <button className="btn btn-gold btn-auth" type="submit" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> {t('auth.login.loading')}</> : t('auth.login.btn')}
          </button>
        </form>

        <div className="auth-divider"><span>{t('auth.or')}</span></div>

        <p className="auth-footer">
          {t('auth.no_account')} <Link to="/inscription">{t('auth.register_free')}</Link>
        </p>
      </div>
    </div>
  );
}
