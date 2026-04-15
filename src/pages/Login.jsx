import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(form.username, form.password);
      if (result?.redirect) {
        navigate(result.redirect, { replace: true });
        return;
      }
      navigate(result.is_admin ? '/admin' : '/choisir', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-orb orb1" />
      <div className="auth-bg-orb orb2" />

      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-icon">🎲</div>
          <h1>Prediction Baccara Pro</h1>
          <p>Connectez-vous à votre compte</p>
        </div>

        {error && (
          <div className="alert alert-error">
            <span>⚠️</span> {error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Identifiant ou email</label>
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
            <label className="form-label">Mot de passe</label>
            <div className="input-wrap">
              <span className="input-icon">🔒</span>
              <input
                className="form-input has-icon"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={set('password')}
                required
              />
            </div>
          </div>
          <button className="btn btn-gold btn-auth" type="submit" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Connexion...</> : '🚀 Se connecter'}
          </button>
        </form>

        <div className="auth-divider"><span>ou</span></div>

        <p className="auth-footer">
          Pas encore de compte ? <Link to="/inscription">S'inscrire gratuitement</Link>
        </p>
      </div>
    </div>
  );
}
