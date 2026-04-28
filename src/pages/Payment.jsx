import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
  const [request, setRequest] = useState(null);     // demande créée { id, plan, whatsapp_link }
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMime, setImageMime] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);       // résultat de l'upload (IA)
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

  // Refresh user info pour récupérer la nouvelle expiration éventuelle
  const refreshUser = () => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setUser(d); })
      .catch(() => {});
  };

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
      // Ouvrir WhatsApp dans un nouvel onglet
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

  const submitScreenshot = async () => {
    if (!request || !imageBase64) return;
    setUploading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/payments/${request.id}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image_base64: imageBase64, mime_type: imageMime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de l\'envoi');
      setResult(data);
      refreshMyRequests();
      refreshUser();
    } catch (e) {
      setError(e.message);
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
  };

  const StatusBadge = ({ status }) => {
    const map = {
      awaiting_screenshot: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', label: '📤 En attente capture' },
      ai_validated:        { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  label: '🤖 Validée IA — accès 2 h' },
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
        <Link to="/choisir" className="btn btn-ghost btn-sm" style={{ color: '#94a3b8' }}>
          ← Retour
        </Link>
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

        {/* ═══════ ÉTAPE 1 : Choix du plan ═══════ */}
        {!request && !result && (
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
                    {creating && selectedPlan?.id === p.id ? '...' : '💳 Acheter'}
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

        {/* ═══════ ÉTAPE 2 : Upload de la capture ═══════ */}
        {request && !result && (
          <div style={{
            maxWidth: 700, margin: '0 auto',
            background: 'rgba(15,23,42,0.7)', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.08)', padding: 26,
          }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
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
              <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                Envoyez le paiement à <b>{whatsapp.number}</b> via WhatsApp,
                puis prenez une capture d'écran de la confirmation.
              </p>
            </div>

            <a
              href={request.whatsapp_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                color: '#fff', padding: '12px 22px', borderRadius: 100,
                fontWeight: 700, textDecoration: 'none', marginBottom: 24,
              }}
            >
              💬 Ouvrir WhatsApp ({whatsapp.number})
            </a>

            <div style={{
              padding: 16, background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.25)', borderRadius: 12, marginBottom: 22,
            }}>
              <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                📸 ÉTAPE 2 / 2 — Envoyez votre capture d'écran
              </div>
              <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>
                Une intelligence artificielle va analyser votre capture pour vous donner accès dans les 2 minutes,
                puis l'administrateur confirmera définitivement.
              </div>
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

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <button onClick={reset} className="btn btn-ghost btn-sm" disabled={uploading}>
                ← Annuler
              </button>
              <button
                onClick={submitScreenshot}
                disabled={!imageBase64 || uploading}
                className="btn btn-gold"
                style={{ minWidth: 200 }}
              >
                {uploading ? <><span className="btn-spinner" /> Analyse IA en cours...</> : '🚀 Envoyer la capture'}
              </button>
            </div>
          </div>
        )}

        {/* ═══════ ÉTAPE 3 : Résultat ═══════ */}
        {result && (
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
              {result.ai_validated ? 'Accès accordé temporairement !' : 'Capture reçue'}
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              {result.message}
            </p>

            {result.ai_analysis && result.ai_analysis.reason && (
              <div style={{
                padding: 12, borderRadius: 10,
                background: 'rgba(0,0,0,0.3)', textAlign: 'left',
                fontSize: 12, color: '#94a3b8', marginBottom: 18,
              }}>
                <b style={{ color: '#cbd5e1' }}>🤖 Analyse IA :</b> {result.ai_analysis.reason}
                {result.ai_analysis.confidence !== undefined && (
                  <span style={{ marginLeft: 8 }}>(confiance : {result.ai_analysis.confidence}%)</span>
                )}
              </div>
            )}

            {result.ai_validated && result.ai_temp_access_until && (
              <div style={{
                padding: 12, borderRadius: 10,
                background: 'rgba(34,197,94,0.1)', color: '#86efac', marginBottom: 18,
              }}>
                ⏱ Accès temporaire jusqu'au {new Date(result.ai_temp_access_until).toLocaleString('fr-FR')}
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
        {myRequests.length > 0 && !request && !result && (
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
