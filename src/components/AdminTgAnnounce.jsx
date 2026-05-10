import React, { useState, useEffect, useCallback, useRef } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function parseHours(val) {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string') { try { return JSON.parse(val).map(Number); } catch { return []; } }
  return [];
}

function nextSendLabel(ann) {
  const now   = new Date();
  const hNow  = now.getHours();
  const mNow  = now.getMinutes();

  if (ann.schedule_type === 'interval') {
    const every = Math.max(1, parseInt(ann.interval_hours) || 1);
    const nextH = Math.ceil((hNow * 60 + mNow + 1) / 60 / every) * every % 24;
    return `Prochaine à ${String(nextH).padStart(2,'0')}h00`;
  }
  if (ann.schedule_type === 'fixed') {
    const hours  = parseHours(ann.fixed_hours).sort((a,b) => a-b);
    const future = hours.find(h => h > hNow || (h === hNow && mNow === 0));
    const next   = future !== undefined ? future : hours[0];
    if (next === undefined) return '—';
    const label  = `${String(next).padStart(2,'0')}h00`;
    return future !== undefined ? `Prochaine aujourd'hui à ${label}` : `Prochaine demain à ${label}`;
  }
  return '—';
}

function emptyForm() {
  return {
    name:           '',
    channel_id:     '',
    bot_token:      '',
    message_text:   '',
    media_type:     '',
    media_data:     null,
    media_filename: '',
    _mediaTouched:  false,   // interne — sert à savoir si l'utilisateur a modifié le média
    _mediaCleared:  false,   // true si l'utilisateur a cliqué ✕
    schedule_type:  'interval',
    interval_hours: 1,
    fixed_hours:    [],
    enabled:        true,
  };
}

const S = {
  card:    { background: 'rgba(15,23,42,0.95)', borderRadius: 16, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 },
  inp:     { padding: '10px 14px', borderRadius: 10, border: '1.5px solid rgba(100,116,139,0.3)', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' },
  label:   { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 5, display: 'block' },
  btnPrim: { padding: '11px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#38bdf8,#0ea5e9)', color: '#0f172a', fontWeight: 800, fontSize: 13, cursor: 'pointer' },
  btnGhost:{ padding: '11px 20px', borderRadius: 10, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
};

function Badge({ color, text }) {
  const map = {
    green:  { bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.3)',  text: '#22c55e' },
    gray:   { bg: 'rgba(100,116,139,.15)',border: 'rgba(100,116,139,.3)',text: '#64748b' },
    purple: { bg: 'rgba(168,85,247,.12)', border: 'rgba(168,85,247,.3)', text: '#a855f7' },
    blue:   { bg: 'rgba(56,189,248,.1)',  border: 'rgba(56,189,248,.3)', text: '#38bdf8' },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

export default function AdminTgAnnounce() {
  const [list,     setList]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [hints,    setHints]    = useState([]);
  const [modal,    setModal]    = useState(null);        // null | 'new' | { ann }
  const [form,     setForm]     = useState(emptyForm());
  const [saving,   setSaving]   = useState(false);
  const [errMsg,   setErrMsg]   = useState('');
  const [sendState,setSendState]= useState({});          // { [id]: 'loading'|'ok'|'err:...' }
  const [saveSuccess,setSaveSuccess] = useState(false);  // true après sauvegarde réussie
  const [showToken,setShowToken]= useState(false);
  const fileRef   = useRef();
  const modalRef  = useRef();

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/tg-announce', { credentials: 'include' });
      if (r.ok) setList(await r.json());
    } finally { setLoading(false); }
  }, []);

  const loadHints = useCallback(async () => {
    try {
      const r = await fetch('/api/tg-announce/channels-hint', { credentials: 'include' });
      if (r.ok) setHints(await r.json());
    } catch {}
  }, []);

  useEffect(() => { load(); loadHints(); }, [load, loadHints]);

  // ── Ouverture modale ──────────────────────────────────────────────────────
  function openNew() {
    setForm(emptyForm());
    setErrMsg('');
    setShowToken(false);
    setModal('new');
  }

  function openEdit(ann) {
    setForm({
      name:           ann.name,
      channel_id:     ann.channel_id,
      bot_token:      ann.bot_token,
      message_text:   ann.message_text,
      media_type:     ann.media_type  || '',
      media_data:     null,
      media_filename: ann.media_filename || '',
      _mediaTouched:  false,
      _mediaCleared:  false,
      schedule_type:  ann.schedule_type  || 'interval',
      interval_hours: ann.interval_hours || 1,
      fixed_hours:    parseHours(ann.fixed_hours),
      enabled:        ann.enabled !== false,
    });
    setErrMsg('');
    setShowToken(false);
    setModal({ ann });
  }

  function patchForm(patch) { setForm(f => ({ ...f, ...patch })); }

  // ── Fichier média ─────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const isVideo = f.type.startsWith('video/');
    if (isVideo && f.size > 50 * 1024 * 1024) { setErrMsg('Vidéo trop lourde (max 50 Mo)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result.split(',')[1];
      patchForm({ media_type: isVideo ? 'video' : 'image', media_data: b64, media_filename: f.name, _mediaTouched: true, _mediaCleared: false });
      setErrMsg('');
    };
    reader.readAsDataURL(f);
  }

  function clearMedia() {
    patchForm({ media_type: '', media_data: null, media_filename: '', _mediaTouched: true, _mediaCleared: true });
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── Hint canal ───────────────────────────────────────────────────────────
  function applyHint(h) {
    patchForm({ channel_id: h.channel_id, bot_token: h.bot_token });
  }

  // ── Heures fixes ─────────────────────────────────────────────────────────
  function toggleHour(h) {
    patchForm({
      fixed_hours: form.fixed_hours.includes(h)
        ? form.fixed_hours.filter(x => x !== h)
        : [...form.fixed_hours, h].sort((a,b) => a - b),
    });
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim())         return setErrMsg('Nom requis');
    if (!form.channel_id.trim())   return setErrMsg('ID canal requis');
    if (!form.bot_token.trim())    return setErrMsg('Token bot requis');
    if (!form.message_text.trim()) return setErrMsg('Message requis');
    if (form.schedule_type === 'interval' && !(parseInt(form.interval_hours) >= 1))
      return setErrMsg('Intervalle invalide (min 1h)');
    if (form.schedule_type === 'fixed' && form.fixed_hours.length === 0)
      return setErrMsg('Sélectionnez au moins une heure fixe');

    setSaving(true); setErrMsg(''); setSaveSuccess(false);
    try {
      const isNew = modal === 'new';
      const url   = isNew ? '/api/tg-announce' : `/api/tg-announce/${modal.ann.id}`;

      // Construire le payload — exclure les champs internes et gérer le media prudemment
      const { _mediaTouched, _mediaCleared, ...rest } = form;
      const payload = { ...rest };

      if (!isNew) {
        // En mode édition : seulement envoyer le media si l'utilisateur l'a touché
        if (!_mediaTouched) {
          delete payload.media_data;
          delete payload.media_type;
          delete payload.media_filename;
        } else {
          payload.media_cleared = _mediaCleared;
        }
      }

      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { setErrMsg(d.error || 'Erreur serveur'); return; }

      // Envoi immédiat sur Telegram après sauvegarde (fire-and-forget — ne bloque pas l'UI)
      const savedId = isNew ? (d.id ?? d.announce?.id) : modal.ann.id;
      if (savedId) {
        fetch(`/api/tg-announce/${savedId}/send-now`, { method: 'POST', credentials: 'include' }).catch(() => {});
      }

      load();
      loadHints();
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setModal(null);
      }, 2500);
    } finally { setSaving(false); }
  }

  // ── Supprimer ─────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    if (!confirm('Supprimer cette annonce ?')) return;
    await fetch(`/api/tg-announce/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  }

  // ── Activer / Désactiver ──────────────────────────────────────────────────
  async function handleToggle(ann) {
    await fetch(`/api/tg-announce/${ann.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !ann.enabled }),
    });
    load();
  }

  // ── Envoyer maintenant ────────────────────────────────────────────────────
  async function handleSendNow(id) {
    setSendState(s => ({ ...s, [id]: 'loading' }));
    try {
      const r = await fetch(`/api/tg-announce/${id}/send-now`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      const st = r.ok ? 'ok' : `err:${d.error || 'Erreur'}`;
      setSendState(s => ({ ...s, [id]: st }));
      if (r.ok) { load(); setTimeout(() => setSendState(s => ({ ...s, [id]: null })), 3000); }
      else setTimeout(() => setSendState(s => ({ ...s, [id]: null })), 5000);
    } catch (e) {
      setSendState(s => ({ ...s, [id]: `err:${e.message}` }));
      setTimeout(() => setSendState(s => ({ ...s, [id]: null })), 5000);
    }
  }

  // ── Rendu carte annonce ───────────────────────────────────────────────────
  function renderCard(ann) {
    const ss   = sendState[ann.id];
    const hours = parseHours(ann.fixed_hours);

    return (
      <div key={ann.id} style={{ ...S.card, border: `1.5px solid rgba(${ann.enabled ? '56,189,248' : '100,116,139'},0.22)` }}>
        {/* Ligne 1 : titre + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>📢 {ann.name}</span>
          <Badge color={ann.enabled ? 'green' : 'gray'} text={ann.enabled ? '● Actif' : '○ Inactif'} />
          {ann.media_type === 'image' && <Badge color="purple" text="🖼 Photo" />}
          {ann.media_type === 'video' && <Badge color="purple" text="🎬 Vidéo" />}
          <Badge color="blue" text={
            ann.schedule_type === 'interval'
              ? `⏱ Toutes les ${ann.interval_hours}h`
              : `🕐 ${hours.length} heure${hours.length > 1 ? 's' : ''} fixe${hours.length > 1 ? 's' : ''}`
          } />
        </div>

        {/* Ligne 2 : infos canal + planification */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
          <div style={{ color: '#64748b' }}>
            Canal : <code style={{ background: 'rgba(56,189,248,.08)', padding: '1px 7px', borderRadius: 4, color: '#38bdf8', fontSize: 11 }}>{ann.channel_id}</code>
          </div>
          {ann.schedule_type === 'fixed' && hours.length > 0 && (
            <div style={{ color: '#64748b' }}>
              Heures : <span style={{ color: '#94a3b8', fontWeight: 600 }}>{hours.map(h => `${String(h).padStart(2,'0')}h`).join(' · ')}</span>
            </div>
          )}
          {ann.enabled && (
            <div style={{ color: '#475569' }}>⏰ {nextSendLabel(ann)}</div>
          )}
          <div style={{ color: '#475569' }}>Dernier envoi : <span style={{ color: '#64748b' }}>{fmtDate(ann.last_sent_at)}</span></div>
        </div>

        {/* Ligne 3 : aperçu message */}
        {ann.message_text && (
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', borderLeft: '3px solid rgba(56,189,248,.2)', paddingLeft: 10 }}>
            {ann.message_text}
          </div>
        )}

        {/* Ligne 4 : feedback envoi */}
        {ss && ss !== 'loading' && (
          <div style={{ fontSize: 12, fontWeight: 700, color: ss === 'ok' ? '#22c55e' : '#f87171' }}>
            {ss === 'ok' ? '✅ Envoyé avec succès !' : `❌ ${ss.replace('err:','')}`}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <button onClick={() => handleSendNow(ann.id)} disabled={ss === 'loading'}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(34,197,94,.4)', background: 'rgba(34,197,94,.07)', color: '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {ss === 'loading' ? '⏳ Envoi…' : '▶ Envoyer maintenant'}
          </button>
          <button onClick={() => handleToggle(ann)}
            style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid rgba(${ann.enabled ? '245,158,11' : '34,197,94'},.4)`, background: `rgba(${ann.enabled ? '245,158,11' : '34,197,94'},.07)`, color: ann.enabled ? '#f59e0b' : '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {ann.enabled ? '⏸ Désactiver' : '▶ Activer'}
          </button>
          <button onClick={() => openEdit(ann)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(56,189,248,.35)', background: 'rgba(56,189,248,.07)', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            ✏️ Modifier
          </button>
          <button onClick={() => handleDelete(ann.id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)', color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            🗑 Supprimer
          </button>
        </div>
      </div>
    );
  }

  // ── Rendu modal formulaire ────────────────────────────────────────────────
  function renderModal() {
    if (!modal) return null;
    const isNew  = modal === 'new';
    const hasExistingMedia = !isNew && modal.ann?.media_type && !form._mediaTouched;

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
        onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
        <div ref={modalRef} style={{ background: 'linear-gradient(145deg,#0f172a,#1a2537)', border: '1.5px solid rgba(56,189,248,.35)', borderRadius: 20, padding: 28, width: '100%', maxWidth: 660 }}>

          {/* Titre */}
          <div style={{ fontSize: 17, fontWeight: 800, color: '#38bdf8', marginBottom: 22 }}>
            {isNew ? '📢 Nouvelle annonce Telegram' : `✏️ Modifier : ${modal.ann?.name}`}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Nom */}
            <div>
              <label style={S.label}>Nom de l'annonce *</label>
              <input value={form.name} onChange={e => patchForm({ name: e.target.value })}
                placeholder="Ex : Promo hebdo, Rappel abonnement…" style={S.inp} />
            </div>

            {/* Canal & Bot — avec picker de canaux existants */}
            <div>
              <label style={S.label}>Canal Telegram & Bot *</label>

              {/* Hints — canaux déjà configurés */}
              {hints.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Utiliser un canal existant :</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {hints.map((h, i) => (
                      <button key={i} type="button" onClick={() => applyHint(h)}
                        style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.06)', color: '#38bdf8', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        {h.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ ...S.label, marginTop: 4 }}>ID du canal</label>
                  <input value={form.channel_id} onChange={e => patchForm({ channel_id: e.target.value })}
                    placeholder="-1001234567890" style={S.inp} />
                </div>
                <div>
                  <label style={{ ...S.label, marginTop: 4 }}>Token API Bot</label>
                  <div style={{ position: 'relative' }}>
                    <input value={form.bot_token} onChange={e => patchForm({ bot_token: e.target.value })}
                      placeholder="1234567890:ABC…" type={showToken ? 'text' : 'password'}
                      style={{ ...S.inp, paddingRight: 38 }} />
                    <button type="button" onClick={() => setShowToken(v => !v)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: 0 }}>
                      {showToken ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Message */}
            <div>
              <label style={S.label}>Texte de l'annonce * <span style={{ color: '#334155', fontSize: 9 }}>(HTML Telegram : &lt;b&gt;, &lt;i&gt;, &lt;a href=…&gt;)</span></label>
              <textarea value={form.message_text} onChange={e => patchForm({ message_text: e.target.value })}
                placeholder="Rédigez votre annonce ici…&#10;Supports le HTML Telegram : <b>gras</b>, <i>italique</i>, <a href='...'>lien</a>"
                rows={5} style={{ ...S.inp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }} />
              <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>
                {form.message_text.length} caractère{form.message_text.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Média */}
            <div>
              <label style={S.label}>Photo ou vidéo (optionnel — max 50 Mo)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(56,189,248,.4)', background: 'rgba(56,189,248,.06)', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  📎 {form.media_filename ? 'Changer' : 'Choisir'} fichier
                </button>
                <input ref={fileRef} type="file" accept="image/*,video/*" onChange={handleFileChange} style={{ display: 'none' }} />

                {form.media_filename ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8', background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.2)', padding: '5px 10px', borderRadius: 8 }}>
                    {form.media_type === 'video' ? '🎬' : '🖼'} {form.media_filename}
                    <button type="button" onClick={clearMedia}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: 0 }}>✕</button>
                  </span>
                ) : hasExistingMedia ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b', background: 'rgba(100,116,139,.06)', border: '1px solid rgba(100,116,139,.2)', padding: '5px 10px', borderRadius: 8 }}>
                    {modal.ann.media_type === 'video' ? '🎬' : '🖼'} Fichier existant conservé
                    <button type="button" onClick={clearMedia}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: 0 }}>✕</button>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#334155' }}>Aucun fichier — texte seul</span>
                )}
              </div>
            </div>

            {/* Planification */}
            <div>
              <label style={S.label}>Planification des envois *</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                {[
                  { id: 'interval', icon: '⏱', title: 'Intervalle régulier', desc: 'Toutes les X heures (aux heures rondes)' },
                  { id: 'fixed',    icon: '🕐', title: 'Heures fixes',        desc: 'Ex : 08h00, 12h00, 20h00 chaque jour' },
                ].map(opt => {
                  const active = form.schedule_type === opt.id;
                  return (
                    <label key={opt.id} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 14px', borderRadius: 12, border: `2px solid rgba(${active ? '56,189,248,.6' : '100,116,139,.2'})`, background: active ? 'rgba(56,189,248,.06)' : 'transparent', transition: 'all .15s' }}>
                      <input type="radio" checked={active} onChange={() => patchForm({ schedule_type: opt.id })} style={{ marginTop: 3, accentColor: '#38bdf8' }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#38bdf8' : '#94a3b8' }}>{opt.icon} {opt.title}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {form.schedule_type === 'interval' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>Envoyer toutes les</span>
                  <input type="number" min={1} max={24} value={form.interval_hours}
                    onChange={e => patchForm({ interval_hours: Math.max(1, Math.min(24, parseInt(e.target.value) || 1)) })}
                    style={{ ...S.inp, width: 80, textAlign: 'center' }} />
                  <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
                    heure(s)
                    <span style={{ fontSize: 10, color: '#475569', marginLeft: 6 }}>
                      (0h, {form.interval_hours}h, {form.interval_hours * 2}h…)
                    </span>
                  </span>
                </div>
              )}

              {form.schedule_type === 'fixed' && (
                <div>
                  <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>Cliquez sur les heures d'envoi (pile à l'heure) :</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {HOURS.map(h => {
                      const sel = form.fixed_hours.includes(h);
                      return (
                        <button key={h} type="button" onClick={() => toggleHour(h)}
                          style={{ width: 52, height: 36, borderRadius: 8, border: `2px solid rgba(${sel ? '56,189,248,.7' : '100,116,139,.2'})`, background: sel ? 'rgba(56,189,248,.18)' : 'rgba(15,23,42,.5)', color: sel ? '#38bdf8' : '#64748b', cursor: 'pointer', fontSize: 11, fontWeight: sel ? 800 : 500, transition: 'all .12s' }}>
                          {String(h).padStart(2,'0')}h
                        </button>
                      );
                    })}
                  </div>
                  {form.fixed_hours.length > 0 && (
                    <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 10, fontWeight: 600 }}>
                      Sélectionnées : {form.fixed_hours.map(h => `${String(h).padStart(2,'0')}h00`).join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Statut */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.enabled} onChange={e => patchForm({ enabled: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: '#38bdf8' }} />
              <span style={{ fontSize: 13, color: form.enabled ? '#22c55e' : '#64748b', fontWeight: 600 }}>
                {form.enabled ? '🟢 Annonce active — sera envoyée automatiquement' : '⏸ Annonce inactive'}
              </span>
            </label>

            {/* Erreur */}
            {errMsg && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
                ⚠️ {errMsg}
              </div>
            )}

            {/* Boutons */}
            {saveSuccess ? (
              <div style={{ textAlign: 'center', padding: '16px', borderRadius: 12, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', fontSize: 15, fontWeight: 800, letterSpacing: 0.2 }}>
                ✅ Enregistrée et envoyée sur Telegram !
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={handleSave} disabled={saving} style={{ ...S.btnPrim, flex: 1, opacity: saving ? .7 : 1 }}>
                  {saving ? '⏳ Envoi en cours…' : modal === 'new' ? '✅ Créer et envoyer' : '✅ Sauvegarder et envoyer'}
                </button>
                <button onClick={() => setModal(null)} style={S.btnGhost}>Annuler</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Rendu principal ───────────────────────────────────────────────────────
  return (
    <div>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>📢 Annonces Telegram</h2>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: '#475569' }}>
            Envoyez automatiquement des messages (texte, photo, vidéo) à vos canaux selon un planning.
          </p>
        </div>
        <button onClick={openNew} style={S.btnPrim}>+ Nouvelle annonce</button>
      </div>

      {/* Statistiques rapides */}
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          {[
            { label: 'Total', value: list.length, color: '#38bdf8' },
            { label: 'Actives', value: list.filter(a => a.enabled).length, color: '#22c55e' },
            { label: 'Inactives', value: list.filter(a => !a.enabled).length, color: '#64748b' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '8px 18px', borderRadius: 10, background: 'rgba(15,23,42,.7)', border: `1px solid rgba(${stat.color === '#38bdf8' ? '56,189,248' : stat.color === '#22c55e' ? '34,197,94' : '100,116,139'},.2)` }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: stat.color }}>{stat.value}</span>
              <span style={{ fontSize: 11, color: '#475569', marginLeft: 7 }}>{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Contenu */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 50, color: '#475569' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Chargement…</div>
        </div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 70, color: '#334155', border: '2px dashed rgba(56,189,248,.15)', borderRadius: 16 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>📢</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Aucune annonce configurée</div>
          <div style={{ fontSize: 12, color: '#334155', marginBottom: 18 }}>Créez votre première annonce planifiée pour Telegram.</div>
          <button onClick={openNew} style={S.btnPrim}>+ Créer une annonce</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {list.map(renderCard)}
        </div>
      )}

      {renderModal()}
    </div>
  );
}
