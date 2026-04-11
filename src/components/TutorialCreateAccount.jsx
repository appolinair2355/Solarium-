import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SCENES = [
  { id: 'home',     label: '① Page d\'accueil',     duration: 2800 },
  { id: 'form',     label: '② Remplir le formulaire', duration: 3800 },
  { id: 'sent',     label: '③ Demande envoyée',     duration: 2400 },
  { id: 'admin',    label: '④ Validation admin',    duration: 2800 },
  { id: 'access',   label: '⑤ Accès accordé',       duration: 2600 },
];

const TOTAL_MS = SCENES.reduce((s, sc) => s + sc.duration, 0);

function useAutoScene(scenes) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const startRef = useRef(Date.now());
  const raf = useRef(null);

  useEffect(() => {
    startRef.current = Date.now();
    let sceneStart = 0;
    let sceneIdx = 0;

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const looped = elapsed % TOTAL_MS;

      let acc = 0;
      for (let i = 0; i < scenes.length; i++) {
        acc += scenes[i].duration;
        if (looped < acc) {
          const sceneElapsed = looped - (acc - scenes[i].duration);
          setIdx(i);
          setProgress(sceneElapsed / scenes[i].duration);
          break;
        }
      }
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return { idx, progress };
}

function SceneHome({ progress }) {
  const show = progress > 0.1;
  const highlight = progress > 0.45;
  const click = progress > 0.78;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px' }}>
      <motion.div initial={{ opacity: 0, y: -18 }} animate={{ opacity: show ? 1 : 0, y: show ? 0 : -18 }} transition={{ duration: 0.5 }}
        style={{ fontWeight: 900, fontSize: 22, letterSpacing: -0.5, color: '#f8fafc', marginBottom: 6 }}>
        🎰 BACCARAT PRO
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: show ? 1 : 0 }} transition={{ duration: 0.5, delay: 0.15 }}
        style={{ fontSize: 11, color: '#64748b', marginBottom: 28 }}>
        Prédictions en temps réel — 1xBet
      </motion.div>
      <div style={{ display: 'flex', gap: 10 }}>
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: show ? 1 : 0, x: show ? 0 : -12 }} transition={{ duration: 0.4, delay: 0.2 }}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
          Connexion
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 12 }} animate={{ opacity: show ? 1 : 0, x: show ? 0 : 12 }} transition={{ duration: 0.4, delay: 0.3 }}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: highlight ? 'linear-gradient(135deg,#d97706,#fbbf24)' : '#1e293b',
            color: highlight ? '#0f172a' : '#475569',
            boxShadow: highlight ? '0 0 18px rgba(251,191,36,0.45)' : 'none',
            transition: 'all 0.4s',
            outline: click ? '2px solid #fbbf24' : 'none',
          }}>
          S'inscrire →
        </motion.div>
      </div>
      {click && (
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}
          style={{ marginTop: 18, fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>
          ▲ Cliquez sur S'inscrire
        </motion.div>
      )}
    </div>
  );
}

const TYPING_TEXT = ['Jean', 'Jean', 'jean@mail.com', 'motdepasse123'];
const LABELS = ['Prénom', 'Pseudo', 'Email', 'Mot de passe'];

function SceneForm({ progress }) {
  const fields = Math.min(4, Math.floor(progress * 5.5));
  const showBtn = progress > 0.82;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px' }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 18, letterSpacing: 0.3 }}>
        📝 Créer un compte
      </motion.div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {LABELS.map((label, i) => {
          const active = fields === i;
          const done = fields > i;
          return (
            <motion.div key={label}
              initial={{ opacity: 0, x: -14 }} animate={{ opacity: fields >= i ? 1 : 0.25, x: 0 }}
              transition={{ duration: 0.35, delay: i * 0.08 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
              <div style={{
                padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                background: active ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'rgba(251,191,36,0.5)' : done ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
                color: done ? '#86efac' : active ? '#fbbf24' : '#475569',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {done ? TYPING_TEXT[i] : active ? <><span>{TYPING_TEXT[i].substring(0, Math.floor(progress * TYPING_TEXT[i].length * 2.5))}</span><motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.7, repeat: Infinity }} style={{ display: 'inline-block', width: 1, height: 12, background: '#fbbf24', marginLeft: 1 }} /></> : ''}
              </div>
            </motion.div>
          );
        })}
      </div>
      {showBtn && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
          style={{ marginTop: 14, padding: '9px 32px', borderRadius: 8, background: 'linear-gradient(135deg,#d97706,#fbbf24)', color: '#0f172a', fontSize: 12, fontWeight: 800, boxShadow: '0 4px 16px rgba(251,191,36,0.35)' }}>
          🚀 Créer mon compte
        </motion.div>
      )}
    </div>
  );
}

function SceneSent({ progress }) {
  const showCheck = progress > 0.2;
  const showText = progress > 0.45;
  const showSub = progress > 0.65;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <motion.div initial={{ scale: 0 }} animate={{ scale: showCheck ? 1 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
        ✅
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: showText ? 1 : 0, y: showText ? 0 : 8 }} transition={{ duration: 0.4 }}
        style={{ fontWeight: 800, fontSize: 15, color: '#f8fafc' }}>
        Compte créé !
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: showSub ? 1 : 0 }} transition={{ duration: 0.4 }}
        style={{ fontSize: 11, color: '#64748b', textAlign: 'center', maxWidth: 200, lineHeight: 1.5 }}>
        Votre demande est en attente de validation par l'administrateur.
      </motion.div>
    </div>
  );
}

function SceneAdmin({ progress }) {
  const showCard = progress > 0.15;
  const showApprove = progress > 0.55;
  const showClick = progress > 0.8;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 22px', gap: 12 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: showCard ? 1 : 0 }} style={{ fontSize: 11, color: '#64748b', fontWeight: 600, letterSpacing: 0.5 }}>
        PANEL ADMINISTRATEUR
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: showCard ? 1 : 0, y: showCard ? 0 : 14 }} transition={{ duration: 0.45 }}
        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Jean</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>jean@mail.com · En attente</div>
        </div>
        <motion.div animate={{ background: showApprove ? (showClick ? 'linear-gradient(135deg,#15803d,#22c55e)' : 'linear-gradient(135deg,#d97706,#fbbf24)') : '#1e293b' }}
          transition={{ duration: 0.4 }}
          style={{ padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700, color: showApprove ? '#0f172a' : '#475569', cursor: 'pointer' }}>
          {showClick ? '✅ Approuvé' : showApprove ? 'Approuver →' : 'Approuver'}
        </motion.div>
      </motion.div>
      {showApprove && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Durée :</span>
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>750 heures</span>
        </motion.div>
      )}
    </div>
  );
}

function SceneAccess({ progress }) {
  const showBadge = progress > 0.2;
  const showMsg = progress > 0.5;
  const showBtn = progress > 0.72;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: showBadge ? 1 : 0, rotate: showBadge ? 0 : -20 }} transition={{ type: 'spring', stiffness: 350, damping: 22 }}
        style={{ fontSize: 42 }}>
        🎰
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: showMsg ? 1 : 0, y: showMsg ? 0 : 10 }} transition={{ duration: 0.4 }}
        style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 900, fontSize: 15, color: '#fbbf24', marginBottom: 4 }}>Accès accordé !</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>Votre abonnement est actif</div>
      </motion.div>
      {showBtn && (
        <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
          style={{ padding: '9px 24px', borderRadius: 8, background: 'linear-gradient(135deg,#d97706,#fbbf24)', color: '#0f172a', fontSize: 12, fontWeight: 800, boxShadow: '0 4px 18px rgba(251,191,36,0.4)' }}>
          Accéder aux canaux →
        </motion.div>
      )}
    </div>
  );
}

const SCENE_COMPS = [SceneHome, SceneForm, SceneSent, SceneAdmin, SceneAccess];

export default function TutorialCreateAccount() {
  const { idx, progress } = useAutoScene(SCENES);
  const SceneComp = SCENE_COMPS[idx];

  return (
    <div style={{
      width: '100%', aspectRatio: '16/9', borderRadius: 16, overflow: 'hidden',
      background: 'linear-gradient(145deg, #0b1220 0%, #0f172a 60%, #111827 100%)',
      position: 'relative', border: '1px solid rgba(251,191,36,0.2)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(251,191,36,0.06)',
    }}>
      {/* Grid pattern */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(251,191,36,0.05) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />

      {/* Glow */}
      <motion.div animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 4, repeat: Infinity }}
        style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(251,191,36,0.08), transparent)', pointerEvents: 'none' }} />

      {/* Scene content */}
      <AnimatePresence mode="sync">
        <motion.div key={idx}
          initial={{ opacity: 0, scale: 0.95, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(4px)' }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: 'absolute', inset: 0 }}>
          <SceneComp progress={progress} />
        </motion.div>
      </AnimatePresence>

      {/* Step pills */}
      <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6, padding: '0 16px' }}>
        {SCENES.map((sc, i) => (
          <motion.div key={sc.id}
            animate={{ width: i === idx ? 28 : 7, background: i === idx ? '#fbbf24' : i < idx ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)' }}
            transition={{ duration: 0.35 }}
            style={{ height: 7, borderRadius: 4 }}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.05)' }}>
        <motion.div
          animate={{ width: `${((idx / SCENES.length) + progress / SCENES.length) * 100}%` }}
          transition={{ duration: 0.1 }}
          style={{ height: '100%', background: 'linear-gradient(90deg, #d97706, #fbbf24)', borderRadius: 1 }} />
      </div>
    </div>
  );
}
