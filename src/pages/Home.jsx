import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TalkingMascot from '../components/TalkingMascot';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';

const STEPS = [
  {
    n: '01',
    icon: '📝',
    title: "Créer un compte",
    desc: "Remplissez le formulaire d'inscription avec votre nom d'utilisateur et mot de passe.",
  },
  {
    n: '02',
    icon: '✅',
    title: "Attendre la validation",
    desc: "L'administrateur examine votre demande et active votre accès avec une durée d'abonnement définie.",
  },
  {
    n: '03',
    icon: '🎯',
    title: "Choisir un canal",
    desc: "Une fois connecté, choisissez parmi les 4 canaux disponibles : Pique Noir, Cœur Rouge, Carreau Doré ou Double Canal.",
  },
  {
    n: '04',
    icon: '📡',
    title: "Suivre les prédictions",
    desc: "Le tableau de bord affiche en temps réel les parties en direct et les prédictions générées automatiquement.",
  },
  {
    n: '05',
    icon: '📋',
    title: "Lire l'historique",
    desc: "Consultez l'historique de chaque canal : numéro de partie, résultat, cartes joueur et banquier, total de points.",
  },
];

const CHANNELS = [
  { icon: '♠', color: '#3b82f6', glow: 'rgba(59,130,246,0.25)', name: 'Pique Noir', desc: 'Signaux sur absences de symboles noirs — précision maximale', badge: 'B=5', rate: '82%' },
  { icon: '♥', color: '#ef4444', glow: 'rgba(239,68,68,0.25)', name: 'Cœur Rouge', desc: 'Séquences rouges longues — rattrapage optimisé', badge: 'B=8', rate: '79%' },
  { icon: '♦', color: '#f59e0b', glow: 'rgba(245,158,11,0.25)', name: 'Carreau Doré', desc: 'Patterns dorés — signaux à haute fréquence', badge: 'B=5', rate: '81%' },
  { icon: '♣', color: '#22c55e', glow: 'rgba(34,197,94,0.25)', name: 'Double Canal', desc: 'Escalade progressive — renforcement automatique', badge: 'DC', rate: '86%' },
];

const LIVE_FEED = [
  { suit: '♠', result: '✅', game: 'N847', user: 'K***e' },
  { suit: '♥', result: '✅', game: 'N846', user: 'M***s' },
  { suit: '♦', result: '✅', game: 'N845', user: 'J***o' },
  { suit: '♣', result: '❌', game: 'N844', user: 'A***n' },
  { suit: '♠', result: '✅', game: 'N843', user: 'S***a' },
  { suit: '♥', result: '✅', game: 'N842', user: 'B***k' },
  { suit: '♦', result: '✅', game: 'N841', user: 'C***l' },
  { suit: '♣', result: '✅', game: 'N840', user: 'R***t' },
];

const WELCOME_LINES = [
  'Bienvenue ! Vous êtes les bienvenus sur Baccara Prediction de Sossou Kouamé Apollinaire.',
  'Je suis disponible pour vos suggestions, recommandations et tout ce dont vous avez besoin.',
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { autoT, t } = useLanguage();
  const [broadcastMsg, setBroadcastMsg] = useState(null);
  const [navLoading, setNavLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [tickerIdx, setTickerIdx] = useState(0);
  const sectionsRef = useRef([]);

  useEffect(() => {
    const timer = setTimeout(() => setShowWelcome(true), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setTickerIdx(i => (i + 1) % LIVE_FEED.length), 2500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

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

      {showWelcome && (
        <div className="welcome-popup-overlay" onClick={e => { if (e.target === e.currentTarget) setShowWelcome(false); }}>
          <div className="welcome-popup">
            <button className="welcome-popup-close" onClick={() => setShowWelcome(false)} aria-label="Fermer">✕</button>
            <TalkingMascot
              lines={WELCOME_LINES}
              imageSrc="/sossou.png"
              primaryColor="#d4a843"
              skipLabel={autoT('Fermer ✕')}
              onDone={() => setShowWelcome(false)}
            />
          </div>
        </div>
      )}

      {/* ── Bandeau ticker live ── */}
      <div style={{
        background: 'linear-gradient(90deg, #0a0f1a 0%, #111827 50%, #0a0f1a 100%)',
        borderBottom: '1px solid rgba(212,168,67,0.15)',
        padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 16,
        overflow: 'hidden', position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: '#22c55e', letterSpacing: 1 }}>LIVE</span>
        </div>
        <div style={{ display: 'flex', gap: 20, overflow: 'hidden', flex: 1, alignItems: 'center' }}>
          {LIVE_FEED.map((f, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, flexShrink: 0,
              color: f.result === '✅' ? '#86efac' : '#fca5a5',
              opacity: i === tickerIdx ? 1 : 0.35,
              transition: 'opacity 0.4s',
            }}>
              <span>{f.result}</span>
              <span style={{ color: '#94a3b8' }}>{f.suit} #{f.game}</span>
              <span style={{ color: '#475569', fontWeight: 400 }}>{f.user}</span>
            </span>
          ))}
        </div>
        <div style={{ flexShrink: 0, fontSize: 10, color: '#374151', fontWeight: 600 }}>1xBet Baccarat</div>
      </div>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 {t('app.name')}</Link>
        <div className="navbar-actions">
          {user ? (
            <Link to="/choisir" onClick={goWithLoader('/choisir')} className="btn btn-gold btn-sm">{autoT('Mon espace')}</Link>
          ) : (
            <>
              <Link to="/connexion" onClick={goWithLoader('/connexion')} className="btn btn-ghost btn-sm">{t('nav.login')}</Link>
              <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-sm">{t('nav.register')}</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero — version premium */}
      <section className="hero hero-v2">
        <div className="hero-grid-bg" />
        <div className="hero-aurora aurora-1" />
        <div className="hero-aurora aurora-2" />
        <div className="hero-aurora aurora-3" />

        <div className="hero-float hero-float-1">♠</div>
        <div className="hero-float hero-float-2">♥</div>
        <div className="hero-float hero-float-3">♦</div>
        <div className="hero-float hero-float-4">♣</div>
        <div className="hero-chip hero-chip-1">🎲</div>
        <div className="hero-chip hero-chip-2">🎯</div>

        <div className="hero-content">
          <div className="hero-badge hero-badge-pulse">
            <span className="hero-badge-dot" />
            <span>{autoT('EN DIRECT')}</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>{autoT('PRÉDICTIONS 1XBET BACCARAT')}</span>
          </div>

          <h1 className="hero-title">
            <span className="hero-title-line1">{t('app.name')}</span>
            <span className="hero-title-line2">
              {t('app.tagline')}
            </span>
          </h1>

          <p className="hero-subtitle">
            {t('app.subtitle')}
          </p>

          <div className="hero-cta">
            <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-lg btn-shine">
              ✨ {autoT('Créer mon compte')}
            </Link>
            <Link to="/connexion" onClick={goWithLoader('/connexion')} className="btn btn-ghost btn-lg">
              🚀 {t('nav.login')}
            </Link>
          </div>

          {/* Code promo 1xBet */}
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: 'linear-gradient(135deg, rgba(212,168,67,0.12) 0%, rgba(212,168,67,0.06) 100%)',
                border: '1.5px solid rgba(212,168,67,0.35)',
                borderRadius: 12, padding: '10px 20px',
                cursor: 'pointer', userSelect: 'all',
              }}
              title={autoT('Cliquez pour copier')}
              onClick={() => {
                navigator.clipboard?.writeText('Koua229').catch(() => {});
                const el = document.getElementById('promo-copied');
                if (el) { el.style.opacity = 1; setTimeout(() => { el.style.opacity = 0; }, 1500); }
              }}
            >
              <span style={{ fontSize: 16 }}>🎁</span>
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, letterSpacing: 0.5 }}>{autoT('CODE PROMO 1XBET')} :</span>
              <span style={{ fontSize: 17, fontWeight: 900, color: '#f0b429', fontFamily: 'monospace', letterSpacing: 2 }}>Koua229</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>📋</span>
            </div>
            <span id="promo-copied" style={{ marginLeft: 10, fontSize: 12, color: '#22c55e', fontWeight: 700, opacity: 0, transition: 'opacity 0.3s' }}>{autoT('Copié !')}</span>
          </div>

          {/* Trust strip */}
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-num">4</div>
              <div className="hero-stat-lbl">{autoT('Canaux dédiés')}</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">24/7</div>
              <div className="hero-stat-lbl">{autoT('Temps réel')}</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">⚡</div>
              <div className="hero-stat-lbl">{autoT('Réponse instantanée')}</div>
            </div>
            <div className="hero-stat-sep" />
            <div className="hero-stat">
              <div className="hero-stat-num">🔐</div>
              <div className="hero-stat-lbl">{autoT('Accès sécurisé')}</div>
            </div>
          </div>
        </div>

        {/* Mini live mockup card */}
        <div className="hero-mock">
          <div className="hero-mock-head">
            <span className="hero-mock-dot red" />
            <span className="hero-mock-dot amber" />
            <span className="hero-mock-dot green" />
            <span className="hero-mock-title">📡 {autoT('Canal Cœur Rouge')} — Live</span>
          </div>
          <div className="hero-mock-body">
            <div className="hero-mock-row">
              <span className="hero-mock-tag">{autoT('PARTIE')}</span>
              <span className="hero-mock-game">#N821</span>
              <span className="hero-mock-status live">● {autoT('EN COURS')}</span>
            </div>
            <div className="hero-mock-pred">
              <div className="hero-mock-pred-label">{autoT('Prédiction active')}</div>
              <div className="hero-mock-pred-suit">♥</div>
              <div className="hero-mock-pred-text">{autoT('Cœur Rouge attendu')}</div>
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


      {/* ── Statistiques strip ── */}
      <section className="stats-section">
        {[
          { num: '4',    lbl: autoT('Canaux dédiés'),       icon: '📡' },
          { num: '24/7', lbl: autoT('Temps réel'),           icon: '⚡' },
          { num: '82%+', lbl: autoT('Taux de précision'),    icon: '🎯' },
          { num: '100%', lbl: autoT('Automatique & Sécurisé'), icon: '🔐' },
        ].map((s, i) => (
          <div className={`stat-box fade-up fade-up-d${i + 1}`} key={i}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
            <div className="stat-box-num">{s.num}</div>
            <div className="stat-box-lbl">{s.lbl}</div>
          </div>
        ))}
      </section>

      {/* ── Canaux disponibles ── */}
      <section className="channels-section">
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="section-title fade-up">
            <div className="section-badge">🃏 {autoT('NOS CANAUX')}</div>
            <h2>{autoT('4 canaux de prédiction')}</h2>
            <p>{autoT('Choisissez le canal adapté à votre style de jeu')}</p>
          </div>
          <div className="channels-grid">
            {CHANNELS.map((ch, i) => (
              <div
                key={ch.name}
                className={`channel-card-v2 fade-up fade-up-d${i + 1}`}
                style={{ '--ch-c': ch.color }}
              >
                <div className="channel-card-shine" />
                <div className="channel-card-icon">{ch.icon}</div>
                <h3>{autoT(ch.name)}</h3>
                <p>{autoT(ch.desc)}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="channel-rate-badge">🎯 {ch.rate}</span>
                  <span className="channel-b-badge">Seuil {ch.badge}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to use */}
      <section className="how-section">
        <div className="section-title fade-up">
          <div className="section-badge">{autoT("GUIDE D'UTILISATION")}</div>
          <h2>{autoT("Comment utiliser l'application")}</h2>
          <p>{autoT('Suivez ces étapes pour bien démarrer')}</p>
        </div>
        <div className="how-steps">
          {STEPS.map((h, i) => (
            <div className={`how-step fade-up fade-up-d${i + 1}`} key={h.n}>
              <div className="how-step-icon-box">{h.icon}</div>
              <div className="how-step-body">
                <h4>{autoT(h.title)}</h4>
                <p>{autoT(h.desc)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dashboard preview guide */}
      <section className="how-section" style={{ background: '#f8fafc' }}>
        <div className="section-title fade-up">
          <div className="section-badge">{autoT('TABLEAU DE BORD')}</div>
          <h2>{autoT('Lire le tableau de bord')}</h2>
          <p>{autoT('Comprendre les informations affichées')}</p>
        </div>
        <div className="home-guide-grid">
          {[
            { icon: '⚡', title: autoT('Parties Live'), desc: autoT("Les parties en cours s'affichent avec les cartes joueur et banquier ainsi que les points de chaque côté.") },
            { icon: '🎯', title: autoT('Zone de prédiction'), desc: autoT("La prédiction active s'affiche ici avec le symbole prédit. Elle se met à jour automatiquement en temps réel.") },
            { icon: '📋', title: autoT('Historique'), desc: autoT('Chaque ligne affiche le numéro de partie, le résultat (✅ gagné / ❌ perdu), les cartes et les points totaux.') },
            { icon: '🏆', title: autoT("Format de l'historique"), extra: <><code>#N687. ✅9(9♣10♥) - 8(7♠A♦) #T17</code><br />{autoT('Numéro · Résultat · Points joueur (cartes) - Points banquier (cartes) · Total')}</> },
          ].map((g, i) => (
            <div className={`home-guide-card fade-up fade-up-d${i + 1}`} key={i}>
              <div className="home-guide-icon">{g.icon}</div>
              <h4>{g.title}</h4>
              {g.desc && <p>{g.desc}</p>}
              {g.extra && <p>{g.extra}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="cta-box fade-up">
          <div className="cta-glow" />
          <h2>{autoT('Prêt à commencer ?')}</h2>
          <p>{autoT('Créez votre compte et attendez la validation pour accéder aux signaux en direct.')}</p>
          <Link to="/inscription" onClick={goWithLoader('/inscription')} className="btn btn-gold btn-lg btn-shine">✨ {autoT('Créer mon compte')}</Link>
        </div>
      </section>

      {/* ── SECTION CONTACT / ABONNEMENT ── */}
      <section style={{ background: 'linear-gradient(180deg, #0a0f1a 0%, #060b14 100%)', padding: '64px 24px 0' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '4px 16px', fontSize: 11, fontWeight: 700, color: '#fbbf24', letterSpacing: 1, marginBottom: 20 }}>
            {autoT("REJOINDRE L'APPLICATION")}
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: '#f8fafc', margin: '0 0 12px' }}>
            {autoT('Accès à Prediction Baccara Pro')} — 100$
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
            {autoT('Pour bénéficier de l\'application, contactez directement nos promoteurs sur WhatsApp.')}<br />
            {autoT('Cliquez sur un numéro ci-dessous pour démarrer la conversation.')}
          </p>

          {/* Code promo 1xBet — section contact */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(212,168,67,0.1) 0%, rgba(212,168,67,0.04) 100%)',
              border: '1.5px solid rgba(212,168,67,0.3)',
              borderRadius: 14, padding: '14px 28px',
              boxShadow: '0 0 30px rgba(212,168,67,0.08)',
            }}>
              <span style={{ fontSize: 22 }}>🎁</span>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{autoT('Votre code promo 1xBet')}</div>
                <div
                  style={{ fontSize: 22, fontWeight: 900, color: '#f0b429', fontFamily: 'monospace', letterSpacing: 3, cursor: 'pointer' }}
                  title={autoT('Cliquez pour copier')}
                  onClick={() => {
                    navigator.clipboard?.writeText('Koua229').catch(() => {});
                    const el = document.getElementById('promo-copied2');
                    if (el) { el.style.opacity = 1; setTimeout(() => { el.style.opacity = 0; }, 1500); }
                  }}
                >
                  Koua229 📋
                </div>
                <span id="promo-copied2" style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, opacity: 0, transition: 'opacity 0.3s' }}>{autoT('Copié !')}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', maxWidth: 160, lineHeight: 1.5, textAlign: 'left' }}>
                {autoT('Utilisez ce code lors de votre inscription sur 1xBet pour bénéficier des bonus exclusifs.')}
              </div>
            </div>
          </div>

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
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{autoT('Promoteur du site')}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 4 }}>BUZZ INFLUENCE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <span style={{ fontSize: 20 }}>🟢</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#25d366', fontFamily: 'monospace' }}>+225 07 67 20 22 71</span>
                </div>
              </div>
              <div style={{ marginTop: 4, background: '#25d366', color: '#fff', borderRadius: 8, padding: '8px 20px', fontWeight: 800, fontSize: 13 }}>
                💬 {autoT('Envoyer un message WhatsApp')}
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
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{autoT('Développeur')}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 4 }}>SOSSOU Kouamé</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                  <span style={{ fontSize: 20 }}>🟢</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#25d366', fontFamily: 'monospace' }}>+229 01 95 50 15 64</span>
                </div>
              </div>
              <div style={{ marginTop: 4, background: '#25d366', color: '#fff', borderRadius: 8, padding: '8px 20px', fontWeight: 800, fontSize: 13 }}>
                💬 {autoT('Envoyer un message WhatsApp')}
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
              📣 {autoT("Message de l'administration")}
            </div>
            <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
              {broadcastMsg.text}
            </div>
            {broadcastMsg.updated_at && (
              <div style={{ fontSize: 10, color: '#475569', marginTop: 10 }}>
                {autoT('Publié le')} {new Date(broadcastMsg.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
            <button
              onClick={() => setBroadcastMsg(null)}
              style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1 }}
              title={autoT('Fermer')}
            >✕</button>
          </div>
        </section>
      )}

      <footer className="footer" style={{ flexDirection: 'column', gap: 6, padding: '20px 24px', position: 'relative' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🎲 {t('app.name')}</span>
        <span style={{ fontSize: 12, color: '#475569' }}>{autoT('Prédictions algorithmiques')} — 1xBet Baccarat</span>
        <div style={{ display: 'flex', gap: 24, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center', fontSize: 12, color: '#374151' }}>
          <span>{autoT('Promoteur')} : BUZZ INFLUENCE · <a href="https://wa.me/2250767202271" target="_blank" rel="noopener noreferrer" style={{ color: '#25d366', textDecoration: 'none' }}>+225 07 67 20 22 71</a></span>
          <span>{autoT('Développeur')} : SOSSOU Kouamé · <a href="https://wa.me/2290195501564" target="_blank" rel="noopener noreferrer" style={{ color: '#25d366', textDecoration: 'none' }}>+229 01 95 50 15 64</a></span>
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
          title={autoT('Espace programmation')}
        >
          {autoT('Programmation')}
        </a>
      </footer>
    </div>
  );
}
