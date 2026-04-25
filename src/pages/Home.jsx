import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TutorialCreateAccount from '../components/TutorialCreateAccount';
import TutorialReadPredictions from '../components/TutorialReadPredictions';
import { useState, useEffect } from 'react';

const STEPS = [
  {
    n: '01',
    icon: '📝',
    title: 'Créer un compte',
    desc: 'Remplissez le formulaire d\'inscription avec votre nom d\'utilisateur et mot de passe.',
  },
  {
    n: '02',
    icon: '✅',
    title: 'Attendre la validation',
    desc: 'L\'administrateur examine votre demande et active votre accès avec une durée d\'abonnement définie.',
  },
  {
    n: '03',
    icon: '🎯',
    title: 'Choisir un canal',
    desc: 'Une fois connecté, choisissez parmi les 4 canaux disponibles : Pique Noir, Cœur Rouge, Carreau Doré ou Double Canal.',
  },
  {
    n: '04',
    icon: '📡',
    title: 'Suivre les prédictions',
    desc: 'Le tableau de bord affiche en temps réel les parties en direct et les prédictions générées automatiquement.',
  },
  {
    n: '05',
    icon: '📋',
    title: 'Lire l\'historique',
    desc: 'Consultez l\'historique de chaque canal : numéro de partie, résultat, cartes joueur et banquier, total de points.',
  },
];

const CHANNELS = [
  { icon: '♠', color: '#3b82f6', name: 'Pique Noir', desc: 'Canal de signaux basé sur les symboles noirs' },
  { icon: '♥', color: '#ef4444', name: 'Cœur Rouge', desc: 'Canal de signaux basé sur les symboles rouges' },
  { icon: '♦', color: '#f59e0b', name: 'Carreau Doré', desc: 'Canal de signaux à séquences dorées' },
  { icon: '♣', color: '#22c55e', name: 'Double Canal', desc: 'Canal de rattrapage et renforcement' },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [broadcastMsg, setBroadcastMsg] = useState(null);
  const [navLoading, setNavLoading] = useState(false);

  // Animated transition when clicking on CTA buttons
  const goWithLoader = (path) => (e) => {
    e.preventDefault();
    setNavLoading(true);
    setTimeout(() => navigate(path), 650);
  };

  useEffect(() => {
    if (!user) return;
    fetch('/api/broadcast-message', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        // Determine user status
        let status = 'pending';
        if (user.is_approved) {
          const exp = user.subscription_expires_at;
          if (!exp || new Date(exp) > new Date()) status = 'active';
          else status = 'expired';
        }
        if (d.targets && d.targets.includes(status)) setBroadcastMsg(d);
      })
      .catch(() => {});
  }, [user]);

  return (
    <div className="home-page">
      {navLoading && <div className="top-loader" />}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          {user ? (
            <Link to="/choisir" onClick={goWithLoader('/choisir')} className="btn btn-gold btn-sm">Mon espace</Link>
          ) : (
            <>
              <Link to="/connexion" onClick={goWithLoader('/connexion')} className="btn btn-ghost btn-sm">Connexion</Link>
              <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-sm">S'inscrire</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero — version premium */}
      <section className="hero hero-v2">
        {/* Background animated layers */}
        <div className="hero-grid-bg" />
        <div className="hero-aurora aurora-1" />
        <div className="hero-aurora aurora-2" />
        <div className="hero-aurora aurora-3" />

        {/* Floating decorative cards */}
        <div className="hero-float hero-float-1">♠</div>
        <div className="hero-float hero-float-2">♥</div>
        <div className="hero-float hero-float-3">♦</div>
        <div className="hero-float hero-float-4">♣</div>
        <div className="hero-chip hero-chip-1">🎲</div>
        <div className="hero-chip hero-chip-2">🎯</div>

        <div className="hero-content">
          <div className="hero-badge hero-badge-pulse">
            <span className="hero-badge-dot" />
            <span>EN DIRECT</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>PRÉDICTIONS 1XBET BACCARAT</span>
          </div>

          <h1 className="hero-title">
            <span className="hero-title-line1">Prediction Baccara Pro</span>
            <span className="hero-title-line2">
              Vos signaux <span className="hero-title-glow">live</span>, en temps réel
            </span>
          </h1>

          <p className="hero-subtitle">
            Inscrivez-vous, choisissez votre canal et recevez des prédictions automatiques
            générées en direct à partir des parties 1xBet — sans rien rater.
          </p>

          <div className="hero-cta">
            <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-lg btn-shine">
              ✨ Créer mon compte
            </Link>
            <Link to="/connexion" onClick={goWithLoader('/connexion')} className="btn btn-ghost btn-lg">
              🚀 Se connecter
            </Link>
          </div>

          {/* Trust strip */}
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-num">4</div>
              <div className="hero-stat-lbl">Canaux dédiés</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">24/7</div>
              <div className="hero-stat-lbl">Temps réel</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">⚡</div>
              <div className="hero-stat-lbl">Réponse instantanée</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">🔐</div>
              <div className="hero-stat-lbl">Accès sécurisé</div>
            </div>
          </div>
        </div>

        {/* Mini live mockup card */}
        <div className="hero-mock">
          <div className="hero-mock-head">
            <span className="hero-mock-dot red" />
            <span className="hero-mock-dot amber" />
            <span className="hero-mock-dot green" />
            <span className="hero-mock-title">📡 Canal Cœur Rouge — Live</span>
          </div>
          <div className="hero-mock-body">
            <div className="hero-mock-row">
              <span className="hero-mock-tag">PARTIE</span>
              <span className="hero-mock-game">#N821</span>
              <span className="hero-mock-status live">● EN COURS</span>
            </div>
            <div className="hero-mock-pred">
              <div className="hero-mock-pred-label">Prédiction active</div>
              <div className="hero-mock-pred-suit">♥</div>
              <div className="hero-mock-pred-text">Cœur Rouge attendu</div>
            </div>
            <div className="hero-mock-history">
              <span className="hero-mock-h ok">✅ #819</span>
              <span className="hero-mock-h ok">✅ #818</span>
              <span className="hero-mock-h ko">❌ #817</span>
              <span className="hero-mock-h ok">✅ #816</span>
              <span className="hero-mock-h ok">✅ #815</span>
            </div>
          </div>
          <div className="hero-mock-glow" />
        </div>
      </section>

      {/* Channels — premium */}
      <section className="strategies-section strategies-section-v2">
        <div className="section-title">
          <div className="section-badge">NOS CANAUX</div>
          <h2>4 Canaux de Prédiction</h2>
          <p>Choisissez le canal qui vous correspond après connexion</p>
        </div>
        <div className="strategies-grid">
          {CHANNELS.map((c, i) => (
            <div className="strategy-card strategy-card-v2" key={c.name} style={{ '--sc': c.color, animationDelay: `${i * 0.1}s` }}>
              <div className="strategy-card-shine" />
              <div className="strategy-icon-wrap">
                <span className="strategy-icon" style={{ color: c.color }}>{c.icon}</span>
              </div>
              <h3 style={{ color: c.color }}>{c.name}</h3>
              <p>{c.desc}</p>
              <div className="strategy-card-foot">
                <span className="strategy-card-live">● Actif 24/7</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How to use */}
      <section className="how-section">
        <div className="section-title">
          <div className="section-badge">GUIDE D'UTILISATION</div>
          <h2>Comment utiliser l'application</h2>
          <p>Suivez ces étapes pour bien démarrer</p>
        </div>
        <div className="how-steps">
          {STEPS.map(h => (
            <div className="how-step" key={h.n}>
              <div className="how-step-num">{h.icon}</div>
              <div className="how-step-body">
                <h4>{h.title}</h4>
                <p>{h.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dashboard preview guide */}
      <section className="how-section" style={{ background: '#f8fafc' }}>
        <div className="section-title">
          <div className="section-badge">TABLEAU DE BORD</div>
          <h2>Lire le tableau de bord</h2>
          <p>Comprendre les informations affichées</p>
        </div>
        <div className="home-guide-grid">
          <div className="home-guide-card">
            <div className="home-guide-icon">⚡</div>
            <h4>Parties Live</h4>
            <p>Les parties en cours s'affichent avec les cartes joueur et banquier ainsi que les points de chaque côté.</p>
          </div>
          <div className="home-guide-card">
            <div className="home-guide-icon">🎯</div>
            <h4>Zone de prédiction</h4>
            <p>La prédiction active s'affiche ici avec le symbole prédit. Elle se met à jour automatiquement en temps réel.</p>
          </div>
          <div className="home-guide-card">
            <div className="home-guide-icon">📋</div>
            <h4>Historique</h4>
            <p>Chaque ligne affiche le numéro de partie, le résultat (✅ gagné / ❌ perdu), les cartes et les points totaux.</p>
          </div>
          <div className="home-guide-card">
            <div className="home-guide-icon">🏆</div>
            <h4>Format de l'historique</h4>
            <p><code>#N687. ✅9(9♣10♥) - 8(7♠A♦) #T17</code><br />Numéro · Résultat · Points joueur (cartes) - Points banquier (cartes) · Total</p>
          </div>
        </div>
      </section>

      {/* ── TUTORIAL VIDEOS ── */}
      <section style={{
        padding: '80px 24px',
        background: 'linear-gradient(180deg, #0b1220 0%, #0a0f1a 100%)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 300, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(251,191,36,0.04), transparent)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="section-title" style={{ marginBottom: 52 }}>
            <div className="section-badge" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>TUTORIELS VIDÉO</div>
            <h2 style={{ color: '#f8fafc' }}>Comment utiliser Prediction Baccara Pro</h2>
            <p style={{ color: '#475569' }}>Deux guides animés pour démarrer rapidement</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 40, alignItems: 'start' }}>
            {/* Video 1 */}
            <div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#d97706,#fbbf24)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📝</div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Comment créer un compte</h3>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, paddingLeft: 44, margin: 0 }}>
                  De l'inscription jusqu'à la validation par l'administrateur — suivez chaque étape pour accéder aux signaux.
                </p>
              </div>
              <TutorialCreateAccount />
            </div>

            {/* Video 2 */}
            <div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📡</div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Lire les prédictions</h3>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, paddingLeft: 44, margin: 0 }}>
                  Choisissez un canal, suivez les parties en direct et interprétez chaque prédiction et résultat en temps réel.
                </p>
              </div>
              <TutorialReadPredictions />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-box">
          <div className="cta-glow" />
          <h2>Prêt à commencer ?</h2>
          <p>Créez votre compte et attendez la validation pour accéder aux signaux en direct.</p>
          <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-lg">Créer mon compte</Link>
        </div>
      </section>

      {/* ── SECTION CONTACT / ABONNEMENT ── */}
      <section style={{ background: 'linear-gradient(180deg, #0a0f1a 0%, #060b14 100%)', padding: '64px 24px 0' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '4px 16px', fontSize: 11, fontWeight: 700, color: '#fbbf24', letterSpacing: 1, marginBottom: 20 }}>
            REJOINDRE L'APPLICATION
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: '#f8fafc', margin: '0 0 12px' }}>
            Accès à Prediction Baccara Pro — 100$
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, marginBottom: 40 }}>
            Pour bénéficier de l'application, contactez directement nos promoteurs sur WhatsApp.<br />
            Cliquez sur un numéro ci-dessous pour démarrer la conversation.
          </p>

          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
            {/* Promoteur */}
            <a
              href="https://wa.me/2250767202271?text=Bonjour%2C%20je%20souhaite%20b%C3%A9n%C3%A9ficier%20de%20l%E2%80%99application%20Baccarat%20Pro%20%C3%A0%20100%20dollars."
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(37,211,102,0.07)', border: '1.5px solid rgba(37,211,102,0.3)', borderRadius: 16, padding: '24px 32px', minWidth: 260, cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s' }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(37,211,102,0.2)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
            >
              <div style={{ fontSize: 32 }}>📣</div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Promoteur du site</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 4 }}>BUZZ INFLUENCE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <span style={{ fontSize: 20 }}>🟢</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#25d366', fontFamily: 'monospace' }}>+225 07 67 20 22 71</span>
                </div>
              </div>
              <div style={{ marginTop: 4, background: '#25d366', color: '#fff', borderRadius: 8, padding: '8px 20px', fontWeight: 800, fontSize: 13 }}>
                💬 Envoyer un message WhatsApp
              </div>
            </a>

            {/* Développeur */}
            <a
              href="https://wa.me/2290195501564?text=Bonjour%2C%20je%20souhaite%20b%C3%A9n%C3%A9ficier%20de%20l%E2%80%99application%20Baccarat%20Pro%20%C3%A0%20100%20dollars."
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(59,130,246,0.07)', border: '1.5px solid rgba(59,130,246,0.3)', borderRadius: 16, padding: '24px 32px', minWidth: 260, cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s' }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(59,130,246,0.2)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
            >
              <div style={{ fontSize: 32 }}>💻</div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Développeur</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 4 }}>SOSSOU Kouamé</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <span style={{ fontSize: 20 }}>🟢</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#25d366', fontFamily: 'monospace' }}>+229 01 95 50 15 64</span>
                </div>
              </div>
              <div style={{ marginTop: 4, background: '#25d366', color: '#fff', borderRadius: 8, padding: '8px 20px', fontWeight: 800, fontSize: 13 }}>
                💬 Envoyer un message WhatsApp
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ── Message broadcast admin ── */}
      {broadcastMsg && (
        <section style={{ padding: '0 24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.13) 0%, rgba(139,92,246,0.08) 100%)',
            border: '1px solid rgba(99,102,241,0.35)',
            borderLeft: '5px solid #6366f1',
            borderRadius: '0 14px 14px 0',
            padding: '18px 22px',
            position: 'relative',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#818cf8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              📣 Message de l'administration
            </div>
            <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
              {broadcastMsg.text}
            </div>
            {broadcastMsg.updated_at && (
              <div style={{ fontSize: 10, color: '#475569', marginTop: 10 }}>
                Publié le {new Date(broadcastMsg.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
            <button
              onClick={() => setBroadcastMsg(null)}
              style={{
                position: 'absolute', top: 12, right: 14,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#475569', fontSize: 16, lineHeight: 1,
              }}
              title="Fermer"
            >✕</button>
          </div>
        </section>
      )}

      <footer className="footer" style={{ flexDirection: 'column', gap: 6, padding: '20px 24px', position: 'relative' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🎲 Prediction Baccara Pro</span>
        <span style={{ fontSize: 12, color: '#475569' }}>Prédictions algorithmiques — 1xBet Baccarat</span>
        <div style={{ display: 'flex', gap: 24, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center', fontSize: 12, color: '#374151' }}>
          <span>Promoteur : BUZZ INFLUENCE · <a href="https://wa.me/2250767202271" target="_blank" rel="noopener noreferrer" style={{ color: '#25d366', textDecoration: 'none' }}>+225 07 67 20 22 71</a></span>
          <span>Développeur : SOSSOU Kouamé · <a href="https://wa.me/2290195501564" target="_blank" rel="noopener noreferrer" style={{ color: '#25d366', textDecoration: 'none' }}>+229 01 95 50 15 64</a></span>
        </div>
        <a
          href="/programmation"
          style={{
            position: 'absolute', bottom: 14, right: 18,
            fontSize: 10, color: '#1e293b', textDecoration: 'none',
            padding: '4px 10px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.04)',
            background: 'rgba(255,255,255,0.02)',
            letterSpacing: 0.5, fontWeight: 600,
            transition: 'color 0.2s, border-color 0.2s',
          }}
          onMouseOver={e => { e.currentTarget.style.color = '#334155'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          onMouseOut={e => { e.currentTarget.style.color = '#1e293b'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
          title="Espace programmation"
        >
          Programmation
        </a>
      </footer>
    </div>
  );
}
