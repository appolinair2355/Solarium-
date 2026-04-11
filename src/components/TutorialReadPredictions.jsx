import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SCENES = [
  { id: 'choose',    duration: 3000 },
  { id: 'live',      duration: 3500 },
  { id: 'predict',   duration: 3000 },
  { id: 'result',    duration: 2800 },
  { id: 'history',   duration: 3200 },
];

const TOTAL_MS = SCENES.reduce((s, sc) => s + sc.duration, 0);

function useAutoScene(scenes) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const raf = useRef(null);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - startRef.current) % TOTAL_MS;
      let acc = 0;
      for (let i = 0; i < scenes.length; i++) {
        acc += scenes[i].duration;
        if (elapsed < acc) {
          setIdx(i);
          setProgress((elapsed - (acc - scenes[i].duration)) / scenes[i].duration);
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

const CHANNELS = [
  { icon: '♠', color: '#3b82f6', name: 'Pique Noir' },
  { icon: '♥', color: '#ef4444', name: 'Cœur Rouge' },
  { icon: '♦', color: '#f59e0b', name: 'Carreau Doré' },
  { icon: '♣', color: '#22c55e', name: 'Double Canal' },
];

function SceneChoose({ progress }) {
  const shown = Math.min(4, Math.floor(progress * 5.5));
  const selected = progress > 0.75 ? 0 : -1;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 20px', gap: 10 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase' }}>
        Choisissez votre canal
      </motion.div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
        {CHANNELS.map((ch, i) => (
          <motion.div key={ch.name}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: shown > i ? 1 : 0, y: shown > i ? 0 : 12 }}
            transition={{ duration: 0.35, delay: i * 0.07 }}
            style={{
              padding: '10px 10px', borderRadius: 9,
              background: selected === i ? `rgba(${ch.color === '#3b82f6' ? '59,130,246' : ch.color === '#ef4444' ? '239,68,68' : ch.color === '#f59e0b' ? '245,158,11' : '34,197,94'},0.15)` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${selected === i ? ch.color + '88' : 'rgba(255,255,255,0.07)'}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              transform: selected === i ? 'scale(1.04)' : 'scale(1)',
              transition: 'all 0.3s',
              boxShadow: selected === i ? `0 4px 16px ${ch.color}30` : 'none',
            }}>
            <span style={{ fontSize: 22, color: ch.color }}>{ch.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: ch.color }}>{ch.name}</span>
          </motion.div>
        ))}
      </div>
      {selected >= 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
          style={{ fontSize: 11, padding: '6px 18px', borderRadius: 7, background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', color: '#fff', fontWeight: 700 }}>
          Entrer dans ce canal →
        </motion.div>
      )}
    </div>
  );
}

const SUITS_ICONS = ['♠', '♥', '♦', '♣'];

function SceneLive({ progress }) {
  const showGame = progress > 0.15;
  const showCards = progress > 0.4;
  const pulse = progress > 0.6;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 20px', gap: 10 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: showGame ? 1 : 0 }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <motion.div animate={{ background: pulse ? ['rgba(239,68,68,0.8)', 'rgba(239,68,68,0.3)', 'rgba(239,68,68,0.8)'] : 'rgba(239,68,68,0.8)' }}
          transition={{ duration: 1, repeat: Infinity }}
          style={{ width: 8, height: 8, borderRadius: '50%' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: 1 }}>LIVE</span>
        <span style={{ fontSize: 10, color: '#475569' }}>Partie #1031</span>
      </motion.div>
      {showGame && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>JOUEUR</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {showCards ? (
                  <>
                    <motion.div initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.35 }}
                      style={{ width: 26, height: 36, borderRadius: 4, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#ef4444' }}>♥</motion.div>
                    <motion.div initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                      style={{ width: 26, height: 36, borderRadius: 4, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#3b82f6' }}>♠</motion.div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 26, height: 36, borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
                    <div style={{ width: 26, height: 36, borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
                  </>
                )}
              </div>
              {showCards && <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', marginTop: 4 }}>7</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>VS</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>BANQUIER</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {showCards ? (
                  <>
                    <motion.div initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.35, delay: 0.1 }}
                      style={{ width: 26, height: 36, borderRadius: 4, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#f59e0b' }}>♦</motion.div>
                    <motion.div initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.35, delay: 0.25 }}
                      style={{ width: 26, height: 36, borderRadius: 4, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#22c55e' }}>♣</motion.div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 26, height: 36, borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
                    <div style={{ width: 26, height: 36, borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
                  </>
                )}
              </div>
              {showCards && <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', marginTop: 4 }}>6</div>}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: 10, color: '#64748b' }}>Prochaine partie dans <span style={{ color: '#fbbf24', fontWeight: 700 }}>2:34</span></div>
        </motion.div>
      )}
    </div>
  );
}

function ScenePredict({ progress }) {
  const showBox = progress > 0.12;
  const showSymbol = progress > 0.38;
  const showLabel = progress > 0.6;
  const glow = progress > 0.5;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 20px' }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: showBox ? 1 : 0 }}
        style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase' }}>
        Zone de prédiction
      </motion.div>
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: showBox ? 1 : 0, scale: showBox ? 1 : 0.8 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: '100%', padding: '18px 0', borderRadius: 14,
          background: glow ? 'linear-gradient(145deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${glow ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: glow ? '0 0 30px rgba(59,130,246,0.2)' : 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          transition: 'all 0.5s',
        }}>
        {showSymbol && (
          <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            style={{ fontSize: 48, color: '#3b82f6', lineHeight: 1 }}>
            ♠
          </motion.div>
        )}
        {!showSymbol && (
          <motion.div animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 1, repeat: Infinity }}
            style={{ fontSize: 12, color: '#475569' }}>
            En attente…
          </motion.div>
        )}
        {showLabel && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
            style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd' }}>
            ⚡ Pique Noir prédit
          </motion.div>
        )}
      </motion.div>
      {showLabel && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
          La prédiction se met à jour en <span style={{ color: '#fbbf24' }}>temps réel</span>
        </motion.div>
      )}
    </div>
  );
}

function SceneResult({ progress }) {
  const showResult = progress > 0.2;
  const win = true;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 20px' }}>
      <AnimatePresence>
        {showResult && (
          <motion.div key="result"
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 22 }}
            style={{
              width: '100%', padding: '18px 16px', borderRadius: 14, textAlign: 'center',
              background: win ? 'linear-gradient(145deg,rgba(21,128,61,0.25),rgba(34,197,94,0.08))' : 'rgba(239,68,68,0.1)',
              border: `2px solid ${win ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.5)'}`,
              boxShadow: win ? '0 0 36px rgba(34,197,94,0.2)' : '0 0 36px rgba(239,68,68,0.15)',
            }}>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 16, delay: 0.15 }}
              style={{ fontSize: 38, marginBottom: 6 }}>
              {win ? '✅' : '❌'}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
              style={{ fontWeight: 900, fontSize: 16, color: win ? '#22c55e' : '#ef4444' }}>
              {win ? 'GAGNÉ !' : 'PERDU'}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
              style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
              Partie #1031 · Joueur 7 — Banquier 6
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {progress > 0.65 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          style={{ fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
          Résultat automatiquement enregistré<br />dans l'historique 📋
        </motion.div>
      )}
    </div>
  );
}

const HIST = [
  { n: '#1031', r: true,  score: '7(♥♠) - 6(♦♣)', t: 13 },
  { n: '#1030', r: true,  score: '9(♠10) - 8(♦A)', t: 17 },
  { n: '#1029', r: false, score: '6(♣7) - 7(♥4)',  t: 13 },
];

function SceneHistory({ progress }) {
  const shown = Math.min(3, Math.floor(progress * 4.5));
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 18px', gap: 8 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>
        Historique des parties
      </motion.div>
      {HIST.map((h, i) => (
        <motion.div key={h.n}
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: shown > i ? 1 : 0, x: shown > i ? 0 : -16 }}
          transition={{ duration: 0.35, delay: i * 0.08 }}
          style={{
            width: '100%', padding: '9px 12px', borderRadius: 9,
            background: h.r ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${h.r ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>{h.r ? '✅' : '❌'}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{h.n}</div>
              <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>{h.score}</div>
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>#{h.t}</span>
        </motion.div>
      ))}
      {progress > 0.8 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
          style={{ fontSize: 9, color: '#475569', textAlign: 'center', fontFamily: 'monospace' }}>
          #N = numéro · ✅/❌ = résultat · #T = total
        </motion.div>
      )}
    </div>
  );
}

const SCENE_COMPS = [SceneChoose, SceneLive, ScenePredict, SceneResult, SceneHistory];
const SCENE_LABELS = ['Choisir un canal', 'Partie en direct', 'Prédiction', 'Résultat', 'Historique'];
const SCENE_COLORS = ['#3b82f6', '#ef4444', '#3b82f6', '#22c55e', '#a855f7'];

export default function TutorialReadPredictions() {
  const { idx, progress } = useAutoScene(SCENES);
  const SceneComp = SCENE_COMPS[idx];

  return (
    <div style={{
      width: '100%', aspectRatio: '16/9', borderRadius: 16, overflow: 'hidden',
      background: 'linear-gradient(145deg, #0b1220 0%, #0f172a 60%, #0d1b2a 100%)',
      position: 'relative', border: '1px solid rgba(59,130,246,0.2)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.06)',
    }}>
      {/* Grid pattern */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(59,130,246,0.05) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />

      {/* Glow */}
      <motion.div animate={{ opacity: [0.3, 0.55, 0.3] }} transition={{ duration: 4, repeat: Infinity, delay: 2 }}
        style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.08), transparent)', pointerEvents: 'none' }} />

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
            animate={{ width: i === idx ? 28 : 7, background: i === idx ? SCENE_COLORS[i] : i < idx ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.12)' }}
            transition={{ duration: 0.35 }}
            style={{ height: 7, borderRadius: 4 }}
          />
        ))}
      </div>

      {/* Scene label badge */}
      <motion.div
        key={`label-${idx}`}
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          padding: '3px 12px', borderRadius: 20, background: `${SCENE_COLORS[idx]}22`,
          border: `1px solid ${SCENE_COLORS[idx]}55`, color: SCENE_COLORS[idx],
          fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
        {SCENE_LABELS[idx]}
      </motion.div>

      {/* Progress bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.05)' }}>
        <motion.div
          animate={{ width: `${((idx / SCENES.length) + progress / SCENES.length) * 100}%` }}
          transition={{ duration: 0.1 }}
          style={{ height: '100%', background: `linear-gradient(90deg, #1d4ed8, ${SCENE_COLORS[idx]})`, borderRadius: 1 }} />
      </div>
    </div>
  );
}
