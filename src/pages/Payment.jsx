import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';
import { useLanguage } from '../context/LanguageContext';

export default function Payment() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const { autoT } = useLanguage();
  const [plans, setPlans] = useState([]);
  const [accountType, setAccountType] = useState('simple');
  const [surchargePct, setSurchargePct] = useState(0);
  const [whatsapp, setWhatsapp] = useState({ number: '', link: '' });
  const [referral, setReferral] = useState({ discount_percent: 20, bonus_percent: 20 });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [creating, setCreating] = useState(false);
  const [request, setRequest] = useState(null);
  const [phase, setPhase] = useState('plan');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMime, setImageMime] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [patienceLeft, setPatienceLeft] = useState(10);
  const [result, setResult] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const fileInputRef = useRef(null);

  // ── "Déjà payé ?" — vérification directe dans la base de paiement externe ──
  const [paidModalOpen, setPaidModalOpen] = useState(false);
  const [paidIdentifiant, setPaidIdentifiant] = useState('');
  const [paidPassword, setPaidPassword] = useState('');
  const [paidChecking, setPaidChecking] = useState(false);
  const [paidError, setPaidError] = useState('');
  const [paidResults, setPaidResults] = useState(null);

  const checkAlreadyPaid = async () => {
    if (!paidIdentifiant || !paidPassword) return;
    setPaidChecking(true);
    setPaidError('');
    setPaidResults(null);
    try {
      const res = await fetch('/api/payments/check-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifiant: paidIdentifiant, mot_de_passe: paidPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || autoT('Vérification impossible'));
      setPaidResults(data.results || []);
      if (data.user) setUser(data.user);
    } catch (e) {
      setPaidError(e.message);
    } finally {
      setPaidChecking(false);
    }
  };

  const closePaidModal = () => {
    setPaidModalOpen(false);
    setPaidIdentifiant('');
    setPaidPassword('');
    setPaidError('');
    setPaidResults(null);
  };

  const PAID_STATUS_LABEL = {
    granted_now: { icon: '✅', text: autoT('Activé maintenant'), color: '#86efac' },
    already_processed: { icon: '☑️', text: autoT('Déjà activé'), color: '#93c5fd' },
    thanked: { icon: '🙏', text: autoT('Merci pour votre soutien'), color: '#fcd34d' },
    pending_admin_review: { icon: '⏳', text: autoT("En attente de vérification par l'administrateur"), color: '#fbbf24' },
    no_target_account: { icon: '⚠️', text: autoT('Compte introuvable'), color: '#fca5a5' },
    error: { icon: '❌', text: autoT('Erreur'), color: '#fca5a5' },
  };

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

  const PAYMENT_URL = 'https://paiement-s-curis.onrender.com';

  const startPlan = (plan) => {
    // Redirection vers la plateforme de paiement sécurisée externe
    const params = new URLSearchParams({
      plan_id:   plan.id,
      plan:      plan.label || plan.id,
      amount:    plan.amount_usd,
      user_id:   user?.id || '',
      username:  user?.username || '',
      origin:    window.location.origin,
    });
    window.open(`${PAYMENT_URL}?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(autoT('Veuillez sélectionner une image (JPG, PNG, etc.)'));
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError(autoT('Image trop volumineuse (6 Mo maximum)'));
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
    setPhase('patience');
    setPatienceLeft(10);
    setDuplicateWarning(null);

    const startedAt = Date.now();
    const tick = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, 10 - Math.floor(elapsed));
      setPatienceLeft(left);
    }, 250);

    try {
      const [data] = await Promise.all([
        (async () => {
          const res = await fetch(`/api/payments/${request.id}/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ image_base64: imageBase64, mime_type: imageMime }),
          });
          const d = await res.json();
          if (!res.ok) {
            if (res.status === 409 && d.duplicate) return { duplicate: true, error: d.error };
            throw new Error(d.error || autoT("Erreur lors de l'envoi"));
          }
          return d;
        })(),
        new Promise(r => setTimeout(r, 10_000)),
      ]);

      clearInterval(tick);
      if (data.duplicate) {
        setDuplicateWarning(data.error || '⛔ Capture déjà utilisée');
        setPhase('screenshot');
      } else {
        setResult(data);
        setPhase('result');
        refreshMyRequests();
        refreshUser();
      }
    } catch (e) {
      clearInterval(tick);
      if (e.message && e.message.includes('déjà été utilisée')) {
        setDuplicateWarning(e.message);
        setPhase('screenshot');
      } else {
        setError(e.message);
      }
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
      if (!confirm(autoT('Annuler cette demande et revenir au choix du plan ?'))) return;
    }
    reset();
  };

  const StatusBadge = ({ status }) => {
    const map = {
      awaiting_screenshot: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  label: `📤 ${autoT('En attente capture')}` },
      ai_validated:        { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   label: `✅ ${autoT('Validée — Sossou Kouamé assistance (sous réserve admin)')}` },
      pending_admin:       { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  label: `⏳ ${autoT('Attente admin')}` },
      approved:            { color: '#86efac', bg: 'rgba(134,239,172,0.15)', label: `✅ ${autoT('Approuvée')}` },
      rejected:            { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   label: `❌ ${autoT('Rejetée')}` },
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
            ← {autoT('Retour')}
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
            ⛔ {autoT('ABONNEMENT REQUIS')}
          </div>
          <h1 style={{ color: '#fff', fontSize: '2rem', margin: '0 0 10px' }}>
            {autoT('Choisissez votre abonnement')}
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            {autoT("Paiement par WhatsApp, validation par Sossou Kouamé assistance puis confirmation par l'administrateur.")}
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
            {autoT('COMPTE')} {accountType.toUpperCase()}
            {surchargePct > 0 && (
              <span style={{ opacity: 0.85 }}>· {autoT('Tarif')} +{surchargePct} %</span>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => setPaidModalOpen(true)}
              className="btn btn-ghost btn-sm"
              style={{ color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)' }}
            >
              💳 {autoT('Déjà payé ?')}
            </button>
          </div>
        </div>

        {duplicateWarning && (
          <div style={{ maxWidth: 700, margin: '0 auto 20px', padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)', color: '#fca5a5', fontSize: 13, lineHeight: 1.6 }}>
            ⛔ <b>Capture déjà utilisée :</b> {duplicateWarning}
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ maxWidth: 700, margin: '0 auto 20px' }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* PHASE 1 : Choix du plan */}
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
                    {autoT('Accès')} {p.duration_minutes >= 1440
                      ? Math.round(p.duration_minutes / 1440) + ' ' + autoT('jour(s)')
                      : Math.round(p.duration_minutes / 60) + ' h'}
                  </div>
                  <button
                    onClick={() => startPlan(p)}
                    disabled={creating}
                    className="btn btn-gold btn-sm"
                    style={{ width: '100%' }}
                  >
                    {creating && selectedPlan?.id === p.id ? '...' : `💳 ${autoT('Payer ce plan')}`}
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
                💡 {autoT('Vous avez un code promo personnel')} : <b style={{ fontFamily: 'monospace' }}>{user.promo_code}</b>.
                {autoT('Partagez-le pour gagner')} <b>{referral.bonus_percent} %</b> {autoT('de la durée payée par chaque filleul.')}.
              </div>
            )}
          </>
        )}

        {/* PHASES 2 & 3 : Paiement + Validation */}
        {(phase === 'whatsapp_sent' || phase === 'screenshot') && request && (
          <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* PANNEAU 1 : OPTIONS DE PAIEMENT */}
            <div style={{
              background: 'rgba(15,23,42,0.7)', borderRadius: 16,
              border: '1px solid rgba(250,204,21,0.25)', padding: 26,
            }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
                  {autoT('ÉTAPE 1 / 2 — CHOISISSEZ VOTRE MODE DE PAIEMENT')}
                </div>
                <h2 style={{ color: '#fff', margin: '0 0 6px', fontSize: '1.3rem' }}>
                  {autoT('Plan')} « {request.plan_label} » — <span style={{ color: '#fbbf24' }}>{request.amount_usd} $</span>
                  {request.discount_applied && (
                    <span style={{ marginLeft: 10, fontSize: 13, color: '#86efac', fontWeight: 600 }}>
                      🎁 -{referral.discount_percent}% {autoT('appliqué')}
                    </span>
                  )}
                </h2>
                <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
                  {autoT('Après paiement, envoyez votre capture à l\'étape 2 pour validation.')}
                </p>
              </div>

              {/* 3 options de paiement */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>

                {/* Option 1 : WhatsApp */}
                <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(37,211,102,0.07)', border: '1px solid rgba(37,211,102,0.28)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>💬 {autoT('Payer via WhatsApp')}</div>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>{autoT('Contactez le support, il vous envoie le lien de paiement')} · <b>{whatsapp.number}</b></div>
                    </div>
                    <a href={request.whatsapp_link} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: 'linear-gradient(135deg, #25D366, #128C7E)', color: '#fff',
                        padding: '9px 18px', borderRadius: 100, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      💬 {autoT('Ouvrir WhatsApp')}
                    </a>
                  </div>
                </div>

                {/* Option 2 : MoneyFusion */}
                <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.28)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>🔗 {autoT('Payer via MoneyFusion')}</div>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>{autoT('Lien de paiement sécurisé direct — rapide et fiable')}</div>
                    </div>
                    <a href={PAYMENT_URL} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff',
                        padding: '9px 18px', borderRadius: 100, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      🔗 {autoT('Payer MoneyFusion')}
                    </a>
                  </div>
                </div>

                {/* Option 3 : BNB Crypto */}
                <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)' }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>🪙 {autoT('Payer en crypto BNB')}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>{autoT('Envoyez exactement')} <b style={{ color: '#fbbf24' }}>{request.amount_usd} $</b> {autoT('en BNB à cette adresse')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <code style={{ flex: 1, minWidth: 0, fontSize: 11, background: 'rgba(0,0,0,0.35)', padding: '8px 12px', borderRadius: 8, color: '#e2e8f0', overflowX: 'auto', whiteSpace: 'nowrap', display: 'block', wordBreak: 'break-all' }}>
                      0x13108641DcfaBea3b2e8dEd4d35B8f49606f5A17
                    </code>
                    <button onClick={() => { navigator.clipboard.writeText('0x13108641DcfaBea3b2e8dEd4d35B8f49606f5A17'); }}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      📋 {autoT('Copier')}
                    </button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>⚠️ {autoT('Réseau BNB (BSC) uniquement — vérifiez bien l\'adresse avant d\'envoyer')}</div>
                </div>

              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                    color: '#1f2937', padding: '11px 22px', borderRadius: 100,
                    fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer',
                    boxShadow: '0 0 18px rgba(251,191,36,0.35)',
                  }}
                >
                  📸 {autoT('J\'ai payé — Soumettre ma capture')}
                </button>
                <button onClick={goBackToPlan} className="btn btn-ghost btn-sm">
                  ← {autoT('Changer de plan')}
                </button>
              </div>
            </div>

            {/* PANNEAU 2 : VALIDATION */}
            <div style={{
              background: 'rgba(15,23,42,0.7)', borderRadius: 16,
              border: '2px solid rgba(251,191,36,0.4)', padding: 26,
              boxShadow: '0 0 18px rgba(251,191,36,0.15)',
            }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
                  {autoT("ÉTAPE 2 / 2 — VALIDATION : CAPTURE D'ÉCRAN")}
                </div>
                <h2 style={{ color: '#fff', margin: '0 0 8px' }}>
                  {autoT('Après paiement réussi, envoyez la preuve ici')}
                </h2>
                <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                  {autoT("Sossou Kouamé assistance analyse les captures d'écran")} (<b>{autoT('montant')}</b>, <b>{autoT('devise')}</b>, <b>{autoT('date')}</b>, <b>{autoT('référence')}</b>).
                  {autoT("Si validée, vous obtenez")} <b>{autoT("2 h d'accès immédiat")}</b> {autoT("en attendant la confirmation finale de l'administrateur.")}
                </p>
              </div>

              {imagePreview ? (
                <div style={{ marginBottom: 18 }}>
                  <img
                    src={imagePreview}
                    alt={autoT('Aperçu')}
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
                      🗑 {autoT("Changer l'image")}
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
                    {autoT("Cliquez pour envoyer la capture d'écran")}
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
                  ? <><span className="btn-spinner" /> {autoT("Sossou Kouamé assistance analyse les captures d'écran…")}</>
                  : `📤 ${autoT('Envoyer la capture pour analyse')}`}
              </button>

              <div style={{
                marginTop: 14, padding: 12, borderRadius: 10,
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.25)',
                color: '#93c5fd', fontSize: 12, lineHeight: 1.6, textAlign: 'center',
              }}>
                ℹ️ {autoT("La capture sera envoyée à l'administrateur pour confirmation.")}
                {autoT("Si Sossou Kouamé assistance la valide, vous aurez accès pendant")} <b>2 h</b> {autoT("en attendant l'accord final.")}
              </div>
            </div>
          </div>
        )}

        {/* PHASE 4 : Patience */}
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
              {autoT('Veuillez patienter…')}
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              {autoT("Sossou Kouamé assistance analyse votre capture d'écran")}<br />
              ({autoT('montant')}, {autoT('devise')}, {autoT('date')}, {autoT('référence')}, {autoT('identifiant')}).
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
              {autoT('Merci de ne pas fermer cette page.')}
            </div>
          </div>
        )}

        {/* PHASE 5 : Résultat */}
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
                ? autoT('Abonnement activé !')
                : autoT('Capture reçue — vérification administrateur')}
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
                ⚠ <b>{autoT("Sous réserve de vérification de l'administrateur")}</b><br />
                {autoT("Si l'admin détecte une fraude, votre abonnement sera retiré.")}
              </div>
            )}

            {result.ai_analysis && (
              <div style={{
                padding: 14, borderRadius: 10,
                background: 'rgba(0,0,0,0.3)', textAlign: 'left',
                fontSize: 12, color: '#94a3b8', marginBottom: 18,
              }}>
                <div style={{ color: '#cbd5e1', fontWeight: 700, marginBottom: 6 }}>👨‍💼 {autoT('Sossou Kouamé assistance')} :</div>
                {result.ai_analysis.reason && <div>• {result.ai_analysis.reason}</div>}
                {result.ai_analysis.amount_detected && (
                  <div>• {autoT('Montant détecté')} : <b>{result.ai_analysis.amount_detected}</b> {result.ai_analysis.currency_detected || ''}</div>
                )}
                {result.ai_analysis.transaction_id && (
                  <div>• {autoT('Référence')} : <code>{result.ai_analysis.transaction_id}</code></div>
                )}
                {result.ai_analysis.transaction_date && (
                  <div>• {autoT('Date')} : {result.ai_analysis.transaction_date}</div>
                )}
                {result.ai_analysis.confidence !== undefined && (
                  <div>• {autoT('Confiance')} : {result.ai_analysis.confidence}%</div>
                )}
              </div>
            )}

            {result.ai_validated && result.provisional_expiry && (
              <div style={{
                padding: 12, borderRadius: 10,
                background: 'rgba(34,197,94,0.1)', color: '#86efac', marginBottom: 18, fontSize: 13,
              }}>
                ⏱ {autoT('Abonnement actif jusqu\'au')} <b>{new Date(result.provisional_expiry).toLocaleString('fr-FR')}</b>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/choisir')} className="btn btn-gold">
                {result.ai_validated ? `🚀 ${autoT('Accéder aux prédictions')}` : autoT('OK, retour à mon espace')}
              </button>
              <button onClick={reset} className="btn btn-ghost">
                {autoT('Nouvelle demande')}
              </button>
            </div>
          </div>
        )}

        {/* HISTORIQUE */}
        {myRequests.length > 0 && phase === 'plan' && (
          <div style={{ maxWidth: 700, margin: '40px auto 0' }}>
            <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 12 }}>
              📋 {autoT('Mes demandes de paiement')}
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

      {/* MODAL "Déjà payé ?" */}
      {paidModalOpen && (
        <div
          onClick={closePaidModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 460, width: '100%', background: '#0f172a',
              border: '1px solid rgba(59,130,246,0.3)', borderRadius: 16,
              padding: 24, maxHeight: '85vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#fff', fontSize: 18, margin: 0 }}>💳 {autoT('Déjà payé ?')}</h3>
              <button onClick={closePaidModal} className="btn btn-ghost btn-sm">✕</button>
            </div>

            {!paidResults && (
              <>
                <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18 }}>
                  {autoT("Entrez l'identifiant et le mot de passe utilisés lors de votre paiement pour retrouver et activer automatiquement votre accès.")}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <input
                    type="text"
                    placeholder={autoT('Identifiant de paiement')}
                    value={paidIdentifiant}
                    onChange={(e) => setPaidIdentifiant(e.target.value)}
                    className="input"
                    style={{ width: '100%' }}
                  />
                  <input
                    type="password"
                    placeholder={autoT('Mot de passe de paiement')}
                    value={paidPassword}
                    onChange={(e) => setPaidPassword(e.target.value)}
                    className="input"
                    style={{ width: '100%' }}
                  />
                  {paidError && (
                    <div style={{ color: '#fca5a5', fontSize: 13 }}>⚠️ {paidError}</div>
                  )}
                  <button
                    onClick={checkAlreadyPaid}
                    disabled={paidChecking || !paidIdentifiant || !paidPassword}
                    className="btn btn-gold"
                    style={{ width: '100%' }}
                  >
                    {paidChecking ? autoT('Vérification...') : autoT('Vérifier mon paiement')}
                  </button>
                </div>
              </>
            )}

            {paidResults && (
              <div>
                <h4 style={{ color: '#fbbf24', fontSize: 14, marginBottom: 12 }}>
                  📊 {autoT('Bilan de votre compte')}
                </h4>
                {paidResults.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>{autoT('Aucun paiement trouvé.')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {paidResults.map((r, i) => {
                      const s = PAID_STATUS_LABEL[r.status] || { icon: 'ℹ️', text: r.status, color: '#94a3b8' };
                      return (
                        <div key={i} style={{
                          padding: '10px 14px', borderRadius: 10,
                          background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                            {r.purpose || autoT('Paiement')} — {r.amount}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                            {r.paid_at ? new Date(r.paid_at).toLocaleString('fr-FR') : '—'} · réf: {r.reference}
                          </div>
                          <div style={{ color: s.color, fontSize: 12, marginTop: 6, fontWeight: 700 }}>
                            {s.icon} {s.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => { closePaidModal(); refreshMyRequests(); }}
                  className="btn btn-gold"
                  style={{ width: '100%', marginTop: 16 }}
                >
                  {autoT('OK')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
