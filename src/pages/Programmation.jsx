import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';

// ── Constantes visuelles ──────────────────────────────────────────────────────

const LANG_COLORS = {
  '.js': '#f59e0b', '.jsx': '#38bdf8', '.ts': '#3b82f6', '.tsx': '#06b6d4',
  '.json': '#a3e635', '.css': '#f472b6', '.html': '#fb923c', '.md': '#94a3b8',
  '.txt': '#94a3b8', '.sh': '#4ade80',
};

function fileIcon(ext) {
  const map = { '.js':'📜','.jsx':'⚛️','.ts':'📘','.tsx':'⚛️','.json':'📋','.css':'🎨','.html':'🌐','.md':'📝','.sh':'⚡','.txt':'📄' };
  return map[ext] || '📄';
}

// ── Arbre de fichiers ─────────────────────────────────────────────────────────

function FileTree({ nodes, onSelect, selected, depth = 0 }) {
  const [open, setOpen] = useState({});
  return (
    <div>
      {nodes.map(node => (
        <div key={node.path}>
          {node.type === 'dir' ? (
            <>
              <div onClick={() => setOpen(o => ({ ...o, [node.path]: !o[node.path] }))}
                style={{ display:'flex', alignItems:'center', gap:8, padding:`9px 10px 9px ${14+depth*16}px`, cursor:'pointer', borderRadius:8, userSelect:'none', color:'#94a3b8', fontSize:14, fontWeight:700, transition:'background 0.15s' }}
                onMouseOver={e=>e.currentTarget.style.background='rgba(255,255,255,0.07)'}
                onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                <span style={{fontSize:12}}>{open[node.path]?'▼':'▶'}</span>
                <span style={{fontSize:16}}>📁</span><span>{node.name}</span>
              </div>
              {open[node.path] && node.children?.length > 0 && (
                <FileTree nodes={node.children} onSelect={onSelect} selected={selected} depth={depth+1} />
              )}
            </>
          ) : (
            <div onClick={() => onSelect(node)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:`9px 10px 9px ${20+depth*16}px`, cursor:'pointer', borderRadius:8, fontSize:14,
                background: selected===node.path?'rgba(59,130,246,0.2)':'transparent',
                color: selected===node.path?'#93c5fd':'#e2e8f0',
                borderLeft: selected===node.path?'3px solid #3b82f6':'3px solid transparent', transition:'all 0.15s' }}
              onMouseOver={e=>{ if(selected!==node.path) e.currentTarget.style.background='rgba(255,255,255,0.06)'; }}
              onMouseOut={e=>{ if(selected!==node.path) e.currentTarget.style.background='transparent'; }}>
              <span style={{fontSize:16}}>{fileIcon(node.ext)}</span>
              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}>{node.name}</span>
              <span style={{fontSize:11,color:LANG_COLORS[node.ext]||'#475569',fontWeight:800}}>{node.ext}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Panneau Configuration API IA ──────────────────────────────────────────────

function AiConfigPanel({ onClose }) {
  const { autoT } = useLanguage();
  const [apis, setApis]             = useState([]);
  const [savedKeys, setSavedKeys]   = useState({});
  const [selectedApi, setSelectedApi] = useState(null);
  const [key, setKey]               = useState('');
  const [verifying, setVerifying]   = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState('');
  const [deleting, setDeleting]     = useState(null);

  const [activeApi, setActiveApi] = useState(null);

  useEffect(() => {
    fetch('/api/prog/ai-apis', { credentials:'include' }).then(r=>r.json()).then(setApis).catch(()=>{});
    loadKeys();
    loadActive();
  }, []);

  const loadKeys = () => {
    fetch('/api/prog/ai-keys', { credentials:'include' }).then(r=>r.json()).then(setSavedKeys).catch(()=>{});
  };

  const loadActive = () => {
    fetch('/api/prog/ai-active', { credentials:'include' }).then(r=>r.json()).then(setActiveApi).catch(()=>{});
  };

  const handleSelectApi = (api) => {
    setSelectedApi(api);
    setKey('');
    setVerifyResult(null);
    setSaveMsg('');
    // Si Ollama (pas de clé), lancer la vérification directement
    if (api.noKeyRequired) {
      setVerifying(true);
      fetch('/api/prog/ai-verify', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ apiId: api.id, key: '' }),
      }).then(r=>r.json()).then(d=>{ setVerifyResult(d); setVerifying(false); }).catch(()=>setVerifying(false));
    }
  };

  const handleVerify = async () => {
    if (!selectedApi) return;
    if (!selectedApi.noKeyRequired && !key.trim()) return;
    setVerifying(true); setVerifyResult(null);
    try {
      const r = await fetch('/api/prog/ai-verify', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ apiId: selectedApi.id, key: key.trim() }),
      });
      const d = await r.json();
      setVerifyResult(d);
    } catch(e) { setVerifyResult({ ok:false, error:e.message }); }
    finally { setVerifying(false); }
  };

  const handleSave = async () => {
    if (!selectedApi || !verifyResult?.ok) return;
    if (!selectedApi.noKeyRequired && !key.trim()) return;
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch('/api/prog/ai-save', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ apiId: selectedApi.id, key: key.trim() }),
      });
      const d = await r.json();
      if (r.ok) { setSaveMsg('✅ Clé sauvegardée'); loadKeys(); }
      else setSaveMsg('❌ ' + d.error);
    } catch(e) { setSaveMsg('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (apiId) => {
    setDeleting(apiId);
    try {
      await fetch(`/api/prog/ai-keys/${apiId}`, { method:'DELETE', credentials:'include' });
      loadKeys();
      if (selectedApi?.id === apiId) setVerifyResult(null);
    } finally { setDeleting(null); }
  };

  const handleKeyPaste = (e) => {
    const pasted = e.clipboardData?.getData('text')?.trim();
    if (pasted && pasted.length > 10) {
      setKey(pasted);
      setTimeout(() => {
        setVerifyResult(null);
        if (selectedApi) {
          setVerifying(true);
          fetch('/api/prog/ai-verify', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ apiId: selectedApi.id, key: pasted }),
          }).then(r=>r.json()).then(d=>{ setVerifyResult(d); setVerifying(false); }).catch(()=>setVerifying(false));
        }
      }, 100);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16, backdropFilter:'blur(4px)' }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ width:'100%', maxWidth:900, maxHeight:'90vh', background:'#0f172a', border:'1px solid rgba(99,102,241,0.3)', borderRadius:20, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 40px 120px rgba(0,0,0,0.7)', fontFamily:'sans-serif' }}>

        {/* En-tête */}
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'20px 24px', background:'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ width:44, height:44, borderRadius:12, background:'linear-gradient(135deg,#6366f1,#a855f7)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:900, color:'#f8fafc' }}>{autoT('Configuration API IA')}</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
              {activeApi ? (
                <span>{autoT('API active :')} <span style={{ color: activeApi.fallback ? '#10b981' : '#a5b4fc', fontWeight:700 }}>
                  {activeApi.api?.icon} {activeApi.apiName}
                  {activeApi.fallback && <span style={{ color:'#10b981' }}> — {autoT('fallback automatique')}</span>}
                </span></span>
              ) : autoT('Ajoutez et vérifiez vos clés d\'API pour les services IA gratuits')}
            </div>
          </div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)', color:'#94a3b8', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
        </div>

        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* Colonne gauche — liste des APIs */}
          <div style={{ width:260, borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>
            <div style={{ padding:'12px 16px 8px', fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1.2 }}>{autoT('Services disponibles')}</div>
            <div style={{ flex:1, overflowY:'auto', padding:'0 8px 12px' }}>
              {apis.map(api => {
                const saved = savedKeys[api.id];
                const isActive = selectedApi?.id === api.id;
                const isFallbackActive = activeApi?.activeId === api.id && activeApi?.fallback;
                return (
                  <div key={api.id} onClick={() => handleSelectApi(api)}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, cursor:'pointer', marginBottom:4,
                      background: isActive ? `${api.color}18` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? `${api.color}55` : 'rgba(255,255,255,0.05)'}`,
                      transition:'all 0.15s' }}
                    onMouseOver={e=>{ if(!isActive){ e.currentTarget.style.background='rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.1)'; }}}
                    onMouseOut={e=>{ if(!isActive){ e.currentTarget.style.background='rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.05)'; }}}>
                    <div style={{ width:34, height:34, borderRadius:8, background:api.gradient, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>{api.icon}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#f8fafc' }}>{api.name}</div>
                      <div style={{ fontSize:10, fontWeight:600, color: isFallbackActive ? '#10b981' : saved ? '#4ade80' : '#475569' }}>
                        {isFallbackActive ? `🔄 ${autoT('Actif — fallback')}` : saved ? `✓ ${autoT('Clé enregistrée')}` : api.noKeyRequired ? `🦙 ${autoT('Aucune clé requise')}` : api.badge}
                      </div>
                    </div>
                    {isFallbackActive && <div style={{ width:8, height:8, borderRadius:'50%', background:'#10b981', flexShrink:0 }} />}
                    {saved && !isFallbackActive && <div style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e', flexShrink:0 }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Colonne droite — détails + config */}
          <div style={{ flex:1, overflowY:'auto', padding:24, display:'flex', flexDirection:'column', gap:20 }}>
            {!selectedApi ? (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, color:'#1e293b', paddingTop:60 }}>
                <div style={{ fontSize:56 }}>🤖</div>
                <div style={{ fontSize:16, fontWeight:700, color:'#334155' }}>{autoT('Sélectionnez un service')}</div>
                <div style={{ fontSize:13, color:'#475569', textAlign:'center', maxWidth:260 }}>{autoT('Cliquez sur un service dans la liste de gauche pour configurer votre clé API')}</div>
              </div>
            ) : (
              <>
                {/* En-tête du service */}
                <div style={{ display:'flex', alignItems:'center', gap:16, padding:'20px 22px', borderRadius:16, background:`linear-gradient(135deg, ${selectedApi.color}18, ${selectedApi.color}08)`, border:`1px solid ${selectedApi.color}30` }}>
                  <div style={{ width:56, height:56, borderRadius:14, background:selectedApi.gradient, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, flexShrink:0 }}>{selectedApi.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                      <span style={{ fontSize:20, fontWeight:900, color:'#f8fafc' }}>{selectedApi.name}</span>
                      <span style={{ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:20, background:`${selectedApi.color}25`, color:selectedApi.color, border:`1px solid ${selectedApi.color}40` }}>{selectedApi.badge}</span>
                    </div>
                    <div style={{ fontSize:13, color:'#94a3b8', lineHeight:1.5 }}>{selectedApi.description}</div>
                  </div>
                  <a href={selectedApi.site} target="_blank" rel="noopener noreferrer"
                    style={{ padding:'8px 14px', borderRadius:8, border:`1px solid ${selectedApi.color}40`, background:`${selectedApi.color}12`, color:selectedApi.color, textDecoration:'none', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>
                    🔗 {autoT('Obtenir une clé')}
                  </a>
                </div>

                {/* Infos modèles + rate limit */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div style={{ padding:'14px 16px', borderRadius:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>{autoT('Modèles gratuits')}</div>
                    {selectedApi.freeModels.slice(0,4).map(m => (
                      <div key={m} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                        <div style={{ width:5, height:5, borderRadius:'50%', background:selectedApi.color, flexShrink:0 }} />
                        <span style={{ fontSize:11, color:'#94a3b8', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding:'14px 16px', borderRadius:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>{autoT('Limites du tier gratuit')}</div>
                    <div style={{ fontSize:12, color:'#94a3b8', lineHeight:1.7 }}>{selectedApi.rateLimit}</div>
                    <div style={{ marginTop:8, fontSize:11, color:'#475569' }}>{autoT('Format clé :')} <span style={{ fontFamily:'monospace', color:'#64748b' }}>{selectedApi.keyFormat}</span></div>
                  </div>
                </div>

                {/* Zone saisie clé — masquée pour Ollama */}
                {selectedApi.noKeyRequired ? (
                  <div style={{ padding:'16px 18px', borderRadius:12, background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.25)', display:'flex', alignItems:'center', gap:14 }}>
                    <span style={{ fontSize:26 }}>🦙</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#34d399' }}>{autoT('Aucune clé API requise')}</div>
                      <div style={{ fontSize:12, color:'#64748b', marginTop:3, lineHeight:1.5 }}>{autoT('Ollama tourne directement sur ce serveur. La vérification se lance automatiquement à la sélection.')}</div>
                    </div>
                    <button onClick={handleVerify} disabled={verifying}
                      style={{ padding:'10px 18px', borderRadius:9, border:'none', cursor:verifying?'not-allowed':'pointer', fontWeight:700, fontSize:13, background:verifying?'rgba(16,185,129,0.2)':'linear-gradient(135deg,#059669,#10b981)', color:verifying?'#34d399':'#fff', whiteSpace:'nowrap' }}>
                      {verifying ? '⏳…' : `🔄 ${autoT('Re-tester')}`}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>{autoT('Clé API')}</div>
                    <div style={{ display:'flex', gap:10 }}>
                      <input
                        type="password" value={key}
                        onChange={e => { setKey(e.target.value); setVerifyResult(null); }}
                        onPaste={handleKeyPaste}
                        placeholder={`Collez votre clé ici (${selectedApi.keyFormat})`}
                        style={{ flex:1, padding:'13px 16px', background:'#1e293b', border:`1.5px solid ${verifyResult?.ok ? '#22c55e' : verifyResult?.ok===false ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, borderRadius:10, color:'#f8fafc', fontSize:13, fontFamily:'monospace', outline:'none', transition:'border-color 0.2s' }}
                      />
                      <button onClick={handleVerify} disabled={verifying || !key.trim()}
                        style={{ padding:'13px 20px', borderRadius:10, border:'none', cursor:(verifying||!key.trim())?'not-allowed':'pointer', fontWeight:700, fontSize:13, background:(verifying||!key.trim())?'rgba(99,102,241,0.2)':'linear-gradient(135deg,#4f46e5,#7c3aed)', color:(verifying||!key.trim())?'#6366f1':'#fff', whiteSpace:'nowrap', transition:'all 0.2s' }}>
                        {verifying ? `⏳ ${autoT('Vérification…')}` : `🔍 ${autoT('Vérifier')}`}
                      </button>
                    </div>
                    <div style={{ marginTop:6, fontSize:11, color:'#334155' }}>💡 {autoT('La vérification est automatique au collage de la clé')}</div>
                  </div>
                )}

                {/* Résultat de vérification */}
                {verifyResult && (
                  <div style={{ borderRadius:16, overflow:'hidden', border:`1px solid ${verifyResult.ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                    {/* Bandeau statut */}
                    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px', background:verifyResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' }}>
                      <span style={{ fontSize:24 }}>{verifyResult.ok ? '✅' : '❌'}</span>
                      <div>
                        <div style={{ fontSize:15, fontWeight:800, color: verifyResult.ok ? '#4ade80' : '#f87171' }}>
                          {verifyResult.ok ? `${autoT('Clé valide')} — ${verifyResult.apiName}` : `${autoT('Clé invalide')} — ${verifyResult.apiName}`}
                        </div>
                        {!verifyResult.ok && <div style={{ fontSize:12, color:'#f87171', marginTop:2 }}>{verifyResult.error}</div>}
                      </div>
                      {verifyResult.ok && (
                        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
                          <button onClick={handleSave} disabled={saving}
                            style={{ padding:'8px 18px', borderRadius:8, border:'none', cursor:saving?'not-allowed':'pointer', fontWeight:700, fontSize:12, background:'linear-gradient(135deg,#16a34a,#22c55e)', color:'#fff' }}>
                            {saving ? '…' : `💾 ${autoT('Enregistrer la clé')}`}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Détails si OK */}
                    {verifyResult.ok && (
                      <div style={{ padding:'16px 20px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:14 }}>
                        {/* Modèles disponibles */}
                        {verifyResult.models?.length > 0 && (
                          <div>
                            <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>
                              {autoT('Modèles accessibles')} ({verifyResult.models.length}{verifyResult.info?.totalModels ? ` / ${verifyResult.info.totalModels}` : ''})
                            </div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                              {verifyResult.models.slice(0,10).map(m => (
                                <span key={m} style={{ fontSize:11, padding:'3px 10px', borderRadius:20, background:`${selectedApi.color}18`, border:`1px solid ${selectedApi.color}30`, color:selectedApi.color, fontFamily:'monospace' }}>{m}</span>
                              ))}
                              {verifyResult.models.length > 10 && <span style={{ fontSize:11, color:'#475569', padding:'3px 10px' }}>+{verifyResult.models.length-10} {autoT('autres')}</span>}
                            </div>
                          </div>
                        )}
                        {/* Infos compte */}
                        {verifyResult.info && Object.keys(verifyResult.info).length > 0 && (
                          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
                            {Object.entries(verifyResult.info).map(([k,v]) => (
                              <div key={k} style={{ padding:'8px 14px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)' }}>
                                <div style={{ fontSize:9, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>{k}</div>
                                <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{String(v)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {saveMsg && <div style={{ fontSize:12, color: saveMsg.startsWith('✅') ? '#4ade80' : '#f87171', fontWeight:700 }}>{saveMsg}</div>}
                      </div>
                    )}
                    {/* Instructions installation Ollama si non disponible */}
                    {!verifyResult.ok && verifyResult.installSteps && (
                      <div style={{ padding:'16px 20px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:12 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#94a3b8' }}>{autoT("Pour installer Ollama sur ce serveur, exécutez ces commandes dans l'éditeur :")}</div>
                        {verifyResult.installSteps.map((cmd, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <span style={{ width:22, height:22, borderRadius:'50%', background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'#10b981', flexShrink:0 }}>{i+1}</span>
                            <code style={{ flex:1, padding:'8px 12px', background:'#0a0f1e', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', fontSize:12, color:'#a5b4fc', fontFamily:'monospace' }}>{cmd}</code>
                          </div>
                        ))}
                        <div style={{ fontSize:11, color:'#475569' }}>💡 {autoT("Collez ces commandes dans l'onglet exécution de l'éditeur, ou via un terminal sur votre serveur.")}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Clé déjà sauvegardée — masquée pour Ollama */}
                {!selectedApi.noKeyRequired && savedKeys[selectedApi?.id] && (
                  <div style={{ padding:'14px 18px', borderRadius:12, background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.2)', display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontSize:18 }}>🔐</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#4ade80' }}>{autoT('Clé enregistrée')}</div>
                      <div style={{ fontSize:11, color:'#475569', fontFamily:'monospace', marginTop:2 }}>{savedKeys[selectedApi.id].masked}</div>
                      <div style={{ fontSize:10, color:'#334155', marginTop:2 }}>{autoT('Sauvegardée le')} {new Date(savedKeys[selectedApi.id].savedAt).toLocaleString('fr-FR')}</div>
                    </div>
                    <button onClick={() => handleDelete(selectedApi.id)} disabled={deleting===selectedApi.id}
                      style={{ padding:'6px 12px', borderRadius:7, border:'1px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.08)', color:'#f87171', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                      {deleting===selectedApi.id ? '…' : `🗑 ${autoT('Supprimer')}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Programmation() {
  const { autoT } = useLanguage();
  const [auth, setAuth]           = useState(false);
  const [checking, setChecking]   = useState(true);
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loginErr, setLoginErr]   = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [files, setFiles]         = useState([]);
  const [selPath, setSelPath]      = useState(null);
  const [code, setCode]           = useState('');
  const [origCode, setOrigCode]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [result, setResult]       = useState(null);
  const [running, setRunning]     = useState(false);
  const [sidebarW, setSidebarW]   = useState(240);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showAiChat, setShowAiChat]   = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput]     = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [cmdInput, setCmdInput]   = useState('');
  const [activeApiInfo, setActiveApiInfo] = useState(null);

  // ── Mode Projet / Hors Projet ─────────────────────────────────────
  const [mode, setMode]           = useState('projet');
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // ── Mode Hors Projet ──────────────────────────────────────────────
  const [botList, setBotList]     = useState([]);
  const [currentBot, setCurrentBot] = useState(null);
  const [botStep, setBotStep]     = useState('list');
  const [botName, setBotName]     = useState('');
  const [botDesc, setBotDesc]     = useState('');
  const [botCode, setBotCode]     = useState('// Votre bot ici…\n');
  const [botLang, setBotLang]     = useState('js');
  const [botGenerating, setBotGenerating] = useState(false);
  const [botSaving, setBotSaving] = useState(false);
  const [botSaveMsg, setBotSaveMsg] = useState('');
  const [botResult, setBotResult] = useState(null);
  const [botRunning, setBotRunning] = useState(false);

  const textareaRef = useRef(null);
  const botTextareaRef = useRef(null);
  const dragRef     = useRef(null);
  const cmdRef      = useRef(null);
  const chatEndRef  = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    fetch('/api/prog/check', { credentials:'include' })
      .then(r=>r.json())
      .then(d=>{ setAuth(d.auth); setChecking(false); })
      .catch(()=>setChecking(false));
  }, []);

  useEffect(() => {
    if (!auth) return;
    fetch('/api/prog/files', { credentials:'include' })
      .then(r=>r.json())
      .then(d=>{ if(Array.isArray(d)) setFiles(d); })
      .catch(()=>{});
    fetch('/api/prog/ai-active', { credentials:'include' })
      .then(r=>r.json())
      .then(setActiveApiInfo)
      .catch(()=>{});
  }, [auth]);

  const loadBots = useCallback(() => {
    fetch('/api/prog/bots', { credentials:'include' })
      .then(r=>r.json())
      .then(d=>{ if(Array.isArray(d)) setBotList(d); })
      .catch(()=>{});
  }, []);

  useEffect(() => {
    if (auth && mode === 'horsprojet') loadBots();
  }, [auth, mode, loadBots]);

  const loadFile = useCallback(async (node) => {
    setSelPath(node.path); setResult(null); setSaveMsg('');
    setLoading(true);
    try {
      const r = await fetch(`/api/prog/file?path=${encodeURIComponent(node.path)}`, { credentials:'include' });
      const d = await r.json();
      if (r.ok) { setCode(d.content); setOrigCode(d.content); }
      else setCode(`// Erreur: ${d.error}`);
    } catch(e) { setCode(`// Erreur réseau: ${e.message}`); }
    finally { setLoading(false); }
  }, []);

  const saveFile = () => {
    if (!selPath) return;
    setShowSaveConfirm(true);
  };

  const confirmSave = async () => {
    setShowSaveConfirm(false);
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch('/api/prog/file', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path: selPath, content: code }),
      });
      const d = await r.json();
      if (r.ok) { setOrigCode(code); setSaveMsg('✅ Installé dans le projet'); }
      else setSaveMsg(`❌ ${d.error}`);
    } catch(e) { setSaveMsg(`❌ ${e.message}`); }
    finally { setSaving(false); setTimeout(()=>setSaveMsg(''), 4000); }
  };

  const runCode = async () => {
    setRunning(true); setResult(null);
    try {
      const r = await fetch('/api/prog/exec', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ code }),
      });
      setResult(await r.json());
    } catch(e) { setResult({ error: e.message, exitCode:-1 }); }
    finally { setRunning(false); }
  };

  const generateBotCode = async () => {
    if (!botName.trim() || !botDesc.trim()) return;
    setBotGenerating(true); setBotCode('');
    const prompt = `Crée un bot Node.js complet nommé "${botName.trim()}" avec la description suivante:\n\n${botDesc.trim()}\n\nGénère uniquement le code, pas d'explication, en JavaScript (Node.js). Le code doit être autonome, commenté en français, et prêt à être exécuté.`;
    try {
      const r = await fetch('/api/prog/ai-chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, history: [] }),
      });
      const d = await r.json();
      if (d.ok) {
        const match = d.reply.match(/```(?:js|javascript|node)?\n?([\s\S]*?)```/);
        setBotCode(match ? match[1].trim() : d.reply);
        setBotLang('js');
      } else {
        setBotCode(`// Erreur de génération: ${d.error}\n// Vous pouvez écrire votre code ici manuellement.`);
      }
    } catch(e) {
      setBotCode(`// Erreur réseau: ${e.message}`);
    } finally {
      setBotGenerating(false);
      setBotStep('edit');
    }
  };

  const openBot = (bot) => {
    setCurrentBot(bot);
    setBotName(bot.name);
    setBotDesc(bot.description);
    setBotCode(bot.code);
    setBotLang(bot.lang || 'js');
    setBotResult(null);
    setBotStep('edit');
    setChatHistory([]);
  };

  const saveBot = async () => {
    setBotSaving(true); setBotSaveMsg('');
    try {
      const r = await fetch('/api/prog/bots', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentBot?.id, name: botName, description: botDesc, code: botCode, lang: botLang }),
      });
      const d = await r.json();
      if (d.ok) {
        setCurrentBot(d.bot);
        setBotSaveMsg('✅ Bot sauvegardé');
        loadBots();
      } else setBotSaveMsg(`❌ ${d.error}`);
    } catch(e) { setBotSaveMsg(`❌ ${e.message}`); }
    finally { setBotSaving(false); setTimeout(()=>setBotSaveMsg(''), 3000); }
  };

  const deleteBot = async (botId, e) => {
    e.stopPropagation();
    if (!confirm('Supprimer ce bot ?')) return;
    await fetch(`/api/prog/bots/${botId}`, { method:'DELETE', credentials:'include' });
    loadBots();
  };

  const runBotCode = async () => {
    setBotRunning(true); setBotResult(null);
    try {
      const r = await fetch('/api/prog/exec', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ code: botCode }),
      });
      setBotResult(await r.json());
    } catch(e) { setBotResult({ error: e.message, exitCode:-1 }); }
    finally { setBotRunning(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true); setLoginErr('');
    try {
      const r = await fetch('/api/prog/auth', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (r.ok) setAuth(true);
      else setLoginErr(d.error || 'Identifiants incorrects');
    } catch(e) { setLoginErr(e.message); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = async () => {
    await fetch('/api/prog/logout', { method:'POST', credentials:'include' });
    setAuth(false); setFiles([]); setSelPath(null); setCode('');
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveFile(); }
    if (e.key==='Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      const s = ta.selectionStart, end = ta.selectionEnd;
      const val = code.substring(0,s)+'  '+code.substring(end);
      setCode(val);
      requestAnimationFrame(()=>{ ta.selectionStart=ta.selectionEnd=s+2; });
    }
  };

  const handleCmdKey = (e) => {
    if (e.key === 'Enter') {
      const cmd = cmdInput.trim().toLowerCase();
      if (cmd === 'configuration api ia' || cmd === 'config api ia' || cmd === 'api ia') {
        setShowAiPanel(true);
        setCmdInput('');
      }
    }
  };

  const startDrag = (e) => {
    dragRef.current = e.clientX;
    const onMove = (ev) => {
      const diff = ev.clientX - dragRef.current;
      dragRef.current = ev.clientX;
      setSidebarW(w => Math.max(160, Math.min(500, w+diff)));
    };
    const onUp = () => { window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (checking) return (
    <div style={{ minHeight:'100vh', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:32, height:32, border:'3px solid rgba(59,130,246,0.3)', borderTopColor:'#3b82f6', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!auth) return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f172a 0%,#0a0f1e 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:'100%', maxWidth:420, background:'rgba(15,23,42,0.95)', border:'1px solid rgba(59,130,246,0.25)', borderRadius:20, padding:'40px 36px', boxShadow:'0 24px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>💻</div>
          <h1 style={{ fontSize:22, fontWeight:900, color:'#f8fafc', margin:'0 0 6px', fontFamily:'sans-serif' }}>{autoT('Espace Programmation')}</h1>
          <p style={{ fontSize:13, color:'#64748b', margin:0, fontFamily:'sans-serif' }}>{autoT('Accès restreint — identifiants requis')}</p>
        </div>
        <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:16, fontFamily:'sans-serif' }}>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Email</label>
            <input type="text" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="admin"
              style={{ width:'100%', padding:'13px 16px', background:'#1e293b', border:'1.5px solid rgba(59,130,246,0.25)', borderRadius:10, color:'#f8fafc', fontSize:14, outline:'none', boxSizing:'border-box' }}
              onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='rgba(59,130,246,0.25)'} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>{autoT('Mot de passe')}</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••"
              style={{ width:'100%', padding:'13px 16px', background:'#1e293b', border:'1.5px solid rgba(59,130,246,0.25)', borderRadius:10, color:'#f8fafc', fontSize:14, outline:'none', boxSizing:'border-box' }}
              onFocus={e=>e.target.style.borderColor='#3b82f6'} onBlur={e=>e.target.style.borderColor='rgba(59,130,246,0.25)'} />
          </div>
          {loginErr && <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171', fontSize:13, textAlign:'center' }}>{loginErr}</div>}
          <button type="submit" disabled={loginLoading}
            style={{ padding:'14px', borderRadius:10, border:'none', cursor:loginLoading?'not-allowed':'pointer', fontWeight:800, fontSize:14, background:loginLoading?'rgba(59,130,246,0.3)':'linear-gradient(135deg,#1d4ed8,#3b82f6)', color:'#fff', marginTop:4 }}>
            {loginLoading ? autoT('Connexion…') : `🔓 ${autoT('Accéder')}`}
          </button>
        </form>
        <div style={{ textAlign:'center', marginTop:24, fontFamily:'sans-serif' }}>
          <a href="/" style={{ fontSize:12, color:'#475569', textDecoration:'none' }}>← {autoT("Retour à l'accueil")}</a>
        </div>
      </div>
    </div>
  );

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setChatLoading(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const r = await fetch('/api/prog/ai-chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history: chatHistory }),
      });
      const d = await r.json();
      if (d.ok) {
        setChatHistory(h => [...h, { role: 'assistant', content: d.reply, apiName: d.apiName }]);
      } else {
        setChatHistory(h => [...h, { role: 'assistant', content: d.error, isError: true, noKey: d.noKey }]);
      }
    } catch (e) {
      setChatHistory(h => [...h, { role: 'assistant', content: `❌ Erreur réseau : ${e.message}`, isError: true }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); chatInputRef.current?.focus(); }, 80);
    }
  };

  const insertCodeFromChat = (text) => {
    const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    const extracted = match ? match[1].trim() : text.trim();
    setCode(extracted);
  };

  const renderChatMessage = (msg, idx) => {
    const isUser = msg.role === 'user';
    const parts = [];
    let rest = msg.content;
    const codeRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIdx = 0, m;
    while ((m = codeRegex.exec(rest)) !== null) {
      if (m.index > lastIdx) parts.push({ type: 'text', content: rest.slice(lastIdx, m.index) });
      parts.push({ type: 'code', lang: m[1] || 'text', content: m[2].trim() });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < rest.length) parts.push({ type: 'text', content: rest.slice(lastIdx) });
    if (parts.length === 0) parts.push({ type: 'text', content: rest });

    return (
      <div key={idx} style={{ display:'flex', flexDirection:'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap:4, marginBottom:12 }}>
        {!isUser && msg.apiName && (
          <span style={{ fontSize:9, color:'#475569', fontFamily:'sans-serif', marginLeft:4 }}>{msg.apiName}</span>
        )}
        <div style={{ maxWidth:'90%', display:'flex', flexDirection:'column', gap:6 }}>
          {parts.map((p, pi) => p.type === 'code' ? (
            <div key={pi} style={{ position:'relative' }}>
              <div style={{ background:'#0d1117', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, overflow:'hidden' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 10px', background:'rgba(255,255,255,0.04)', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ fontSize:10, color:'#64748b', fontFamily:'sans-serif' }}>{p.lang || 'code'}</span>
                  {selPath && (
                    <button onClick={() => insertCodeFromChat(`\`\`\`${p.lang}\n${p.content}\n\`\`\``)}
                      style={{ fontSize:10, padding:'2px 8px', borderRadius:5, border:'none', background:'rgba(99,102,241,0.25)', color:'#a5b4fc', cursor:'pointer', fontFamily:'sans-serif' }}>
                      ⬆ Insérer
                    </button>
                  )}
                </div>
                <pre style={{ margin:0, padding:'10px 12px', fontSize:12, overflowX:'auto', color:'#e2e8f0', lineHeight:1.6 }}><code>{p.content}</code></pre>
              </div>
            </div>
          ) : (
            <div key={pi} style={{ padding:'9px 13px', borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: isUser ? 'rgba(99,102,241,0.3)' : msg.isError ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: msg.isError ? '#fca5a5' : '#e2e8f0', fontSize:13, lineHeight:1.6, fontFamily:'sans-serif', whiteSpace:'pre-wrap' }}>
              {p.content}
              {msg.noKey && pi === parts.length - 1 && (
                <button onClick={()=>setShowAiPanel(true)}
                  style={{ display:'block', marginTop:10, padding:'7px 14px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#4f46e5,#6366f1)', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'sans-serif' }}>
                  🤖 {autoT('Configurer une clé API gratuite')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const isDirty = code !== origCode;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#0f172a', color:'#f8fafc', fontFamily:'monospace', overflow:'hidden' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
        .prog-textarea:focus{outline:none}
      `}</style>

      {/* Barre haute */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'0 18px', height:62, background:'#1e293b', borderBottom:'2px solid rgba(255,255,255,0.08)', flexShrink:0 }}>
        <span style={{ fontSize:24 }}>💻</span>
        <span style={{ fontWeight:900, fontSize:16, color:'#f8fafc', whiteSpace:'nowrap' }}>{autoT('Espace Programmation')}</span>

        {/* Sélecteur de mode */}
        <div style={{ display:'flex', gap:3, background:'rgba(0,0,0,0.4)', borderRadius:10, padding:3, flexShrink:0 }}>
          {[{id:'projet', label:`📁 ${autoT('Projet')}`}, {id:'horsprojet', label:`🚀 ${autoT('Hors Projet')}`}].map(m => (
            <button key={m.id} onClick={()=>setMode(m.id)}
              style={{ padding:'8px 18px', borderRadius:8, border:'none', cursor:'pointer', fontSize:14, fontWeight:800, fontFamily:'sans-serif', transition:'all 0.15s',
                background: mode===m.id ? (m.id==='horsprojet' ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'linear-gradient(135deg,#1d4ed8,#3b82f6)') : 'transparent',
                color: mode===m.id ? '#fff' : '#64748b' }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Barre de commande */}
        <div style={{ flex:1, maxWidth:360, position:'relative', marginLeft:6 }}>
          <input
            ref={cmdRef}
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            onKeyDown={handleCmdKey}
            placeholder="Commande… (ex: configuration api ia)"
            style={{ width:'100%', padding:'9px 16px 9px 38px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:22, color:'#cbd5e1', fontSize:14, outline:'none', boxSizing:'border-box', fontFamily:'sans-serif', transition:'border-color 0.2s' }}
            onFocus={e=>e.target.style.borderColor='rgba(99,102,241,0.6)'}
            onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}
          />
          <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', fontSize:15, pointerEvents:'none' }}>⌨️</span>
          {cmdInput.trim().toLowerCase().includes('api ia') && (
            <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, background:'#1e293b', border:'1px solid rgba(99,102,241,0.4)', borderRadius:10, padding:'10px 14px', fontSize:14, color:'#a5b4fc', fontFamily:'sans-serif', zIndex:10, animation:'fadeIn 0.15s ease', cursor:'pointer' }}
              onClick={()=>{ setShowAiPanel(true); setCmdInput(''); }}>
              🤖 Ouvrir la <strong>Configuration API IA</strong> — Appuyez sur Entrée
            </div>
          )}
        </div>

        {selPath && (
          <span style={{ fontSize:13, color:'#64748b', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'sans-serif' }}>
            {isDirty && <span style={{ color:'#fbbf24' }}>● </span>}{selPath}
          </span>
        )}
        {saveMsg && <span style={{ fontSize:14, fontWeight:700, color:saveMsg.startsWith('✅')?'#4ade80':'#f87171', fontFamily:'sans-serif' }}>{saveMsg}</span>}

        <div style={{ display:'flex', gap:8, fontFamily:'sans-serif', marginLeft:'auto', alignItems:'center' }}>
          {/* Indicateur API active */}
          {activeApiInfo && (
            <div onClick={()=>setShowAiPanel(true)} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 14px', borderRadius:22, border:`1px solid ${activeApiInfo.fallback ? 'rgba(16,185,129,0.4)' : 'rgba(99,102,241,0.4)'}`, background:activeApiInfo.fallback ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)', cursor:'pointer' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:activeApiInfo.fallback ? '#10b981' : '#a5b4fc', animation:'pulse 2s infinite' }} />
              <span style={{ fontSize:13, fontWeight:700, color:activeApiInfo.fallback ? '#34d399' : '#a5b4fc' }}>
                {activeApiInfo.api?.icon} {activeApiInfo.apiName}
              </span>
            </div>
          )}
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>

          <button onClick={()=>setShowAiChat(v=>!v)}
            style={{ padding:'9px 16px', borderRadius:9, border:`2px solid ${showAiChat ? 'rgba(16,185,129,0.6)' : 'rgba(16,185,129,0.3)'}`, background: showAiChat ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.08)', color: showAiChat ? '#34d399' : '#6ee7b7', fontSize:14, cursor:'pointer', fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
            💬 Chat IA
          </button>

          <button onClick={()=>setShowAiPanel(true)}
            style={{ padding:'9px 16px', borderRadius:9, border:'2px solid rgba(99,102,241,0.4)', background:'rgba(99,102,241,0.12)', color:'#a5b4fc', fontSize:14, cursor:'pointer', fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
            🤖 Config IA
          </button>

          {selPath && <>
            <button onClick={saveFile} disabled={saving||!isDirty}
              style={{ padding:'9px 20px', borderRadius:9, border:'none', cursor:(saving||!isDirty)?'not-allowed':'pointer', fontSize:14, fontWeight:800, background:isDirty?'linear-gradient(135deg,#16a34a,#22c55e)':'rgba(34,197,94,0.15)', color:isDirty?'#fff':'#4ade80', opacity:saving?0.6:1 }}>
              {saving?'…':`💾 ${autoT('Enregistrer')}`}
            </button>
            <button onClick={runCode} disabled={running}
              style={{ padding:'9px 20px', borderRadius:9, border:'none', cursor:running?'not-allowed':'pointer', fontSize:14, fontWeight:800, background:running?'rgba(251,191,36,0.15)':'linear-gradient(135deg,#d97706,#fbbf24)', color:running?'#fbbf24':'#111', opacity:running?0.7:1 }}>
              {running?`⏳ ${autoT('Exécution…')}`:`▶ ${autoT('Exécuter')}`}
            </button>
          </>}

          <button onClick={handleLogout}
            style={{ padding:'9px 16px', borderRadius:9, border:'2px solid rgba(239,68,68,0.35)', background:'rgba(239,68,68,0.1)', color:'#f87171', fontSize:14, cursor:'pointer', fontWeight:700 }}>
            🚪 {autoT('Déconnexion')}
          </button>
        </div>
      </div>

      {/* Modal confirmation sauvegarde Projet */}
      {showSaveConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'#1e293b', border:'1px solid rgba(251,191,36,0.3)', borderRadius:16, padding:'28px 32px', maxWidth:440, width:'90%', fontFamily:'sans-serif', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize:32, marginBottom:12, textAlign:'center' }}>⚠️</div>
            <h3 style={{ color:'#f8fafc', margin:'0 0 10px', fontSize:16, fontWeight:800, textAlign:'center' }}>{autoT("Confirmer l'installation dans le projet")}</h3>
            <p style={{ color:'#94a3b8', fontSize:13, margin:'0 0 8px', lineHeight:1.6, textAlign:'center' }}>
              {autoT("Vous êtes sur le point d'enregistrer les modifications dans :")}<br />
              <span style={{ color:'#fbbf24', fontFamily:'monospace', fontSize:12 }}>{selPath}</span>
            </p>
            <p style={{ color:'#64748b', fontSize:12, margin:'0 0 20px', textAlign:'center' }}>
              {autoT('Ce fichier sera')} <strong style={{ color:'#f87171' }}>{autoT('remplacé dans la base de données')}</strong> {autoT('et les changements seront actifs immédiatement.')}
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={()=>setShowSaveConfirm(false)}
                style={{ flex:1, padding:'10px', borderRadius:9, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'#94a3b8', cursor:'pointer', fontSize:13, fontWeight:600 }}>
                {autoT('Annuler')}
              </button>
              <button onClick={confirmSave}
                style={{ flex:1, padding:'10px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#d97706,#f59e0b)', color:'#111', cursor:'pointer', fontSize:13, fontWeight:800 }}>
                ✅ {autoT('Oui, installer')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Corps */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

      {/* ════════════════════════════════════════════════════════
          MODE HORS PROJET
      ════════════════════════════════════════════════════════ */}
      {mode === 'horsprojet' && (
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

          {/* ─── LISTE DES BOTS ─── */}
          {botStep === 'list' && (
            <div style={{ flex:1, padding:'32px 40px', overflowY:'auto', fontFamily:'sans-serif' }}>
              <div style={{ maxWidth:800, margin:'0 auto' }}>
                <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:32 }}>
                  <div>
                    <h2 style={{ margin:0, fontSize:22, fontWeight:900, color:'#f8fafc' }}>🚀 {autoT('Espace Hors Projet')}</h2>
                    <p style={{ margin:'6px 0 0', fontSize:13, color:'#64748b' }}>{autoT('Créez et testez vos propres bots sans toucher au projet principal')}</p>
                  </div>
                  <button onClick={()=>{ setCurrentBot(null); setBotName(''); setBotDesc(''); setBotCode(''); setBotResult(null); setChatHistory([]); setBotStep('create'); }}
                    style={{ marginLeft:'auto', padding:'10px 20px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                    + {autoT('Créer un bot')}
                  </button>
                </div>

                {botList.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'60px 20px' }}>
                    <div style={{ fontSize:64, marginBottom:16 }}>🤖</div>
                    <div style={{ fontSize:18, fontWeight:700, color:'#334155', marginBottom:8 }}>{autoT('Aucun bot créé')}</div>
                    <div style={{ fontSize:14, color:'#1e293b', marginBottom:24 }}>{autoT("Créez votre premier bot — l'IA le code pour vous !")}</div>
                    <button onClick={()=>{ setCurrentBot(null); setBotName(''); setBotDesc(''); setBotCode(''); setBotResult(null); setChatHistory([]); setBotStep('create'); }}
                      style={{ padding:'12px 28px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer' }}>
                      🚀 {autoT('Créer mon premier bot')}
                    </button>
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
                    {botList.map(bot => (
                      <div key={bot.id} onClick={()=>openBot(bot)}
                        style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, padding:'20px', cursor:'pointer', transition:'all 0.2s', position:'relative' }}
                        onMouseOver={e=>{ e.currentTarget.style.background='rgba(124,58,237,0.1)'; e.currentTarget.style.borderColor='rgba(124,58,237,0.4)'; }}
                        onMouseOut={e=>{ e.currentTarget.style.background='rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'; }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                          <span style={{ fontSize:28 }}>🤖</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:800, fontSize:14, color:'#f8fafc', marginBottom:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{bot.name}</div>
                            <div style={{ fontSize:11, color:'#475569' }}>{new Date(bot.updatedAt).toLocaleDateString('fr-FR')} · {bot.lang?.toUpperCase() || 'JS'}</div>
                          </div>
                          <button onClick={e=>deleteBot(bot.id, e)}
                            style={{ background:'none', border:'none', cursor:'pointer', color:'#334155', fontSize:13, padding:2, flexShrink:0 }}
                            onMouseOver={e=>e.currentTarget.style.color='#f87171'}
                            onMouseOut={e=>e.currentTarget.style.color='#334155'}>✕</button>
                        </div>
                        <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                          {bot.description || '(sans description)'}
                        </div>
                        <div style={{ marginTop:10, fontSize:11, color:'#334155', fontFamily:'monospace' }}>
                          {bot.code?.split('\n').length || 0} lignes de code
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── CRÉER UN BOT ─── */}
          {botStep === 'create' && (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:32, overflowY:'auto' }}>
              <div style={{ width:'100%', maxWidth:560, fontFamily:'sans-serif' }}>
                <button onClick={()=>setBotStep('list')} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:13, marginBottom:20, padding:0 }}>← {autoT('Retour à la liste')}</button>
                <div style={{ textAlign:'center', marginBottom:28 }}>
                  <div style={{ fontSize:48, marginBottom:12 }}>🤖</div>
                  <h2 style={{ margin:0, fontSize:20, fontWeight:900, color:'#f8fafc' }}>{autoT('Quel bot voulez-vous créer ?')}</h2>
                  <p style={{ margin:'8px 0 0', fontSize:13, color:'#64748b' }}>{autoT("Décrivez votre bot en français — l'IA va le coder automatiquement")}</p>
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div>
                    <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>{autoT('Nom du bot')}</label>
                    <input value={botName} onChange={e=>setBotName(e.target.value)} placeholder="Ex: Bot de prédiction Baccarat"
                      style={{ width:'100%', padding:'12px 16px', background:'#1e293b', border:'1.5px solid rgba(124,58,237,0.25)', borderRadius:10, color:'#f8fafc', fontSize:14, outline:'none', boxSizing:'border-box' }}
                      onFocus={e=>e.target.style.borderColor='#7c3aed'} onBlur={e=>e.target.style.borderColor='rgba(124,58,237,0.25)'} />
                  </div>
                  <div>
                    <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>{autoT('Description détaillée')}</label>
                    <textarea value={botDesc} onChange={e=>setBotDesc(e.target.value)} rows={5}
                      placeholder="Décrivez en détail ce que votre bot doit faire, comment il doit fonctionner, quelles données il utilise, etc."
                      style={{ width:'100%', padding:'12px 16px', background:'#1e293b', border:'1.5px solid rgba(124,58,237,0.25)', borderRadius:10, color:'#f8fafc', fontSize:13, outline:'none', resize:'vertical', boxSizing:'border-box', fontFamily:'sans-serif', lineHeight:1.6 }}
                      onFocus={e=>e.target.style.borderColor='#7c3aed'} onBlur={e=>e.target.style.borderColor='rgba(124,58,237,0.25)'} />
                  </div>
                  <div style={{ display:'flex', gap:10 }}>
                    <button onClick={()=>{ setBotStep('edit'); setBotCode('// Écrivez votre code ici…\n'); }}
                      style={{ flex:1, padding:'12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'#94a3b8', cursor:'pointer', fontSize:13, fontWeight:600 }}>
                      ✏️ {autoT('Coder manuellement')}
                    </button>
                    <button onClick={generateBotCode} disabled={botGenerating || !botName.trim() || !botDesc.trim()}
                      style={{ flex:2, padding:'12px', borderRadius:10, border:'none', cursor:(botGenerating||!botName.trim()||!botDesc.trim())?'not-allowed':'pointer', fontSize:13, fontWeight:800, background:(botGenerating||!botName.trim()||!botDesc.trim())?'rgba(124,58,237,0.3)':'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', opacity:(botGenerating||!botName.trim()||!botDesc.trim())?0.6:1 }}>
                      {botGenerating ? `⏳ ${autoT("L'IA code votre bot…")}` : `🤖 ${autoT("L'IA code pour moi")}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── ÉDITEUR BOT ─── */}
          {botStep === 'edit' && (
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              {/* Éditeur principal */}
              <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                {/* Barre du bot */}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 18px', background:'rgba(124,58,237,0.12)', borderBottom:'2px solid rgba(124,58,237,0.25)', flexShrink:0, fontFamily:'sans-serif' }}>
                  <button onClick={()=>{ setBotStep('list'); setCurrentBot(null); }} style={{ background:'rgba(255,255,255,0.07)', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:14, fontWeight:600, padding:'6px 12px', borderRadius:7 }}>← {autoT('Liste')}</button>
                  <span style={{ fontSize:15, color:'#a855f7', fontWeight:900 }}>🤖 {botName || autoT('Nouveau bot')}</span>
                  <span style={{ fontSize:13, color:'#64748b', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{botDesc ? `• ${botDesc.slice(0,60)}${botDesc.length>60?'…':''}` : ''}</span>
                  {botSaveMsg && <span style={{ fontSize:14, fontWeight:700, color:botSaveMsg.startsWith('✅')?'#4ade80':'#f87171' }}>{botSaveMsg}</span>}
                  <select value={botLang} onChange={e=>setBotLang(e.target.value)}
                    style={{ padding:'7px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'#1e293b', color:'#e2e8f0', fontSize:14, cursor:'pointer', fontWeight:600 }}>
                    <option value="js">JavaScript</option>
                    <option value="py">Python</option>
                    <option value="sh">Shell</option>
                  </select>
                  <button onClick={runBotCode} disabled={botRunning}
                    style={{ padding:'9px 20px', borderRadius:9, border:'none', cursor:botRunning?'not-allowed':'pointer', fontSize:14, fontWeight:800, background:botRunning?'rgba(251,191,36,0.15)':'linear-gradient(135deg,#d97706,#fbbf24)', color:botRunning?'#fbbf24':'#111' }}>
                    {botRunning ? `⏳ ${autoT('En cours…')}` : `▶ ${autoT('Tester')}`}
                  </button>
                  <button onClick={saveBot} disabled={botSaving}
                    style={{ padding:'9px 20px', borderRadius:9, border:'none', cursor:botSaving?'not-allowed':'pointer', fontSize:14, fontWeight:800, background:botSaving?'rgba(124,58,237,0.3)':'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff' }}>
                    {botSaving ? '…' : `💾 ${autoT('Sauvegarder')}`}
                  </button>
                </div>

                {/* Zone de code */}
                <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
                  {botGenerating ? (
                    <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, fontFamily:'sans-serif' }}>
                      <div style={{ width:40, height:40, border:'4px solid rgba(124,58,237,0.3)', borderTopColor:'#a855f7', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
                      <div style={{ fontSize:14, color:'#a855f7', fontWeight:700 }}>{autoT("L'IA génère votre bot…")}</div>
                      <div style={{ fontSize:12, color:'#475569' }}>{autoT('Cela peut prendre quelques secondes')}</div>
                    </div>
                  ) : (
                    <textarea ref={botTextareaRef} className="prog-textarea" value={botCode} onChange={e=>setBotCode(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Tab'){e.preventDefault(); const s=e.target.selectionStart,en=e.target.selectionEnd; setBotCode(c=>c.substring(0,s)+'  '+c.substring(en)); requestAnimationFrame(()=>{botTextareaRef.current.selectionStart=botTextareaRef.current.selectionEnd=s+2;});} }}
                      spellCheck={false}
                      style={{ width:'100%', height:'100%', background:'#ffffff', color:'#1e293b', border:'none', resize:'none', fontFamily:"'Cascadia Code','Fira Code','Consolas',monospace", fontSize:13, lineHeight:1.65, padding:'16px 20px', tabSize:2, boxSizing:'border-box' }} />
                  )}
                </div>

                {/* Résultats du test */}
                {(botResult !== null || botRunning) && (
                  <div style={{ height:200, background:'#0a0f1e', borderTop:'1px solid rgba(255,255,255,0.08)', overflow:'hidden', display:'flex', flexDirection:'column', flexShrink:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', background:'#111827', flexShrink:0, fontFamily:'sans-serif' }}>
                      <span style={{ fontSize:12, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:1 }}>{autoT('Résultats du test')}</span>
                      {botResult && <span style={{ fontSize:11, padding:'2px 10px', borderRadius:12, fontWeight:700, background:botResult.exitCode===0?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)', color:botResult.exitCode===0?'#4ade80':'#f87171' }}>{botResult.exitCode===0?`✅ ${autoT('Succès')}`:`❌ Code ${botResult.exitCode}`}</span>}
                      <button onClick={()=>setBotResult(null)} style={{ marginLeft:'auto', background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:14 }}>✕</button>
                    </div>
                    <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
                      {botRunning ? <div style={{ color:'#64748b', fontSize:13 }}>⏳ {autoT('Exécution en cours…')}</div> : (
                        <>
                          {botResult?.output && <pre style={{ margin:0, fontSize:12, color:'#4ade80', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.65 }}>{botResult.output}</pre>}
                          {botResult?.error && <pre style={{ margin:0, fontSize:12, color:'#f87171', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.65 }}>{botResult.error}</pre>}
                          {!botResult?.output && !botResult?.error && <span style={{ color:'#475569', fontSize:12 }}>({autoT('aucune sortie')})</span>}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Chat IA pour le bot */}
              <div style={{ width:340, flexShrink:0, background:'#111827', borderLeft:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0, fontFamily:'sans-serif' }}>
                  <span style={{ fontSize:13 }}>💬</span>
                  <span style={{ fontWeight:800, fontSize:12, color:'#f8fafc', flex:1 }}>{autoT('Chat IA — Améliorer le bot')}</span>
                  {chatHistory.length > 0 && <button onClick={()=>setChatHistory([])} style={{ background:'none', border:'none', cursor:'pointer', color:'#475569', fontSize:11, fontFamily:'sans-serif' }}>{autoT('Vider')}</button>}
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:'12px 12px 0' }}>
                  {chatHistory.length === 0 && (
                    <div style={{ padding:'20px 8px', textAlign:'center', fontFamily:'sans-serif' }}>
                      <div style={{ fontSize:28, marginBottom:8 }}>💡</div>
                      <div style={{ fontSize:12, color:'#475569', lineHeight:1.6 }}>{autoT("Demandez à l'IA d'améliorer, corriger ou expliquer votre bot.")}</div>
                      <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:5 }}>
                        {[autoT('Corrige les bugs dans ce code'), autoT('Ajoute une gestion des erreurs'), autoT('Explique ce que fait ce bot'), autoT('Optimise le code')].map(s=>(
                          <button key={s} onClick={()=>{setChatInput(s);chatInputRef.current?.focus();}}
                            style={{ padding:'6px 10px', borderRadius:7, border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', fontSize:11, cursor:'pointer', fontFamily:'sans-serif', textAlign:'left' }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {chatHistory.map((msg, idx) => renderChatMessage(msg, idx))}
                  {chatLoading && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0 12px', fontFamily:'sans-serif' }}>
                      <div style={{ display:'flex', gap:4 }}>{[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#a855f7', animation:`bounce 1s ${i*0.15}s infinite` }} />)}</div>
                      <span style={{ fontSize:11, color:'#475569' }}>{autoT("L'IA réfléchit…")}</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div style={{ padding:10, borderTop:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
                  <div style={{ display:'flex', gap:6, alignItems:'flex-end' }}>
                    <textarea ref={chatInputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();} }}
                      placeholder="Demandez une modification…" rows={2}
                      style={{ flex:1, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#f8fafc', fontSize:12, padding:'8px 12px', resize:'none', fontFamily:'sans-serif', lineHeight:1.5, outline:'none' }}
                      onFocus={e=>e.target.style.borderColor='rgba(168,85,247,0.5)'}
                      onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
                    <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()}
                      style={{ padding:'10px 12px', borderRadius:10, border:'none', cursor:(chatLoading||!chatInput.trim())?'not-allowed':'pointer', background:(chatLoading||!chatInput.trim())?'rgba(168,85,247,0.2)':'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:14, fontWeight:700, flexShrink:0, opacity:(chatLoading||!chatInput.trim())?0.5:1 }}>
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODE PROJET
      ════════════════════════════════════════════════════════ */}
      {mode === 'projet' && <>

        {/* Bouton rouvrir sidebar quand fermée */}
        {!sidebarOpen && (
          <div style={{ width:28, flexShrink:0, background:'#111827', borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', alignItems:'center', paddingTop:8 }}>
            <button onClick={()=>setSidebarOpen(true)} title="Ouvrir les fichiers"
              style={{ background:'none', border:'none', cursor:'pointer', color:'#475569', fontSize:16, padding:4 }}>›</button>
          </div>
        )}

        {/* Sidebar fichiers */}
        {sidebarOpen && (
          <div style={{ width:sidebarW, flexShrink:0, background:'#111827', borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'14px 14px 10px', fontSize:12, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:1.4, fontFamily:'sans-serif', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span>📂 {autoT('Fichiers du projet')}</span>
              <button onClick={()=>setSidebarOpen(false)} title="Réduire"
                style={{ background:'rgba(255,255,255,0.06)', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18, lineHeight:1, padding:'2px 8px', borderRadius:6 }}>‹</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 6px 12px' }}>
              {files.length===0
                ? <div style={{ padding:24, fontSize:14, color:'#475569', textAlign:'center', fontFamily:'sans-serif' }}>{autoT('Chargement…')}</div>
                : <FileTree nodes={files} onSelect={loadFile} selected={selPath} />}
            </div>
          </div>
        )}

        {/* Poignée resize */}
        {sidebarOpen && (
          <div onMouseDown={startDrag}
            style={{ width:4, background:'rgba(255,255,255,0.04)', cursor:'col-resize', flexShrink:0, transition:'background 0.15s' }}
            onMouseOver={e=>e.currentTarget.style.background='rgba(99,102,241,0.4)'}
            onMouseOut={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'} />
        )}

        {/* Éditeur + résultats */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
            {!selPath ? (
              <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, fontFamily:'sans-serif' }}>
                <div style={{ fontSize:72 }}>📂</div>
                <div style={{ fontSize:22, fontWeight:800, color:'#475569' }}>{autoT('Sélectionnez un fichier')}</div>
                <div style={{ fontSize:16, color:'#334155' }}>{autoT("Cliquez sur un fichier dans la liste à gauche pour l'éditer")}</div>
                <div style={{ marginTop:8, padding:'16px 24px', borderRadius:12, background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)', fontSize:14, color:'#818cf8', cursor:'pointer', textAlign:'center' }}
                  onClick={()=>setShowAiPanel(true)}>
                  💡 {autoT('Cliquez sur')} <strong>🤖 Config IA</strong> {autoT('pour configurer votre clé API gratuite')}
                </div>
              </div>
            ) : loading ? (
              <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ width:28, height:28, border:'3px solid rgba(59,130,246,0.3)', borderTopColor:'#3b82f6', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
              </div>
            ) : (
              <textarea ref={textareaRef} className="prog-textarea" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={handleKeyDown} spellCheck={false}
                style={{ width:'100%', height:'100%', background:'#ffffff', color:'#1e293b', border:'none', resize:'none', fontFamily:"'Cascadia Code','Fira Code','Consolas',monospace", fontSize:15, lineHeight:1.7, padding:'20px 24px', tabSize:2, boxSizing:'border-box' }} />
            )}
          </div>

          {(result!==null||running) && (
            <div style={{ height:240, background:'#0a0f1e', borderTop:'2px solid rgba(255,255,255,0.08)', overflow:'hidden', display:'flex', flexDirection:'column', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)', background:'#111827', flexShrink:0, fontFamily:'sans-serif' }}>
                <span style={{ fontSize:13, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:1.2 }}>📋 {autoT('Résultats')}</span>
                {result && (
                  <span style={{ fontSize:13, padding:'4px 14px', borderRadius:20, fontWeight:700, background:result.exitCode===0?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)', color:result.exitCode===0?'#4ade80':'#f87171' }}>
                    {result.exitCode===0?`✅ ${autoT('Succès')}`:`❌ Code ${result.exitCode}`}
                  </span>
                )}
                <button onClick={()=>setResult(null)} style={{ marginLeft:'auto', background:'rgba(255,255,255,0.06)', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:16, fontFamily:'sans-serif', padding:'4px 10px', borderRadius:6 }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'14px 18px' }}>
                {running ? <div style={{ color:'#64748b', fontSize:15 }}>⏳ {autoT('Exécution en cours…')}</div> : (
                  <>
                    {result?.output && <pre style={{ margin:0, fontSize:14, color:'#4ade80', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.7 }}>{result.output}</pre>}
                    {result?.error && <pre style={{ margin:0, fontSize:14, color:'#f87171', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.7 }}>{result.error}</pre>}
                    {!result?.output && !result?.error && <span style={{ color:'#475569', fontSize:14 }}>({autoT('aucune sortie')})</span>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Panneau Chat IA (colonne droite) */}
        {showAiChat && (
          <>
            <div style={{ width:5, background:'rgba(255,255,255,0.05)', flexShrink:0, borderLeft:'1px solid rgba(255,255,255,0.08)' }} />
            <div style={{ width:400, flexShrink:0, background:'#111827', display:'flex', flexDirection:'column', overflow:'hidden' }}>
              {/* En-tête chat */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'2px solid rgba(255,255,255,0.07)', flexShrink:0, fontFamily:'sans-serif' }}>
                <span style={{ fontSize:18 }}>💬</span>
                <span style={{ fontWeight:900, fontSize:15, color:'#f8fafc', flex:1 }}>{autoT('Assistant IA')}</span>
                {activeApiInfo && (
                  <span style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>{activeApiInfo.apiName}</span>
                )}
                {chatHistory.length > 0 && (
                  <button onClick={()=>setChatHistory([])}
                    style={{ background:'rgba(255,255,255,0.06)', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:13, fontFamily:'sans-serif', padding:'4px 10px', borderRadius:6, fontWeight:600 }}>
                    {autoT('Vider')}
                  </button>
                )}
                <button onClick={()=>setShowAiChat(false)}
                  style={{ background:'rgba(255,255,255,0.06)', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18, lineHeight:1, marginLeft:4, padding:'4px 10px', borderRadius:6 }}>✕</button>
              </div>

              {/* Zone messages */}
              <div style={{ flex:1, overflowY:'auto', padding:'14px 14px 0' }}>
                {chatHistory.length === 0 && (
                  <div style={{ padding:'28px 14px', textAlign:'center', fontFamily:'sans-serif' }}>
                    <div style={{ fontSize:40, marginBottom:14 }}>🤖</div>
                    <div style={{ fontSize:15, color:'#64748b', lineHeight:1.7 }}>
                      {autoT('Décrivez ce que vous voulez coder en français.')}
                      {selPath && <span style={{ fontSize:13, color:'#475569', display:'block', marginTop:10 }}>{autoT('Le code sera inséré dans')} <strong style={{ color:'#818cf8' }}>{selPath.split('/').pop()}</strong></span>}
                    </div>
                    <div style={{ marginTop:18, display:'flex', flexDirection:'column', gap:8 }}>
                      {[autoT('Crée une fonction de prédiction Baccarat'), autoT('Explique ce fichier et propose des améliorations'), autoT('Corrige les bugs dans ce code')].map(s => (
                        <button key={s} onClick={()=>{ setChatInput(s); chatInputRef.current?.focus(); }}
                          style={{ padding:'10px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)', color:'#94a3b8', fontSize:13, cursor:'pointer', fontFamily:'sans-serif', textAlign:'left', fontWeight:500 }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, idx) => renderChatMessage(msg, idx))}
                {chatLoading && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0 14px', fontFamily:'sans-serif' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      {[0,1,2].map(i => (
                        <div key={i} style={{ width:8, height:8, borderRadius:'50%', background:'#4f46e5', animation:`bounce 1s ${i*0.15}s infinite` }} />
                      ))}
                    </div>
                    <span style={{ fontSize:14, color:'#64748b' }}>{autoT('Génération en cours…')}</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Zone saisie */}
              <div style={{ padding:12, borderTop:'2px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
                <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={e=>setChatInput(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); }}}
                    placeholder="Décrivez votre besoin en français… (Entrée pour envoyer)"
                    rows={3}
                    style={{ flex:1, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, color:'#f8fafc', fontSize:14, padding:'10px 14px', resize:'none', fontFamily:'sans-serif', lineHeight:1.6, outline:'none' }}
                    onFocus={e=>e.target.style.borderColor='rgba(99,102,241,0.6)'}
                    onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}
                  />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                    style={{ padding:'12px 16px', borderRadius:12, border:'none', cursor:(chatLoading||!chatInput.trim())?'not-allowed':'pointer', background:(chatLoading||!chatInput.trim())?'rgba(99,102,241,0.2)':'linear-gradient(135deg,#4f46e5,#6366f1)', color:'#fff', fontSize:18, fontWeight:700, flexShrink:0, opacity:(chatLoading||!chatInput.trim())?0.5:1 }}>
                    ↑
                  </button>
                </div>
                <div style={{ fontSize:12, color:'#334155', marginTop:7, fontFamily:'sans-serif' }}>
                  {autoT('Shift+Entrée pour nouvelle ligne · Entrée pour envoyer')}
                </div>
              </div>
            </div>
          </>
        )}

      </>}
      {/* fin mode projet */}

      </div>

      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>

      {/* Panneau Config API IA */}
      {showAiPanel && <AiConfigPanel onClose={()=>setShowAiPanel(false)} />}
    </div>
  );
}
