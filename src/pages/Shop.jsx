import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PRICE_USD = 75;

const STATUS_LABEL = {
  awaiting_screenshot: { label: 'En attente de capture', color: '#f59e0b', icon: '📸' },
  pending_admin:       { label: 'En attente de validation', color: '#818cf8', icon: '⏳' },
  validated:           { label: 'Validé — ZIP disponible', color: '#22c55e', icon: '✅' },
  rejected:            { label: 'Refusé', color: '#f87171', icon: '❌' },
};

export default function Shop() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [catalog, setCatalog]       = useState([]);
  const [purchases, setPurchases]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('boutique'); // boutique | mes-achats
  const [modal, setModal]           = useState(null);   // { step: 'whatsapp'|'screenshot'|'done', strategy, purchaseId, whatsappLink }
  const [screenshot, setScreenshot] = useState(null);   // base64
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState('');
  const [downloading, setDownloading] = useState(null);
  const fileRef = useRef();

  const loadCatalog = useCallback(async () => {
    try {
      const r = await fetch('/api/shop/catalog', { credentials: 'include' });
      if (r.ok) setCatalog((await r.json()).catalog || []);
    } catch {}
  }, []);

  const loadPurchases = useCallback(async () => {
    try {
      const r = await fetch('/api/shop/my-purchases', { credentials: 'include' });
      if (r.ok) setPurchases(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCatalog(), loadPurchases()]).finally(() => setLoading(false));
  }, [loadCatalog, loadPurchases]);

  // ── Achat : créer la demande + ouvrir modal WhatsApp ──────────────
  async function handleBuy(item) {
    try {
      const r = await fetch('/api/shop/purchase', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: item.id }),
      });
      const data = await r.json();
      if (!r.ok) return alert(data.error || 'Erreur');

      await loadPurchases();
      if (data.already_exists) {
        const p = data.purchase;
        setModal({ step: p.status === 'awaiting_screenshot' ? 'whatsapp' : 'screenshot', strategy: item, purchaseId: p.id, whatsappLink: null });
      } else {
        setModal({ step: 'whatsapp', strategy: item, purchaseId: data.purchase.id, whatsappLink: data.whatsapp_link });
      }
    } catch (e) { alert('Erreur réseau : ' + e.message); }
  }

  // ── Upload screenshot ──────────────────────────────────────────────
  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setScreenshot(ev.target.result);
    reader.readAsDataURL(f);
  }

  async function submitScreenshot() {
    if (!screenshot || !modal?.purchaseId) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const r = await fetch(`/api/shop/purchase/${modal.purchaseId}/screenshot`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot }),
      });
      const data = await r.json();
      if (r.ok) {
        await loadPurchases();
        setModal(m => ({ ...m, step: 'done' }));
      } else {
        setUploadMsg(data.error || 'Erreur lors de l\'envoi.');
      }
    } catch (e) { setUploadMsg('Erreur réseau : ' + e.message); }
    finally { setUploading(false); }
  }

  // ── Télécharger ZIP ────────────────────────────────────────────────
  async function downloadZip(purchase) {
    setDownloading(purchase.id);
    try {
      const r = await fetch(`/api/shop/purchase/${purchase.id}/download`, { credentials: 'include' });
      if (!r.ok) { alert('Fichier non disponible'); return; }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `baccarat-bot-S${purchase.strategy_id}-${purchase.strategy_name.replace(/\s+/g,'_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('Erreur : ' + e.message); }
    finally { setDownloading(null); }
  }

  // ── Rouvrir une demande en cours ───────────────────────────────────
  function reopenPurchase(p) {
    const item = catalog.find(c => c.id === p.strategy_id) || { id: p.strategy_id, name: p.strategy_name };
    if (p.status === 'awaiting_screenshot') {
      setModal({ step: 'whatsapp', strategy: item, purchaseId: p.id, whatsappLink: null });
    } else if (p.status === 'pending_admin') {
      setModal({ step: 'done', strategy: item, purchaseId: p.id });
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b14', color: '#94a3b8' }}>
      <div style={{ fontSize: 28 }}>⏳</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0b0b14, #0f172a)', padding: '0 0 60px' }}>
      {/* ── Header ── */}
      <div style={{ background: 'rgba(15,23,42,0.95)', borderBottom: '1px solid rgba(250,204,21,0.2)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16, backdropFilter: 'blur(10px)' }}>
        <Link to="/choisir" style={{ color: '#64748b', textDecoration: 'none', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          ← Retour
        </Link>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: '#fbbf24', letterSpacing: -0.5 }}>💰 Boutique Stratégies</span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {user?.username}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(100,116,139,0.2)', background: 'rgba(15,23,42,0.7)', padding: '0 24px' }}>
        {[
          { id: 'boutique', label: '🏪 Boutique', badge: catalog.length },
          { id: 'mes-achats', label: '🛒 Mes achats', badge: purchases.length || null },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#fbbf24' : '#64748b',
              borderBottom: tab === t.id ? '2px solid #fbbf24' : '2px solid transparent',
              marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7 }}>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{ background: 'rgba(250,204,21,0.2)', color: '#fbbf24', borderRadius: 20, fontSize: 10, fontWeight: 800, padding: '1px 7px' }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>

        {/* ══════════════ TAB BOUTIQUE ══════════════ */}
        {tab === 'boutique' && (
          <div>
            {/* Bannière info */}
            <div style={{ background: 'linear-gradient(135deg, rgba(250,204,21,0.08), rgba(245,158,11,0.05))', border: '1px solid rgba(250,204,21,0.2)', borderRadius: 14, padding: '16px 20px', marginBottom: 28, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>📦</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Achetez un bot de prédiction déployable</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                  Chaque stratégie vous donne un <strong style={{ color: '#e2e8f0' }}>fichier ZIP complet</strong> contenant un bot Telegram prêt à déployer.<br />
                  Configurez votre token et votre canal — le bot envoie automatiquement les prédictions.<br />
                  Prix fixe : <strong style={{ color: '#fbbf24' }}>{PRICE_USD} $</strong> par stratégie. Paiement via WhatsApp.
                </div>
              </div>
            </div>

            {catalog.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏪</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Aucune stratégie en vente pour le moment</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Revenez bientôt — de nouvelles stratégies seront disponibles.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {catalog.map(item => {
                  const promo = item.promo || {};
                  const existingPurchase = purchases.find(p => p.strategy_id === item.id && p.status !== 'rejected');
                  const planColor = promo.plan_requis === 'pro' ? '#c084fc' : promo.plan_requis === 'premium' ? '#fbbf24' : '#22c55e';

                  return (
                    <div key={item.id} style={{
                      borderRadius: 16, overflow: 'hidden',
                      background: 'linear-gradient(145deg, #0f172a, #1a2744)',
                      border: '1.5px solid rgba(250,204,21,0.35)',
                      boxShadow: '0 4px 24px rgba(250,204,21,0.08)',
                      display: 'flex', flexDirection: 'column', position: 'relative',
                    }}>
                      {/* Badge */}
                      {promo.badge && (
                        <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 11, fontWeight: 800,
                          background: 'rgba(250,204,21,0.15)', border: '1px solid rgba(250,204,21,0.4)',
                          color: '#fbbf24', padding: '3px 10px', borderRadius: 100 }}>
                          {promo.badge}
                        </div>
                      )}
                      <div style={{ padding: '24px 20px 0' }}>
                        {/* ID + Plan */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '2px 8px', borderRadius: 100 }}>S{item.id}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                            background: promo.plan_requis === 'pro' ? 'rgba(168,85,247,0.15)' : promo.plan_requis === 'premium' ? 'rgba(250,204,21,0.1)' : 'rgba(34,197,94,0.1)',
                            color: planColor }}>
                            {promo.plan_requis === 'pro' ? '💼 Pro' : promo.plan_requis === 'premium' ? '⭐ Premium' : '✅ Standard'}
                          </span>
                        </div>

                        <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginBottom: 5, lineHeight: 1.3 }}>
                          {promo.titre || item.name}
                        </div>
                        {promo.tagline && (
                          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>{promo.tagline}</div>
                        )}

                        {/* Arguments */}
                        <div style={{ marginBottom: 16 }}>
                          {[promo.bullet1, promo.bullet2, promo.bullet3].filter(Boolean).map((b, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 5 }}>
                              <span style={{ color: '#22c55e', fontWeight: 900, fontSize: 13 }}>✓</span>
                              <span style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>{b}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Footer prix + CTA */}
                      <div style={{ marginTop: 'auto', padding: '14px 20px 20px', borderTop: '1px solid rgba(100,116,139,0.15)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Prix unique</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24', letterSpacing: -0.5 }}>{PRICE_USD} $</div>
                          </div>

                          {existingPurchase ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_LABEL[existingPurchase.status]?.color || '#64748b' }}>
                                {STATUS_LABEL[existingPurchase.status]?.icon} {STATUS_LABEL[existingPurchase.status]?.label}
                              </span>
                              {(existingPurchase.status === 'awaiting_screenshot') && (
                                <button onClick={() => reopenPurchase(existingPurchase)}
                                  style={{ padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.35)', color: '#fbbf24' }}>
                                  📸 Envoyer capture
                                </button>
                              )}
                              {existingPurchase.status === 'validated' && (
                                <button onClick={() => { setTab('mes-achats'); }}
                                  style={{ padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', color: '#22c55e' }}>
                                  ⬇️ Télécharger
                                </button>
                              )}
                            </div>
                          ) : (
                            <button onClick={() => handleBuy(item)}
                              style={{ padding: '10px 20px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                                background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', border: 'none', color: '#1a1a1a',
                                boxShadow: '0 2px 12px rgba(251,191,36,0.3)' }}>
                              {promo.cta || 'Acheter maintenant'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB MES ACHATS ══════════════ */}
        {tab === 'mes-achats' && (
          <div>
            {purchases.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Aucun achat pour le moment</div>
                <button onClick={() => setTab('boutique')} style={{ marginTop: 14, padding: '10px 24px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.3)', color: '#fbbf24' }}>
                  Voir la boutique
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {purchases.map(p => {
                  const st = STATUS_LABEL[p.status] || { label: p.status, color: '#64748b', icon: '❓' };
                  return (
                    <div key={p.id} style={{ background: 'rgba(15,23,42,0.8)', border: `1px solid rgba(${p.status==='validated'?'34,197,94':p.status==='rejected'?'239,68,68':'250,204,21'},0.25)`, borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '2px 8px', borderRadius: 100 }}>S{p.strategy_id}</span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>{p.strategy_name}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          Réf. #{p.id} · {new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                        {p.admin_note && p.status === 'rejected' && (
                          <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>Note : {p.admin_note}</div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 900, color: '#fbbf24' }}>{p.amount_usd} $</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 100, background: `rgba(${p.status==='validated'?'34,197,94':p.status==='rejected'?'239,68,68':p.status==='pending_admin'?'129,140,248':'245,158,11'},0.12)`, border: `1px solid rgba(${p.status==='validated'?'34,197,94':p.status==='rejected'?'239,68,68':p.status==='pending_admin'?'129,140,248':'245,158,11'},0.3)` }}>
                        <span>{st.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.label}</span>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        {p.status === 'validated' && p.has_zip && (
                          <button onClick={() => downloadZip(p)} disabled={downloading === p.id}
                            style={{ padding: '8px 16px', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: downloading===p.id ? 'wait' : 'pointer',
                              background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))',
                              border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e' }}>
                            {downloading === p.id ? '⏳…' : '⬇️ Télécharger ZIP'}
                          </button>
                        )}
                        {(p.status === 'awaiting_screenshot' || p.status === 'rejected') && (
                          <button onClick={() => {
                            const item = catalog.find(c => c.id === p.strategy_id) || { id: p.strategy_id, name: p.strategy_name };
                            setScreenshot(null);
                            setUploadMsg('');
                            setModal({ step: 'whatsapp', strategy: item, purchaseId: p.id, whatsappLink: null });
                          }}
                            style={{ padding: '8px 14px', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer',
                              background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', color: '#fbbf24' }}>
                            📸 Envoyer capture
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════ MODAL ACHAT ══════════════ */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ background: 'linear-gradient(145deg, #0f172a, #1e293b)', border: '1.5px solid rgba(250,204,21,0.4)', borderRadius: 20, padding: 28, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>

            {/* ── Étape 1 : WhatsApp ── */}
            {modal.step === 'whatsapp' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
                  <h2 style={{ margin: 0, color: '#fbbf24', fontSize: 18, fontWeight: 800 }}>Étape 1 — Paiement WhatsApp</h2>
                  <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>
                    Cliquez sur le bouton ci-dessous pour nous contacter sur WhatsApp.<br />
                    Le message avec le nom de la stratégie est <strong style={{ color: '#e2e8f0' }}>pré-rempli automatiquement</strong>.
                  </p>
                </div>

                <div style={{ background: 'rgba(250,204,21,0.07)', border: '1px solid rgba(250,204,21,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Récapitulatif</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{modal.strategy?.promo?.titre || modal.strategy?.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Réf. #{modal.purchaseId}</span>
                    <span style={{ fontSize: 20, fontWeight: 900, color: '#fbbf24' }}>{PRICE_USD} $</span>
                  </div>
                </div>

                <a href={modal.whatsappLink || `https://wa.me/2290195501564?text=${encodeURIComponent(`Je veux payer la stratégie S${modal.strategy?.id} — ${modal.strategy?.name}. Réf. #${modal.purchaseId}. Prix : ${PRICE_USD}$`)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', borderRadius: 12, background: 'linear-gradient(135deg, #25d366, #128c7e)', color: '#fff', fontWeight: 800, fontSize: 15, textDecoration: 'none', marginBottom: 16, boxShadow: '0 4px 20px rgba(37,211,102,0.3)' }}>
                  <span style={{ fontSize: 20 }}>💬</span> Payer via WhatsApp
                </a>

                <div style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                  <strong style={{ color: '#818cf8' }}>Comment ça marche :</strong><br />
                  1. Cliquez sur "Payer via WhatsApp" pour nous contacter<br />
                  2. Effectuez le paiement selon les instructions reçues<br />
                  3. Revenez ici et envoyez votre capture d'écran de confirmation
                </div>

                <button onClick={() => { setScreenshot(null); setUploadMsg(''); setModal(m => ({ ...m, step: 'screenshot' })); }}
                  style={{ width: '100%', padding: '12px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.3)', color: '#fbbf24' }}>
                  📸 J'ai payé — Envoyer ma capture d'écran
                </button>

                <button onClick={() => setModal(null)} style={{ width: '100%', marginTop: 8, padding: '10px', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(100,116,139,0.3)', color: '#64748b' }}>
                  Fermer
                </button>
              </>
            )}

            {/* ── Étape 2 : Capture d'écran ── */}
            {modal.step === 'screenshot' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
                  <h2 style={{ margin: 0, color: '#fbbf24', fontSize: 18, fontWeight: 800 }}>Étape 2 — Confirmation de paiement</h2>
                  <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>
                    Envoyez la capture d'écran de votre confirmation de paiement.<br />
                    L'administrateur la vérifiera et validera votre accès.
                  </p>
                </div>

                {/* Zone d'upload */}
                <div onClick={() => fileRef.current?.click()}
                  style={{ border: '2px dashed rgba(250,204,21,0.4)', borderRadius: 12, padding: '28px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: screenshot ? 'rgba(34,197,94,0.05)' : 'rgba(250,204,21,0.04)', transition: 'all 0.2s' }}>
                  {screenshot ? (
                    <div>
                      <img src={screenshot} alt="capture" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 8, objectFit: 'contain' }} />
                      <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>✅ Capture sélectionnée</div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
                      <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 600 }}>Cliquez pour sélectionner votre capture</div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>JPG, PNG, WebP acceptés</div>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

                {uploadMsg && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 12, fontWeight: 600, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                    {uploadMsg}
                  </div>
                )}

                <button onClick={submitScreenshot} disabled={!screenshot || uploading}
                  style={{ width: '100%', padding: '13px', borderRadius: 11, fontWeight: 800, fontSize: 14, cursor: !screenshot || uploading ? 'not-allowed' : 'pointer', opacity: !screenshot || uploading ? 0.5 : 1,
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', border: 'none', color: '#1a1a1a', marginBottom: 10 }}>
                  {uploading ? '⏳ Envoi en cours…' : '✅ Envoyer la capture d\'écran'}
                </button>

                <button onClick={() => setModal(m => ({ ...m, step: 'whatsapp' }))}
                  style={{ width: '100%', padding: '10px', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(100,116,139,0.3)', color: '#64748b' }}>
                  ← Retour
                </button>
              </>
            )}

            {/* ── Étape 3 : Confirmation ── */}
            {modal.step === 'done' && (
              <>
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 52, marginBottom: 16 }}>⏳</div>
                  <h2 style={{ margin: 0, color: '#818cf8', fontSize: 20, fontWeight: 800, marginBottom: 12 }}>En attente de validation</h2>
                  <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.8, margin: '0 0 20px' }}>
                    Votre capture d'écran a bien été reçue.<br />
                    <strong style={{ color: '#e2e8f0' }}>L'administrateur va la vérifier</strong> et valider votre achat.<br />
                    Une fois validé, vous pourrez télécharger votre fichier ZIP depuis l'onglet <strong style={{ color: '#fbbf24' }}>Mes achats</strong>.
                  </p>
                  <div style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 20, fontSize: 12, color: '#94a3b8', lineHeight: 1.7, textAlign: 'left' }}>
                    <strong style={{ color: '#818cf8' }}>Ce que vous allez recevoir :</strong><br />
                    📦 Un fichier ZIP avec le bot complet<br />
                    ⚙️ Configurez votre token Telegram + canal<br />
                    🚀 Déployez sur n'importe quelle plateforme<br />
                    📡 Le bot envoie les prédictions automatiquement
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button onClick={() => { setModal(null); setTab('mes-achats'); loadPurchases(); }}
                      style={{ padding: '11px 24px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.3)', color: '#fbbf24' }}>
                      Voir mes achats
                    </button>
                    <button onClick={() => setModal(null)}
                      style={{ padding: '11px 24px', borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(100,116,139,0.3)', color: '#64748b' }}>
                      Fermer
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
