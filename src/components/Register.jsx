import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Les mots de passe ne correspondent pas');
    if (form.password.length < 6) return setError('Mot de passe trop court (6 caractères minimum)');
    setLoading(true);
    try {
      await register(form.username, form.email, form.password);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-bg-orb orb1" />
        <div className="auth-bg-orb orb2" />
        <div className="auth-box success-box">
          <div className="success-icon">✅</div>
          <h2>Inscription réussie !</h2>
          <p>
            Votre compte a été créé avec succès.<br />
            L'administrateur doit valider votre accès avant que vous puissiez voir les prédictions.
          </p>
          <div className="alert alert-info">
            📬 Vous serez notifié dès que votre compte est approuvé et la durée d'accès définie.
          </div>
          <Link to="/connexion" className="btn btn-gold" style={{ marginTop: 8 }}>Se connecter</Link>
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
            <div className="input-wrap">
              <span className="input-icon">🔒</span>
              <input className="form-input has-icon" type="password" placeholder="Minimum 6 caractères"
                value={form.password} onChange={set('password')} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Confirmer le mot de passe</label>
            <div className="input-wrap">
              <span className="input-icon">🔐</span>
              <input className="form-input has-icon" type="password" placeholder="Répéter le mot de passe"
                value={form.confirm} onChange={set('confirm')} required />
            </div>
          </div>
          <button className="btn btn-gold btn-auth" type="submit" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Inscription...</> : '✨ Créer mon compte'}
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
