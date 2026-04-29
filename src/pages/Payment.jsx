import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';

export default function Payment() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [accountType, setAccountType] = useState('simple');
  const [surchargePct, setSurchargePct] = useState(0);
  const [whatsapp, setWhatsapp] = useState({ number: '', link: '' });
  const [referral, setReferral] = useState({ discount_percent: 20, bonus_percent: 20 });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [creating, setCreating] = useState(false);
  const [request, setRequest] = useState(null);
  // Étapes : 'plan' → 'whatsapp_sent' → 'screenshot' → 'patience' → 'result'
  const [phase, setPhase] = useState('plan');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMime, setImageMime] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [patienceLeft, setPatienceLeft] = useState(10);
  const [result, setResult] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch('/api/payments/plans', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setPlans(d.plans || []);
        setAccountType(d.account_type || 'simple');
        setSurchargePct(d.surcharge_percent || 0);
        setWhatsapp(d.whatsapp || {});
        setReferral(d.referral || { discount_percent: 20, bonus_percent: 20 });
      })
      .catch(() => {});
    refreshMyRequests();
  }, []);

  const refreshMyRequests = () => {
    fetch('/api/payments/my-requests', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setMyRequests)
      .catch(() => {});
  };

  const refreshUser = () => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setUser(d); })
      .catch(() => {});
  };

  // ── ÉTAPE 1 → 2 : Création de la demande + ouverture WhatsApp ──
  const startPlan = async (plan) => {
    setError('');
    setSelectedPlan(plan);
    setCreating(true);
    try {
      const res = await fetch('/api/payments/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création');
      setRequest({ ...data.request, whatsapp_link: data.whatsapp_link });
      setPhase('whatsapp_sent');
      // Ouvre WhatsApp dans un nouvel onglet
      window.open(data.whatsapp_link, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.message);
      setSelectedPlan(null);
    } finally {
      setCreating(false);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Veuillez sélectionner une image (JPG, PNG, etc.)');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError('Image trop volumineuse (6 Mo maximum)');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImagePreview(dataUrl);
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        setImageMime(m[1]);
        setImageBase64(m[2]);
      }
    };
    reader.readAsDataURL(file);
  };

  // ── ÉTAPE 3 → 4 → 5 : Envoi capture + attente 10s + résultat ──
  const submitScreenshot = async () => {
    if (!request || !imageBase64) return;
    setUploading(true);
    setError('');
    setResult(null);
    setPhase('patience');
    setPatienceLeft(10);

    // Compteur 10 s en parallèle de la requête
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, 10 - Math.floor(elapsed));
      setPatienceLeft(left);
    }, 250);

    try {
      const [data] = await Promise.all([
        // L'appel réseau
        (async () => {
          const res = await fetch(`/api/payments/${request.id}/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ image_base64: imageBase64, mime_type: imageMime }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Erreur lors de l'envoi");
          return d;
        })(),
        // Le délai minimum d'attente
        new Promise(r => setTimeout(r, 10_000)),
      ]);

      clearInterval(tick);
      setResult(data);
      setPhase('result');
      refreshMyRequests();
      refreshUser();
    } catch (e) {
      clearInterval(tick);
      setError(e.message);
      setPhase('screenshot');
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setSelectedPlan(null);
    setRequest(null);
    setImagePreview(null);
    setImageBase64(null);
    setImageMime(null);
    setResult(null);
    setError('');
    setPhase('plan');
  };

  const goBackToPlan = () => {
    if (request && phase === 'whatsapp_sent') {
      if (!confirm('Annuler cette demande et revenir au choix du plan ?')) return;
    }
    reset();
  };

  const StatusBadge = ({ status }) => {
    const map = {
      awaiting_screenshot: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', label: '📤 En attente capture' },
      ai_validated:        { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  label: '🤖 Validée IA (sous réserve admin)' },
      pending_admin:       { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', label: '⏳ Attente admin' },
      approved:            { color: '#86efac', bg: 'rgba(134,239,172,0.15)', label: '✅ Approuvée' },
      rejected:            { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  label: '❌ Rejetée' },
    };
    const s = map[status] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', label: status };
    return (
      <span style={{
        display: 'inline-block', padding: '3px 10px', borderRadius: 100,
        background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
      }}>{s.label}</span>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', padding: '24px 16px' }}>
      <nav style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        maxWidth: 980, margin: '0 auto 30px', padding: '14px 18px',
        background: 'rgba(15,23,42,0.6)', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <Link to="/" style={{ color: '#fbbf24', fontSize: 18, fontWeight: 800, textDecoration: 'none' }}>
          🎲 Prediction Baccara Pro
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/choisir" className="btn btn-ghost btn-sm" style={{ color: '#94a3b8' }}>
            ← Retour
          </Link>
          <Avatar user={user} size={36} />
        </div>
      </nav>

      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{
            display: 'inline-block', padding: '4px 14px', borderRadius: 100,
            background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
            border: '1px solid rgba(239,68,68,0.3)', fontSize: 12, fontWeight: 700,
            letterSpacing: 1, marginBottom: 14,
          }}>
            ⛔ ABONNEMENT REQUIS
          </div>
          <h1 style={{ color: '#fff', fontSize: '2rem', margin: '0 0 10px' }}>
            Choisissez votre abonnement
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            Paiement par WhatsApp, validation par l'IA puis confirmation par l'administrateur.
          </p>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            marginTop: 14, padding: '8px 16px', borderRadius: 100,
            background: accountType === 'pro'
              ? 'rgba(168,85,247,0.15)'
              : accountType === 'premium'
                ? 'rgba(251,191,36,0.15)'
                : 'rgba(59,130,246,0.15)',
            border: `1px solid ${accountType === 'pro' ? 'rgba(168,85,247,0.4)' : accountType === 'premium' ? 'rgba(251,191,36,0.4)' : 'rgba(59,130,246,0.4)'}`,
            color: accountType === 'pro' ? '#c084fc' : accountType === 'premium' ? '#fcd34d' : '#93c5fd',
            fontWeight: 700, fontSize: 12, letterSpacing: 0.5,
          }}>
            {accountType === 'pro' ? '💎' : accountType === 'premium' ? '⭐' : '👤'}
            COMPTE {accountType.toUpperCase()}
            {surchargePct > 0 && (
              <span style={{ opacity: 0.85 }}>· Tarif +{surchargePct} %</span>
            )}
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ maxWidth: 700, margin: '0 auto 20px' }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ═══════ PHASE 1 : Choix du plan ═══════ */}
        {phase === 'plan' && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16, marginBottom: 30,
            }}>
              {plans.map(p => (
                <div key={p.id} style={{
                  background: 'linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.9))',
                  border: '2px solid rgba(251,191,36,0.25)', borderRadius: 16,
                  padding: 22, textAlign: 'center', position: 'relative',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 6 }}>
                    {p.id === '1j' && '⚡'}
                    {p.id === '1s' && '📅'}
                    {p.id === '2s' && '🗓️'}
                    {p.id === '1m' && '👑'}
                  </div>
                  <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
                    {p.label}
                  </div>
                  <div style={{ color: '#fff', fontSize: 32, fontWeight: 900, lineHeight: 1 }}>
                    {p.amount_usd}<span style={{ fontSize: 16, color: '#94a3b8' }}> $</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, margin: '8px 0 14px' }}>
                    Accès {p.duration_minutes >= 1440
                      ? Math.round(p.duration_minutes / 1440) + ' jour(s)'
                      : Math.round(p.duration_minutes / 60) + ' h'}
                  </div>
                  <button
                    onClick={() => startPlan(p)}
                    disabled={creating}
                    className="btn btn-gold btn-sm"
                    style={{ width: '100%' }}
                  >
                    {creating && selectedPlan?.id === p.id ? '...' : '💳 Payer ce plan'}
                  </button>
                </div>
              ))}
            </div>

            {user?.promo_code && (
              <div style={{
                maxWidth: 600, margin: '0 auto 24px',
                padding: 16, borderRadius: 12,
                background: 'rgba(251,191,36,0.06)',
                border: '1px solid rgba(251,191,36,0.25)',
                textAlign: 'center', color: '#fcd34d', fontSize: 13,
              }}>
                💡 Vous avez un code promo personnel : <b style={{ fontFamily: 'monospace' }}>{user.promo_code}</b>.
                Partagez-le pour gagner <b>{referral.bonus_percent} %</b> de la durée payée par chaque filleul.
              </div>
            )}
          </>
        )}

        {/* ═══════ PHASES 2 & 3 COMBINÉES : Paiement (haut) + Validation (bas) ═══════ */}
        {(phase === 'whatsapp_sent' || phase === 'screenshot') && request && (
          <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ──────── PANNEAU 1 : PAIEMENT WHATSAPP ──────── */}
            <div style={{
              background: 'rgba(15,23,42,0.7)', borderRadius: 16,
              border: '1px solid rgba(37,211,102,0.3)', padding: 26,
            }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: '#25D366', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
                  ÉTAPE 1 / 2 — PAIEMENT WHATSAPP
                </div>
                <h2 style={{ color: '#fff', margin: '0 0 8px' }}>
                  Plan « {request.plan_label} » — {request.amount_usd} $
                  {request.discount_applied && (
                    <span style={{ marginLeft: 10, fontSize: 13, color: '#86efac', fontWeight: 600 }}>
                      🎁 -{referral.discount_percent}% appliqué
                    </span>
                  )}
                </h2>
              </div>

              <div style={{
                padding: 16, background: 'rgba(37,211,102,0.08)',
                border: '1px solid rgba(37,211,102,0.3)', borderRadius: 12, marginBottom: 18,
              }}>
                <div style={{ color: '#86efac', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                  💬 WhatsApp s'est ouvert avec votre message pré-rempli
                </div>
                <ol style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
                  <li>Envoyez le message au support (<b>{whatsapp.number}</b>)</li>
                  <li>Le support vous renvoie le lien de paiement</li>
                  <li>Effectuez le paiement et prenez une <b>capture d'écran</b></li>
                  <li>Envoyez la capture dans le panneau « Validation » ci-dessous</li>
                </ol>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <a
                  href={request.whatsapp_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'linear-gradient(135deg, #25D366, #128C7E)',
                    color: '#fff', padding: '10px 18px', borderRadius: 100,
                    fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  💬 Rouvrir WhatsApp ({whatsapp.number})
                </a>
                <button onClick={goBackToPlan} className="btn btn-ghost btn-sm">
                  ← Changer de plan
                </button>
              </div>
            </div>

            {/* ──────── PANNEAU 2 : VALIDATION (CAPTURE D'ÉCRAN) ──────── */}
            <div style={{
              background: 'rgba(15,23,42,0.7)', borderRadius: 16,
              border: '2px solid rgba(251,191,36,0.4)', padding: 26,
              boxShadow: '0 0 18px rgba(251,191,36,0.15)',
            }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
                  ÉTAPE 2 / 2 — VALIDATION : CAPTURE D'ÉCRAN
                </div>
                <h2 style={{ color: '#fff', margin: '0 0 8px' }}>
                  Après paiement réussi, envoyez la preuve ici
                </h2>
                <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                  Notre IA analysera la capture (<b>montant</b>, <b>devise</b>, <b>date</b>, <b>référence</b>).
                  Si validée, vous obtenez <b>2 h d'accès immédiat</b> en attendant la confirmation finale de l'administrateur.
                </p>
              </div>

              {imagePreview ? (
                <div style={{ marginBottom: 18 }}>
                  <img
                    src={imagePreview}
                    alt="Aperçu"
                    style={{
                      maxWidth: '100%', maxHeight: 360, borderRadius: 12,
                      border: '2px solid rgba(251,191,36,0.4)', display: 'block', margin: '0 auto',
                    }}
                  />
                  <div style={{ textAlign: 'center', marginTop: 10 }}>
                    <button
                      onClick={() => { setImagePreview(null); setImageBase64(null); setImageMime(null); }}
                      className="btn btn-ghost btn-sm"
                    >
                      🗑 Changer l'image
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  style={{
                    display: 'block', padding: '40px 20px', borderRadius: 12,
                    border: '2px dashed rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.04)',
                    textAlign: 'center', cursor: 'pointer', marginBottom: 18,
                  }}
                >
                  <div style={{ fontSize: 42, marginBottom: 8 }}>📤</div>
                  <div style={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}>
                    Cliquez pour envoyer la capture d'écran
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                    JPG, PNG — 6 Mo max
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                    style={{ display: 'none' }}
                  />
                </label>
              )}

              <button
                onClick={submitScreenshot}
                disabled={!imageBase64 || uploading}
                className="btn btn-gold"
                style={{
                  width: '100%', padding: '14px 24px', fontSize: 15,
                  boxShadow: '0 0 18px rgba(251,191,36,0.35)',
                }}
              >
                {uploading
                  ? <><span className="btn-spinner" /> Envoi à l'IA et à l'administrateur…</>
                  : '🤖 Envoyer la capture (IA + Administrateur)'}
              </button>

              <div style={{
                marginTop: 14, padding: 12, borderRadius: 10,
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.25)',
                color: '#93c5fd', fontSize: 12, lineHeight: 1.6, textAlign: 'center',
              }}>
                ℹ️ La capture sera envoyée à l'administrateur pour confirmation.
                Si l'IA la valide, vous aurez accès pendant <b>2 h</b> en attendant l'accord final.
              </div>
            </div>
          </div>
        )}

        {/* ═══════ PHASE 4 : Veuillez patienter ═══════ */}
        {phase === 'patience' && (
          <div style={{
            maxWidth: 600, margin: '0 auto',
            background: 'rgba(15,23,42,0.85)', borderRadius: 18,
            border: '2px solid rgba(251,191,36,0.4)', padding: '40px 30px',
            textAlign: 'center',
          }}>
            <div style={{
              display: 'inline-block', width: 80, height: 80,
              border: '6px solid rgba(251,191,36,0.2)',
              borderTop: '6px solid #fbbf24',
              borderRadius: '50%', animation: 'spin 1s linear infinite',
              marginBottom: 20,
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <h2 style={{ color: '#fff', margin: '0 0 10px', fontSize: '1.6rem' }}>
              Veuillez patienter…
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Notre intelligence artificielle analyse votre capture d'écran<br />
              (montant, devise, date, référence, identifiant).
            </p>
            <div style={{
              display: 'inline-block', padding: '8px 18px', borderRadius: 100,
              background: 'rgba(251,191,36,0.15)', color: '#fcd34d',
              fontWeight: 800, fontSize: 22, fontFamily: 'monospace',
              border: '1px solid rgba(251,191,36,0.4)',
            }}>
              {patienceLeft}s
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 16 }}>
              Merci de ne pas fermer cette page.
            </div>
          </div>
        )}

        {/* ═══════ PHASE 5 : Résultat ═══════ */}
        {phase === 'result' && result && (
          <div style={{
            maxWidth: 700, margin: '0 auto',
            background: 'rgba(15,23,42,0.7)', borderRadius: 16,
            border: `2px solid ${result.ai_validated ? 'rgba(34,197,94,0.5)' : 'rgba(59,130,246,0.5)'}`,
            padding: 30, textAlign: 'center',
          }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>
              {result.ai_validated ? '🎉' : '📬'}
            </div>
            <h2 style={{ color: '#fff', marginBottom: 12 }}>
              {result.ai_validated
                ? 'Abonnement activé !'
                : 'Capture reçue — vérification administrateur'}
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              {result.message}
            </p>

            {result.ai_validated && (
              <div style={{
                padding: 14, borderRadius: 12,
                background: 'rgba(251,191,36,0.1)',
                border: '1px solid rgba(251,191,36,0.35)',
                color: '#fcd34d', marginBottom: 18, fontSize: 13, fontWeight: 600,
              }}>
                ⚠ <b>Sous réserve de vérification de l'administrateur</b><br />
                Si l'admin détecte une fraude, votre abonnement sera retiré.
              </div>
            )}

            {result.ai_analysis && (
              <div style={{
                padding: 14, borderRadius: 10,
                background: 'rgba(0,0,0,0.3)', textAlign: 'left',
                fontSize: 12, color: '#94a3b8', marginBottom: 18,
              }}>
                <div style={{ color: '#cbd5e1', fontWeight: 700, marginBottom: 6 }}>🤖 Analyse IA :</div>
                {result.ai_analysis.reason && <div>• {result.ai_analysis.reason}</div>}
                {result.ai_analysis.amount_detected && (
                  <div>• Montant détecté : <b>{result.ai_analysis.amount_detected}</b> {result.ai_analysis.currency_detected || ''}</div>
                )}
                {result.ai_analysis.transaction_id && (
                  <div>• Référence : <code>{result.ai_analysis.transaction_id}</code></div>
                )}
                {result.ai_analysis.transaction_date && (
                  <div>• Date : {result.ai_analysis.transaction_date}</div>
                )}
                {result.ai_analysis.confidence !== undefined && (
                  <div>• Confiance : {result.ai_analysis.confidence}%</div>
                )}
              </div>
            )}

            {result.ai_validated && result.provisional_expiry && (
              <div style={{
                padding: 12, borderRadius: 10,
                background: 'rgba(34,197,94,0.1)', color: '#86efac', marginBottom: 18, fontSize: 13,
              }}>
                ⏱ Abonnement actif jusqu'au <b>{new Date(result.provisional_expiry).toLocaleString('fr-FR')}</b>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/choisir')} className="btn btn-gold">
                {result.ai_validated ? '🚀 Accéder aux prédictions' : 'OK, retour à mon espace'}
              </button>
              <button onClick={reset} className="btn btn-ghost">
                Nouvelle demande
              </button>
            </div>
          </div>
        )}

        {/* ═══════ HISTORIQUE ═══════ */}
        {myRequests.length > 0 && phase === 'plan' && (
          <div style={{ maxWidth: 700, margin: '40px auto 0' }}>
            <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
              📋 Mes demandes de paiement
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myRequests.slice(0, 10).map(r => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: 10,
                  background: 'rgba(15,23,42,0.6)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                      #{r.id} — {r.plan_label} · {r.amount_usd}$
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {new Date(r.created_at).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
