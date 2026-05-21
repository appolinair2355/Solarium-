import React, { useState, useEffect, useCallback } from 'react';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_MAP = {
  awaiting_screenshot: { label: 'En attente de capture', color: '#f59e0b', icon: '📸', bg: 'rgba(245,158,11,0.1)' },
  pending_admin:       { label: 'Capture reçue — À valider', color: '#818cf8', icon: '🔍', bg: 'rgba(129,140,248,0.1)' },
  validated:           { label: 'Validé ✓', color: '#22c55e', icon: '✅', bg: 'rgba(34,197,94,0.1)' },
  rejected:            { label: 'Refusé', color: '#f87171', icon: '❌', bg: 'rgba(239,68,68,0.1)' },
};

function emptyForm() {
  return { name: '', description: '', is_paid: false, price_usd: '', enabled: true };
}

export default function AdminIdeas() {
  const [ideas, setIdeas]         = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [tab, setTab]             = useState('ideas');
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState(emptyForm());
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');
  const [purchMsg, setPurchMsg]   = useState({});
  const [screenshotModal, setScreenshotModal] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [reordering, setReordering] = useState(null);

  const loadIdeas = useCallback(async () => {
    const r = await fetch('/api/ideas/catalog', { credentials: 'include' });
    if (r.ok) setIdeas(await r.json());
  }, []);

  const loadPurchases = useCallback(async () => {
    const r = await fetch('/api/ideas/admin/purchases', { credentials: 'include' });
    if (r.ok) setPurchases(await r.json());
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadIdeas(), loadPurchases()]).finally(() => setLoading(false));
  }, [loadIdeas, loadPurchases]);

  function openNew() {
    setForm(emptyForm());
    setMsg('');
    setModal('new');
  }

  function openEdit(idea) {
    setForm({ name: idea.name, description: idea.description, is_paid: idea.is_paid, price_usd: String(idea.price_usd || ''), enabled: idea.enabled !== false });
    setMsg('');
    setModal({ idea });
  }

  async function handleSave() {
    if (!form.name.trim())        return setMsg('Nom requis');
    if (!form.description.trim()) return setMsg('Description requise');
    if (form.is_paid && (!form.price_usd || parseFloat(form.price_usd) <= 0)) return setMsg('Prix requis pour une idée payante');

    setSaving(true); setMsg('');
    try {
      const isNew = modal === 'new';
      const url   = isNew ? '/api/ideas' : `/api/ideas/${modal.idea.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, price_usd: parseFloat(form.price_usd) || 0 }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'Erreur'); return; }
      setModal(null);
      loadIdeas();
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cette idée de stratégie ?')) return;
    await fetch(`/api/ideas/${id}`, { method: 'DELETE', credentials: 'include' });
    loadIdeas();
  }

  async function toggleEnabled(idea) {
    await fetch(`/api/ideas/${idea.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: idea.name, description: idea.description, is_paid: idea.is_paid, price_usd: idea.price_usd, enabled: !idea.enabled }),
    });
    loadIdeas();
  }

  async function handleReorder(id, direction) {
    setReordering(id);
    try {
      await fetch('/api/ideas/admin/reorder', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      });
      await loadIdeas();
    } finally { setReordering(null); }
  }

  async function approveP(id) {
    setPurchMsg(m => ({ ...m, [id]: { loading: true } }));
    const r = await fetch(`/api/ideas/admin/purchase/${id}/approve`, { method: 'POST', credentials: 'include' });
    const d = await r.json();
    setPurchMsg(m => ({ ...m, [id]: { text: r.ok ? '✅ Validé' : `❌ ${d.error}`, ok: r.ok } }));
    if (r.ok) loadPurchases();
  }

  async function rejectP(id) {
    setPurchMsg(m => ({ ...m, [id]: { loading: true } }));
    const r = await fetch(`/api/ideas/admin/purchase/${id}/reject`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: rejectNote }),
    });
    const d = await r.json();
    setPurchMsg(m => ({ ...m, [id]: { text: r.ok ? '✅ Refusé' : `❌ ${d.error}`, ok: r.ok } }));
    if (r.ok) { setScreenshotModal(null); setRejectNote(''); loadPurchases(); }
  }

  const inp = { padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.35)', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', fontSize: 14, width: '100%', boxSizing: 'border-box' };
  const labelSt = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' };

  const pendingPurchases = purchases.filter(p => p.status === 'pending_admin');

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>💡 Stratégies Texte (Niveaux)</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Publiez des stratégies texte numérotées par niveau — les utilisateurs voient uniquement le numéro de niveau, le prix et un aperçu</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid rgba(255,255,255,0.06)' }}>
        {[
          { id: 'ideas', label: '💡 Niveaux', badge: ideas.length },
          { id: 'purchases', label: '🧾 Achats', badge: pendingPurchases.length || null },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? '#fbbf24' : '#64748b', borderBottom: tab === t.id ? '2px solid #fbbf24' : '2px solid transparent', marginBottom: -2, display: 'flex', alignItems: 'center', gap: 7 }}>
            {t.label}
            {t.badge != null && t.badge > 0 && <span style={{ background: t.id === 'purchases' && pendingPurchases.length > 0 ? '#ef4444' : 'rgba(250,204,21,0.2)', color: t.id === 'purchases' && pendingPurchases.length > 0 ? '#fff' : '#fbbf24', borderRadius: 20, fontSize: 10, fontWeight: 800, padding: '1px 7px' }}>{t.badge}</span>}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', paddingBottom: 2 }}>
          {tab === 'ideas' && <button onClick={openNew} style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#1a1a1a', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>+ Ajouter un niveau</button>}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>⏳</div>
      ) : tab === 'ideas' ? (
        ideas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💡</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Aucune stratégie texte publiée</div>
            <button onClick={openNew} style={{ marginTop: 14, padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#1a1a1a', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>+ Créer le Niveau 1</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {ideas.map((idea, idx) => {
              const levelNum = idea.level_number ?? (idx + 1);
              const isFirst  = idx === 0;
              const isLast   = idx === ideas.length - 1;
              return (
                <div key={idea.id} style={{ background: 'rgba(15,23,42,0.9)', border: `1px solid rgba(${idea.enabled ? '250,204,21' : '100,116,139'},0.25)`, borderRadius: 14, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                    {/* Reorder buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
                      <button
                        disabled={isFirst || reordering === idea.id}
                        onClick={() => handleReorder(idea.id, 'up')}
                        title="Monter"
                        style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(250,204,21,0.3)', background: isFirst ? 'rgba(100,116,139,0.05)' : 'rgba(250,204,21,0.08)', color: isFirst ? '#475569' : '#fbbf24', cursor: isFirst ? 'default' : 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isFirst ? 0.3 : 1 }}>
                        ▲
                      </button>
                      <button
                        disabled={isLast || reordering === idea.id}
                        onClick={() => handleReorder(idea.id, 'down')}
                        title="Descendre"
                        style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(250,204,21,0.3)', background: isLast ? 'rgba(100,116,139,0.05)' : 'rgba(250,204,21,0.08)', color: isLast ? '#475569' : '#fbbf24', cursor: isLast ? 'default' : 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isLast ? 0.3 : 1 }}>
                        ▼
                      </button>
                    </div>

                    {/* Level badge */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,rgba(250,204,21,0.18),rgba(245,158,11,0.10))', border: '2px solid rgba(250,204,21,0.5)', flexDirection: 'column' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: '#92400e', letterSpacing: 0.8, textTransform: 'uppercase' }}>Niv.</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24', lineHeight: 1 }}>{levelNum}</div>
                    </div>

                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>{idea.name}</span>
                        {idea.is_paid ? (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(250,204,21,0.15)', color: '#fbbf24', border: '1px solid rgba(250,204,21,0.35)' }}>💰 {Number(idea.price_usd).toFixed(0)} $</span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>🆓 Gratuit</span>
                        )}
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: idea.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.15)', color: idea.enabled ? '#22c55e' : '#64748b', border: `1px solid rgba(${idea.enabled ? '34,197,94' : '100,116,139'},0.25)` }}>
                          {idea.enabled ? '🌐 Visible' : '🔒 Masquée'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7, maxWidth: 700, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                        {idea.description}
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                        Créé : {fmtDate(idea.created_at)} · Mis à jour : {fmtDate(idea.updated_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => openEdit(idea)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.35)', background: 'rgba(250,204,21,0.08)', color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✏️ Modifier</button>
                      <button onClick={() => toggleEnabled(idea)} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid rgba(${idea.enabled ? '245,158,11' : '34,197,94'},0.35)`, background: `rgba(${idea.enabled ? '245,158,11' : '34,197,94'},0.08)`, color: idea.enabled ? '#f59e0b' : '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                        {idea.enabled ? '🔒 Masquer' : '🌐 Publier'}
                      </button>
                      <button onClick={() => handleDelete(idea.id)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🗑 Supprimer</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* TAB ACHATS */
        purchases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🧾</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Aucun achat enregistré</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {purchases.map(p => {
              const st  = STATUS_MAP[p.status] || { label: p.status, color: '#64748b', icon: '❓', bg: 'rgba(100,116,139,0.1)' };
              const pm  = purchMsg[p.id];
              return (
                <div key={p.id} style={{ background: 'rgba(15,23,42,0.9)', border: `1px solid rgba(${p.status === 'validated' ? '34,197,94' : p.status === 'rejected' ? '239,68,68' : p.status === 'pending_admin' ? '129,140,248' : '250,204,21'},0.3)`, borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid rgba(100,116,139,0.1)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '2px 7px', borderRadius: 100 }}>#{p.id}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>💡 {p.idea_name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>👤 <strong style={{ color: '#94a3b8' }}>{p.username}</strong>{p.email && ` · ${p.email}`} · {fmtDate(p.created_at)}</div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#fbbf24' }}>{Number(p.amount_usd).toFixed(0)} $</div>
                    <div style={{ padding: '4px 12px', borderRadius: 100, background: st.bg, border: `1px solid ${st.color}40`, fontSize: 12, fontWeight: 700, color: st.color }}>
                      {st.icon} {st.label}
                    </div>
                  </div>

                  {p.status === 'pending_admin' && (
                    <div style={{ padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      {p.screenshot_data && (
                        <button onClick={() => setScreenshotModal({ p })} style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(56,189,248,0.4)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                          📸 Voir capture
                        </button>
                      )}
                      <button onClick={() => approveP(p.id)} disabled={pm?.loading} style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                        {pm?.loading ? '⏳' : '✅ Valider'}
                      </button>
                      <button onClick={() => { setScreenshotModal({ p, rejectMode: true }); setRejectNote(''); }} style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                        ❌ Refuser
                      </button>
                      {pm?.text && <span style={{ fontSize: 12, fontWeight: 700, color: pm.ok ? '#22c55e' : '#f87171' }}>{pm.text}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Modal Formulaire Idée ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ background: 'linear-gradient(145deg,#0f172a,#1e293b)', border: '1.5px solid rgba(250,204,21,0.4)', borderRadius: 20, padding: 28, maxWidth: 700, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24', marginBottom: 22 }}>
              {modal === 'new' ? `💡 Nouveau Niveau ${ideas.length + 1}` : `✏️ Modifier : ${modal.idea?.name}`}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelSt}>Nom interne de l'idée</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Stratégie Martingale Inversée" style={inp} />
              </div>

              <div>
                <label style={labelSt}>
                  Description complète
                  <span style={{ fontWeight: 400, color: '#475569', textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>— Rédigez de façon attirante, avec exemples. Supporte les sauts de ligne.</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder={`✨ Présentez l'idée de manière séduisante et précise.\n\n📌 Exemple :\nCette stratégie repose sur l'analyse des 5 dernières séquences...\n\n💡 Comment l'appliquer :\n1. Observez les 3 premiers jeux\n2. Si la tendance est Banker, misez sur...\n\n⚡ Résultats attendus : 70–80% de réussite sur 10 sessions.`}
                  rows={10}
                  style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
                />
                <div style={{ fontSize: 11, color: '#475569', marginTop: 6, textAlign: 'right' }}>
                  Mis à jour : {fmtDate(modal?.idea?.updated_at || new Date().toISOString())}
                </div>
              </div>

              <div>
                <label style={labelSt}>Accès</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { val: false, label: '🆓 Gratuit', desc: 'Tous les utilisateurs voient la description directement', color: '34,197,94' },
                    { val: true,  label: '💰 Payant', desc: 'Redirection vers paiement + validation admin requise', color: '250,204,21' },
                  ].map(opt => (
                    <label key={String(opt.val)} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 14px', borderRadius: 12, border: `2px solid rgba(${form.is_paid === opt.val ? opt.color + ',0.6' : '100,116,139,0.25'})`, background: form.is_paid === opt.val ? `rgba(${opt.color},0.06)` : 'transparent', transition: 'all 0.18s' }}>
                      <input type="radio" checked={form.is_paid === opt.val} onChange={() => setForm(f => ({ ...f, is_paid: opt.val }))} style={{ marginTop: 3, accentColor: `rgb(${opt.color})` }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: form.is_paid === opt.val ? `rgb(${opt.color})` : '#94a3b8' }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {form.is_paid && (
                <div>
                  <label style={labelSt}>Prix en dollars ($)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18, color: '#fbbf24', fontWeight: 800 }}>$</span>
                    <input type="number" min={1} step={0.5} value={form.price_usd} onChange={e => setForm(f => ({ ...f, price_usd: e.target.value }))} placeholder="Ex: 10" style={{ ...inp, width: 120 }} />
                  </div>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#fbbf24' }} />
                <span style={{ fontSize: 13, color: form.enabled ? '#22c55e' : '#64748b', fontWeight: 600 }}>
                  {form.enabled ? '🌐 Visible dans la boutique de tous les utilisateurs' : '🔒 Masquée (non visible)'}
                </span>
              </label>

              {msg && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>{msg}</div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#1a1a1a', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  {saving ? '⏳ Enregistrement…' : '✅ Enregistrer et publier'}
                </button>
                <button onClick={() => setModal(null)} style={{ padding: '12px 20px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 700 }}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal capture + refus ── */}
      {screenshotModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setScreenshotModal(null); }}>
          <div style={{ background: 'linear-gradient(145deg,#0f172a,#1e293b)', border: '1.5px solid rgba(56,189,248,0.4)', borderRadius: 20, padding: 24, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8', marginBottom: 16 }}>
              {screenshotModal.rejectMode ? '❌ Refuser l\'achat' : '📸 Capture de paiement'}
            </div>
            {screenshotModal.p.screenshot_data && !screenshotModal.rejectMode && (
              <img src={screenshotModal.p.screenshot_data} alt="Capture paiement" style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(100,116,139,0.3)', marginBottom: 16 }} />
            )}
            {screenshotModal.rejectMode && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Note de refus (optionnel)</label>
                <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3} placeholder="Paiement non trouvé, montant incorrect…" style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.3)', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              {!screenshotModal.rejectMode && (
                <button onClick={() => approveP(screenshotModal.p.id)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>✅ Valider le paiement</button>
              )}
              {screenshotModal.rejectMode && (
                <button onClick={() => rejectP(screenshotModal.p.id)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>❌ Confirmer le refus</button>
              )}
              <button onClick={() => setScreenshotModal(null)} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 700 }}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
