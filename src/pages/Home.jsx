import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TutorialCreateAccount from '../components/TutorialCreateAccount';
import TutorialReadPredictions from '../components/TutorialReadPredictions';

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

  return (
    <div className="home-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎰 BACCARAT PRO</Link>
        <div className="navbar-actions">
          {user ? (
            <Link to="/choisir" className="btn btn-gold btn-sm">Mon espace</Link>
          ) : (
            <>
              <Link to="/connexion" className="btn btn-ghost btn-sm">Connexion</Link>
              <Link to="/inscription" className="btn btn-gold btn-sm">S'inscrire</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <span>🎯</span>
          <span>PRÉDICTIONS EN TEMPS RÉEL — 1xBET BACCARAT</span>
        </div>
        <h1>Baccarat Pro<br />Vos signaux live</h1>
        <p>
          Connectez-vous, choisissez votre canal et recevez des prédictions automatiques
          générées en direct à partir des parties 1xBet.
        </p>
        <div className="hero-cta">
          <Link to="/inscription" className="btn btn-gold btn-lg">Créer mon compte</Link>
          <Link to="/connexion" className="btn btn-ghost btn-lg">Se connecter</Link>
        </div>
      </section>

      {/* Channels */}
      <section className="strategies-section">
        <div className="section-title">
          <div className="section-badge">NOS CANAUX</div>
          <h2>4 Canaux de Prédiction</h2>
          <p>Choisissez le canal qui vous correspond après connexion</p>
        </div>
        <div className="strategies-grid">
          {CHANNELS.map(c => (
            <div className="strategy-card" key={c.name} style={{ '--sc': c.color }}>
              <div className="strategy-icon-wrap">
                <span className="strategy-icon" style={{ color: c.color }}>{c.icon}</span>
              </div>
              <h3 style={{ color: c.color }}>{c.name}</h3>
              <p>{c.desc}</p>
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
            <h2 style={{ color: '#f8fafc' }}>Comment utiliser Baccarat Pro</h2>
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
          <Link to="/inscription" className="btn btn-gold btn-lg">Créer mon compte</Link>
        </div>
      </section>

      <footer className="footer">
        <span>🎰 BACCARAT PRO</span>
        <span>Prédictions algorithmiques — 1xBet Baccarat</span>
      </footer>
    </div>
  );
}
