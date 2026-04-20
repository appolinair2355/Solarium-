import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const REFRESH_INTERVAL = 5000; // 5s

const STATUS_COLOR = { ok: '#22c55e', warn: '#f59e0b', error: '#ef4444', unknown: '#64748b' };
const STATUS_ICON  = { ok: '✅', warn: '⚠️', error: '❌', unknown: '❔' };

const TABLE_LABELS = {
  users:                  '👤 Utilisateurs',
  predictions:            '🎯 Prédictions',
  telegram_config:        '📡 Canaux Telegram',
  settings:               '⚙️ Paramètres',
  strategy_channel_routes:'🔀 Routes stratégies',
  tg_pred_messages:       '💬 Messages TG',
  user_channel_hidden:    '🙈 Canaux masqués',
  user_channel_visible:   '👁 Canaux visibles',
  user_strategy_visible:  '🃏 Stratégies visibles',
  hosted_bots:            '🤖 Bots hébergés',
  deploy_logs:            '📦 Logs déploiement',
  project_files:          '📁 Fichiers projet',
};

function Badge({ status }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
      background: STATUS_COLOR[status] + '22',
      color: STATUS_COLOR[status],
      border: `1px solid ${STATUS_COLOR[status]}55`,
    }}>
      {STATUS_ICON[status]} {status?.toUpperCase()}
    </span>
  );
}

function StatCard({ icon, label, value, sub, color = '#818cf8' }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '14px 18px', minWidth: 130,
    }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function TableViewer({ tableName, onClose }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage]     = useState(0);
  const limit = 100;

  const fetchData = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/system-logs/table/${tableName}?limit=${limit}&offset=${p * limit}`, { credentials: 'include' });
      const d = await r.json();
      setData(d);
    } catch {}
    setLoading(false);
  }, [tableName]);

  useEffect(() => { fetchData(page); }, [fetchData, page]);

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* En-tête */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(13,31,18,0.95)',
      }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0' }}>
          {TABLE_LABELS[tableName] || tableName}
        </div>
        {data && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {data.total} ligne(s) au total • page {page + 1}/{totalPages || 1}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {page > 0 && (
            <button onClick={() => setPage(p => p - 1)} style={btnStyle('#818cf8')}>← Préc</button>
          )}
          {data && (page + 1) < totalPages && (
            <button onClick={() => setPage(p => p + 1)} style={btnStyle('#818cf8')}>Suiv →</button>
          )}
          <button onClick={() => fetchData(page)} style={btnStyle('#22c55e')}>🔄 Actualiser</button>
          <button onClick={onClose} style={btnStyle('#ef4444')}>✕ Fermer</button>
        </div>
      </div>

      {/* Corps */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}>Chargement...</div>
        ) : data?.error ? (
          <div style={{ color: '#ef4444', padding: 24 }}>Erreur : {data.error}</div>
        ) : data?.rows?.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 60 }}>Table vide</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                {data.columns.map(col => (
                  <th key={col.column_name} style={{
                    padding: '8px 12px', textAlign: 'left', whiteSpace: 'nowrap',
                    color: '#94a3b8', fontWeight: 700, fontSize: 11,
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    {col.column_name}
                    <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 4 }}>
                      {col.data_type?.replace('character varying', 'varchar').replace('timestamp with time zone', 'timestamptz')}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                  {data.columns.map(col => {
                    const val = row[col.column_name];
                    const isNull = val === null || val === undefined;
                    const isSensitive = val === '••••••••';
                    const isLong = typeof val === 'string' && val.length > 80;
                    const isBool = typeof val === 'boolean';
                    return (
                      <td key={col.column_name} style={{
                        padding: '7px 12px', maxWidth: 280,
                        color: isNull ? '#334155' : isSensitive ? '#f59e0b' : isBool ? (val ? '#22c55e' : '#ef4444') : '#e2e8f0',
                        verticalAlign: 'top',
                      }}>
                        {isNull ? <span style={{ fontStyle: 'italic', opacity: 0.4 }}>NULL</span>
                          : isBool ? (val ? '✅ true' : '⬜ false')
                          : isLong ? (
                            <span title={val} style={{ cursor: 'help' }}>
                              {val.slice(0, 80)}<span style={{ color: '#475569' }}>…</span>
                            </span>
                          ) : String(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function btnStyle(color = '#818cf8') {
  return {
    padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
    fontWeight: 700, background: color + '22', color, transition: 'all 0.15s',
  };
}

export default function SystemLogs() {
  const navigate = useNavigate();
  const [data, setData]           = useState(null);
  const [health, setHealth]       = useState(null);
  const [engine, setEngine]       = useState(null);
  const [preds, setPreds]         = useState(null);
  const [predsLoading, setPredsLoading] = useState(false);
  const [openStrats, setOpenStrats]     = useState({});
  const [selectedTable, setSelectedTable] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [lastRefresh, setLastRefresh]     = useState(null);
  const [autoRefresh, setAutoRefresh]     = useState(true);
  const [activeTab, setActiveTab]         = useState('overview');
  const [timeline, setTimeline]           = useState(null);
  const [tlHours, setTlHours]             = useState(24);
  const [tlLoading, setTlLoading]         = useState(false);
  const intervalRef = useRef(null);

  const fetchOverview = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/system-logs', { credentials: 'include' }),
        fetch('/api/system-logs/engine', { credentials: 'include' }),
      ]);
      if (r1.ok) setData(await r1.json());
      if (r2.ok) setEngine(await r2.json());
      setLastRefresh(new Date());
    } catch {}
  }, []);

  const fetchPredictions = useCallback(async () => {
    setPredsLoading(true);
    try {
      const r = await fetch('/api/system-logs/predictions', { credentials: 'include' });
      if (r.ok) setPreds(await r.json());
    } catch {}
    setPredsLoading(false);
  }, []);

  const checkHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const r = await fetch('/api/system-logs/health', { credentials: 'include' });
      if (r.ok) setHealth(await r.json());
    } catch {}
    setLoadingHealth(false);
  }, []);

  useEffect(() => {
    fetchOverview();
    checkHealth();
  }, [fetchOverview, checkHealth]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchOverview, REFRESH_INTERVAL);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchOverview]);

  const fetchTimeline = useCallback(async (h) => {
    setTlLoading(true);
    try {
      const r = await fetch(`/api/system-logs/timeline?hours=${h || tlHours}`, { credentials: 'include' });
      if (r.ok) setTimeline(await r.json());
    } catch {}
    setTlLoading(false);
  }, [tlHours]);

  // Charger les prédictions quand l'onglet est ouvert
  useEffect(() => {
    if (activeTab === 'predictions') fetchPredictions();
    if (activeTab === 'courbes') fetchTimeline();
  }, [activeTab, fetchPredictions, fetchTimeline]);

  const fmt = (n) => n != null ? n.toLocaleString() : '—';
  const fmtUptime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}min`;
  };

  const tabs = [
    { id: 'overview',     label: '📊 Vue globale' },
    { id: 'database',     label: '🗄️ Base de données' },
    { id: 'predictions',  label: '🎯 Prédictions' },
    { id: 'engine',       label: '⚙️ Moteur' },
    { id: 'courbes',      label: '📈 Courbes' },
    { id: 'bots',         label: '🤖 Bots hébergés' },
    { id: 'health',       label: '🩺 Santé système' },
  ];

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #080f17 0%, #0d1f12 50%, #080f17 100%)',
      color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: 24,
    }}>
      {selectedTable && (
        <TableViewer tableName={selectedTable} onClose={() => setSelectedTable(null)} />
      )}

      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button onClick={() => navigate('/admin')} style={{ ...btnStyle('#64748b'), padding: '8px 16px' }}>
          ← Admin
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#f1f5f9' }}>
            🖥 Logs Système & Base de Données
          </h1>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
            Tableau de bord en temps réel — toutes les données visibles
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: '#334155' }}>
              Màj : {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setAutoRefresh(a => !a)}
            style={btnStyle(autoRefresh ? '#22c55e' : '#64748b')}
          >
            {autoRefresh ? '⏸ Pause' : '▶ Auto (5s)'}
          </button>
          <button onClick={() => { fetchOverview(); checkHealth(); }} style={btnStyle('#818cf8')}>
            🔄 Actualiser
          </button>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '10px 18px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: activeTab === t.id ? 'rgba(34,197,94,0.15)' : 'transparent',
            color: activeTab === t.id ? '#22c55e' : '#64748b',
            borderBottom: activeTab === t.id ? '2px solid #22c55e' : '2px solid transparent',
            borderRadius: '8px 8px 0 0', transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ONG 1 : Vue globale ── */}
      {activeTab === 'overview' && data && (
        <div>
          {/* Cartes serveur */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
            <StatCard icon="⏱" label="Uptime"         value={fmtUptime(data.server.uptime)} color="#22c55e" />
            <StatCard icon="💾" label="Heap utilisé"   value={`${data.server.memory.heapUsed} Mo`} sub={`/ ${data.server.memory.heapTotal} Mo`} color="#818cf8" />
            <StatCard icon="🖥" label="Mémoire système" value={`${data.server.memory.systemFree} Mo`} sub={`libre / ${data.server.memory.systemTotal} Mo`} color="#60a5fa" />
            <StatCard icon="🗄" label="Base de données" value={data.server.dbMode} color="#34d399" />
            <StatCard icon="🔧" label="Node.js"         value={data.server.nodeVersion} color="#f59e0b" />
          </div>

          {/* Stats prédictions du jour */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              📈 Prédictions des dernières 24h
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: 'Total',    val: data.todayStats.total,    color: '#818cf8' },
                { label: 'Gagnées', val: data.todayStats.gagne,    color: '#22c55e' },
                { label: 'Perdues', val: data.todayStats.perdu,    color: '#ef4444' },
                { label: 'En cours',val: data.todayStats.en_cours, color: '#f59e0b' },
                { label: 'Expirées',val: data.todayStats.expire,   color: '#64748b' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{
                  background: color + '15', border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 18px',
                }}>
                  <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color }}>{fmt(val)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Dernières prédictions */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              🎯 20 dernières prédictions
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {['Stratégie', 'Jeu #', 'Costume prédit', 'Statut', 'Rattrapage', 'Créée', 'Résolue'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 700, fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.recentPredictions || []).map((p, i) => {
                    const sc = { gagne: '#22c55e', perdu: '#ef4444', en_cours: '#f59e0b', expire: '#64748b' };
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '6px 12px', color: '#818cf8', fontWeight: 700 }}>{p.strategy}</td>
                        <td style={{ padding: '6px 12px' }}>#{p.game_number}</td>
                        <td style={{ padding: '6px 12px', fontSize: 16 }}>{p.predicted_suit}</td>
                        <td style={{ padding: '6px 12px' }}>
                          <span style={{ color: sc[p.status] || '#e2e8f0', fontWeight: 700 }}>{p.status}</span>
                        </td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8' }}>R{p.rattrapage || 0}</td>
                        <td style={{ padding: '6px 12px', color: '#475569', fontSize: 11 }}>{p.created_at ? new Date(p.created_at).toLocaleTimeString() : '—'}</td>
                        <td style={{ padding: '6px 12px', color: '#475569', fontSize: 11 }}>{p.resolved_at ? new Date(p.resolved_at).toLocaleTimeString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── ONG 2 : Base de données ── */}
      {activeTab === 'database' && (
        <div>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>
            Cliquez sur une table pour voir l'intégralité de ses données. Les colonnes sensibles (mots de passe, tokens) sont masquées automatiquement.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {(data?.tables || []).map(tbl => (
              <div
                key={tbl.name}
                onClick={() => setSelectedTable(tbl.name)}
                style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: '16px 20px', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.07)'; e.currentTarget.style.borderColor = 'rgba(34,197,94,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', marginBottom: 6 }}>
                  {TABLE_LABELS[tbl.name] || tbl.name}
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', marginBottom: 10 }}>
                  {tbl.name}
                </div>
                {tbl.error ? (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>{tbl.error}</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 22, fontWeight: 900, color: tbl.count > 0 ? '#22c55e' : '#334155',
                    }}>
                      {fmt(tbl.count)}
                    </span>
                    <span style={{ fontSize: 11, color: '#475569' }}>ligne(s)</span>
                    {tbl.name === 'project_files' && data?.fileSizeStats?.totalKb > 0 && (
                      <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>
                        {data.fileSizeStats.totalKb < 1024
                          ? `${data.fileSizeStats.totalKb} KB`
                          : `${(data.fileSizeStats.totalKb / 1024).toFixed(1)} MB`}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', fontWeight: 700 }}>
                      Voir →
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ONG PRÉDICTIONS : Toutes les prédictions par stratégie ── */}
      {activeTab === 'predictions' && (
        <div>
          {/* Barre d'actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button
              onClick={fetchPredictions}
              disabled={predsLoading}
              style={{
                background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
                color: '#22c55e', borderRadius: 8, padding: '8px 18px', cursor: 'pointer',
                fontWeight: 700, fontSize: 13,
              }}
            >
              {predsLoading ? '⏳ Chargement...' : '🔄 Actualiser'}
            </button>
            {preds && (
              <div style={{ fontSize: 12, color: '#475569' }}>
                <span style={{ color: '#818cf8', fontWeight: 700 }}>{preds.totalRows.toLocaleString()}</span> prédiction(s) au total •{' '}
                <span style={{ color: '#60a5fa', fontWeight: 700 }}>{preds.strategies.length}</span> stratégie(s)
              </div>
            )}
            {preds && (
              <button
                onClick={() => {
                  const all = {};
                  preds.strategies.forEach(s => { all[s.strategy] = true; });
                  setOpenStrats(all);
                }}
                style={{
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                  color: '#818cf8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12,
                }}
              >
                ↕ Tout déplier
              </button>
            )}
            {preds && (
              <button
                onClick={() => setOpenStrats({})}
                style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12,
                }}
              >
                ↕ Tout replier
              </button>
            )}
          </div>

          {predsLoading && !preds && (
            <div style={{ textAlign: 'center', color: '#475569', padding: 60 }}>Chargement des prédictions...</div>
          )}

          {preds && preds.strategies.length === 0 && (
            <div style={{ textAlign: 'center', color: '#475569', padding: 60 }}>Aucune prédiction en base de données</div>
          )}

          {preds && preds.strategies.map(st => {
            const isOpen = !!openStrats[st.strategy];
            const wc = st.winRate == null ? '#475569' : st.winRate >= 60 ? '#22c55e' : st.winRate >= 45 ? '#f59e0b' : '#ef4444';
            return (
              <div key={st.strategy} style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, marginBottom: 14, overflow: 'hidden',
              }}>
                {/* Header stratégie — cliquable */}
                <div
                  onClick={() => setOpenStrats(p => ({ ...p, [st.strategy]: !p[st.strategy] }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
                    cursor: 'pointer', background: isOpen ? 'rgba(99,102,241,0.08)' : 'transparent',
                    borderBottom: isOpen ? '1px solid rgba(255,255,255,0.07)' : 'none',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#818cf8' }}>{st.strategy}</span>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { l: 'Total',    v: st.total,    c: '#818cf8' },
                      { l: '✅ Gagnées', v: st.gagne,  c: '#22c55e' },
                      { l: '❌ Perdues', v: st.perdu,  c: '#ef4444' },
                      { l: '⏳ En cours', v: st.en_cours, c: '#f59e0b' },
                      { l: '⏱ Expirées', v: st.expire, c: '#64748b' },
                    ].map(({ l, v, c }) => (
                      <span key={l} style={{
                        fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 700,
                        background: c + '18', color: c, border: `1px solid ${c}33`,
                      }}>{l} {v}</span>
                    ))}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                    {st.winRate != null && (
                      <span style={{
                        fontSize: 15, fontWeight: 900, color: wc,
                        background: wc + '18', border: `1px solid ${wc}33`,
                        borderRadius: 8, padding: '3px 12px',
                      }}>
                        {st.winRate}%
                      </span>
                    )}
                    <span style={{ color: '#475569', fontSize: 18 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Tableau des prédictions */}
                {isOpen && (
                  <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0, zIndex: 1 }}>
                          {['ID', 'Jeu #', 'Costume prédit', 'Statut', 'Rattrapage', 'Mise', 'Créée le', 'Résolue le'].map(h => (
                            <th key={h} style={{
                              padding: '7px 12px', textAlign: 'left', color: '#64748b',
                              fontWeight: 700, fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)',
                              whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.4,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {st.rows.map((p, i) => {
                          const SC = { gagne: '#22c55e', perdu: '#ef4444', en_cours: '#f59e0b', expire: '#64748b' };
                          return (
                            <tr key={p.id} style={{
                              borderBottom: '1px solid rgba(255,255,255,0.035)',
                              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                            }}>
                              <td style={{ padding: '5px 12px', color: '#334155', fontFamily: 'monospace' }}>#{p.id}</td>
                              <td style={{ padding: '5px 12px', fontWeight: 700, color: '#e2e8f0' }}>#{p.game_number}</td>
                              <td style={{ padding: '5px 12px', fontSize: 18 }}>{p.predicted_suit}</td>
                              <td style={{ padding: '5px 12px' }}>
                                <span style={{
                                  fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 700,
                                  background: (SC[p.status] || '#64748b') + '22',
                                  color: SC[p.status] || '#64748b',
                                  border: `1px solid ${SC[p.status] || '#64748b'}44`,
                                }}>{p.status}</span>
                              </td>
                              <td style={{ padding: '5px 12px', color: '#94a3b8' }}>R{p.rattrapage ?? 0}</td>
                              <td style={{ padding: '5px 12px', color: '#60a5fa' }}>{p.mise ?? '—'}</td>
                              <td style={{ padding: '5px 12px', color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>
                                {p.created_at ? new Date(p.created_at).toLocaleString('fr-FR') : '—'}
                              </td>
                              <td style={{ padding: '5px 12px', color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>
                                {p.resolved_at ? new Date(p.resolved_at).toLocaleString('fr-FR') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── ONG 3 : Moteur ── */}
      {activeTab === 'engine' && engine && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
            <StatCard icon="🎮" label="Jeu max traité"  value={`#${engine.maxProcessedGame}`} color="#22c55e" />
            <StatCard icon="🎯" label="Jeu max vu"      value={`#${engine.currentMaxGame}`}   color="#818cf8" />
            <StatCard icon="🧩" label="Stratégies custom" value={engine.customCount}           color="#60a5fa" />
            <StatCard icon="⛔" label="Bloqueurs actifs"
              value={Object.keys(engine.badPredBlocker || {}).length}
              color={Object.keys(engine.badPredBlocker || {}).length > 0 ? '#ef4444' : '#22c55e'}
            />
          </div>

          {/* Prédictions en attente */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              ⏳ Prédictions en attente (pending)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { id: 'C1', val: engine.pendingC1 },
                { id: 'C2', val: engine.pendingC2 },
                { id: 'C3', val: engine.pendingC3 },
                ...Object.entries(engine.pendingCustom || {}).map(([id, val]) => ({ id, val })),
              ].map(({ id, val }) => (
                <div key={id} style={{
                  background: val > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${val > 0 ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 8, padding: '8px 14px', minWidth: 80, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{id}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: val > 0 ? '#fbbf24' : '#334155' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Absences C1/C2/C3 */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              🃏 Absences C1 / C2 / C3
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[['C1', engine.c1Absences], ['C2', engine.c2Absences], ['C3', engine.c3Absences]].map(([id, abs]) => (
                <div key={id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px', minWidth: 180 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>{id}</div>
                  {Object.entries(abs || {}).map(([suit, count]) => (
                    <div key={suit} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{suit}</span>
                      <span style={{ fontWeight: 700, color: count >= 4 ? '#ef4444' : count >= 2 ? '#f59e0b' : '#22c55e' }}>{count}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Bloqueurs actifs */}
          {Object.keys(engine.badPredBlocker || {}).length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
                ⛔ Bloqueurs de mauvaises prédictions actifs
              </div>
              {Object.entries(engine.badPredBlocker).map(([id, b]) => (
                <div key={id} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, color: '#ef4444' }}>{id}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{b.reason}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>Bloqué jusqu'au jeu #{b.blockedUntilGame} • depuis {b.triggeredAt ? new Date(b.triggeredAt).toLocaleTimeString() : '?'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ONG 4 : Courbes de variation par stratégie ── */}
      {activeTab === 'courbes' && (
        <div>

          {/* ── Courbe de variation temporelle ── */}
          <div style={{ marginBottom: 32 }}>
            {/* Titre + contrôles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' }}>
                📉 Courbe de variation — N° prédit (axe Y) / Heure (axe X)
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[12, 24, 48].map(h => (
                  <button key={h} onClick={() => { setTlHours(h); fetchTimeline(h); }} style={{
                    padding: '3px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                    background: tlHours === h ? '#6366f1' : 'rgba(99,102,241,0.12)',
                    color: tlHours === h ? '#fff' : '#818cf8',
                  }}>{h}h</button>
                ))}
                <button onClick={() => fetchTimeline(tlHours)} style={{
                  padding: '3px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                }}>↻</button>
              </div>
              {/* Légende */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[['#22c55e','✅ Gagné'], ['#ef4444','❌ Perdu'], ['#f59e0b','⏳ En cours'], ['#64748b','⏱ Expiré']].map(([c, l]) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: c }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
                    {l}
                  </span>
                ))}
              </div>
            </div>

            {tlLoading ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Chargement de la courbe...</div>
            ) : !timeline?.rows?.length ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Aucune prédiction sur la période sélectionnée</div>
            ) : (() => {
              const rows = timeline.rows;
              const STATUS_C = { gagne: '#22c55e', perdu: '#ef4444', en_cours: '#f59e0b', expire: '#64748b' };
              const nowMs   = Date.now();
              const startMs = nowMs - tlHours * 3600_000;
              const minGame = Math.min(...rows.map(r => r.game_number));
              const maxGame = Math.max(...rows.map(r => r.game_number));
              const gameRange = maxGame - minGame || 1;

              const W = 700, H = 200;
              const PAD = { l: 52, r: 16, t: 12, b: 36 };
              const chartW = W - PAD.l - PAD.r;
              const chartH = H - PAD.t - PAD.b;

              const toX = (tsMs) => PAD.l + ((tsMs - startMs) / (nowMs - startMs)) * chartW;
              const toY = (gn)   => PAD.t + chartH - ((gn - minGame) / gameRange) * chartH;

              // Ticks X (heures)
              const hourTicks = [];
              for (let i = 0; i <= tlHours; i += Math.max(1, Math.floor(tlHours / 8))) {
                const ms = nowMs - (tlHours - i) * 3600_000;
                const d  = new Date(ms);
                hourTicks.push({ ms, label: `${String(d.getHours()).padStart(2,'0')}h` });
              }
              // Ticks Y (game numbers)
              const yStep = Math.max(1, Math.floor(gameRange / 5));
              const yTicks = [];
              for (let g = minGame; g <= maxGame; g += yStep) yTicks.push(g);
              if (!yTicks.includes(maxGame)) yTicks.push(maxGame);

              // Grouper par stratégie pour relier les points
              const byStrat = {};
              for (const r of rows) {
                const s = r.strategy || 'inconnue';
                if (!byStrat[s]) byStrat[s] = [];
                const ms = new Date(r.created_at).getTime();
                byStrat[s].push({ ...r, ms });
              }
              const stratColors = ['#818cf8','#f472b6','#34d399','#fbbf24','#60a5fa','#a78bfa'];
              const stratList   = Object.keys(byStrat);

              return (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 12px', overflowX: 'auto' }}>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 400, height: 'auto' }}>
                    {/* Grilles Y */}
                    {yTicks.map(g => {
                      const y = toY(g);
                      return (
                        <g key={g}>
                          <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                          <text x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#475569">{g}</text>
                        </g>
                      );
                    })}
                    {/* Grilles X (heures) — lignes fines solides */}
                    {hourTicks.map(({ ms, label }) => {
                      const x = toX(ms);
                      return (
                        <g key={ms}>
                          <line x1={x} y1={PAD.t} x2={x} y2={H - PAD.b} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                          <text x={x} y={H - PAD.b + 12} textAnchor="middle" fontSize="9" fill="#475569">{label}</text>
                        </g>
                      );
                    })}
                    {/* Axe X */}
                    <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
                    {/* Axe Y */}
                    <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />

                    {/* Courbes solides par stratégie — bezier cubique lissé */}
                    {stratList.map((s, si) => {
                      const pts = byStrat[s].sort((a,b) => a.ms - b.ms);
                      if (pts.length < 2) return null;
                      const color = stratColors[si % stratColors.length];
                      // Construit un path bezier cubique lissé
                      const coords = pts.map(p => ({ x: toX(p.ms), y: toY(p.game_number) }));
                      let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
                      for (let i = 1; i < coords.length; i++) {
                        const prev = coords[i - 1];
                        const curr = coords[i];
                        const cpx = (prev.x + curr.x) / 2;
                        d += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
                      }
                      // Zone de remplissage sous la courbe (léger)
                      const fillD = d + ` L${coords[coords.length-1].x.toFixed(1)},${(H - PAD.b).toFixed(1)} L${coords[0].x.toFixed(1)},${(H - PAD.b).toFixed(1)} Z`;
                      return (
                        <g key={s}>
                          <path d={fillD} fill={color} fillOpacity="0.06" stroke="none" />
                          <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </g>
                      );
                    })}

                    {/* Points colorés par statut (au-dessus de la ligne) */}
                    {rows.map((r) => {
                      const ms = new Date(r.created_at).getTime();
                      const x  = toX(ms);
                      const y  = toY(r.game_number);
                      const c  = STATUS_C[r.status] || '#64748b';
                      const si = stratList.indexOf(r.strategy || 'inconnue');
                      const sc = stratColors[si >= 0 ? si % stratColors.length : 0];
                      return (
                        <g key={r.id}>
                          {/* Halo extérieur couleur stratégie */}
                          <circle cx={x} cy={y} r="6" fill={sc} fillOpacity="0.15" stroke="none" />
                          {/* Point couleur statut */}
                          <circle cx={x} cy={y} r="4" fill={c} stroke="#0d1117" strokeWidth="1.5" />
                          <title>{r.strategy} · Jeu #{r.game_number} · {r.predicted_suit} · {r.status} · {new Date(r.created_at).toLocaleTimeString('fr-FR')}</title>
                        </g>
                      );
                    })}

                    {/* Label axe Y */}
                    <text x={10} y={H / 2} textAnchor="middle" fontSize="9" fill="#64748b"
                      transform={`rotate(-90, 10, ${H / 2})`}>N° jeu prédit</text>
                    {/* Label axe X */}
                    <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="#64748b">Heure</text>
                  </svg>

                  {/* Légende stratégies */}
                  {stratList.length > 1 && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                      {stratList.map((s, si) => (
                        <span key={s} style={{ fontSize: 10, color: stratColors[si % stratColors.length], display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 14, height: 2, background: stratColors[si % stratColors.length], display: 'inline-block', opacity: 0.5 }} />
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#334155', marginTop: 6 }}>
                    {rows.length} prédiction(s) sur {tlHours}h — survol d'un point pour détails
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Résumé fichiers projet */}
          {data?.fileSizeStats && data.fileSizeStats.count > 0 && (
            <div style={{
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 12, padding: '14px 20px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 24,
            }}>
              <span style={{ fontSize: 22 }}>📁</span>
              <div>
                <div style={{ fontWeight: 800, color: '#818cf8', fontSize: 14 }}>Fichiers projet en base</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {data.fileSizeStats.count} fichier(s) •{' '}
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>
                    {data.fileSizeStats.totalKb < 1024
                      ? `${data.fileSizeStats.totalKb} KB`
                      : `${(data.fileSizeStats.totalKb / 1024).toFixed(1)} MB`}
                  </span>{' '}
                  au total
                </div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            📈 Taux de gain par stratégie — 7 derniers jours
          </div>

          {(!data?.strategyStats || data.strategyStats.length === 0) ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 60 }}>Aucune donnée de prédiction sur les 7 derniers jours</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
              {data.strategyStats.map(st => {
                const maxTotal = Math.max(...st.days.map(d => d.total), 1);
                const winRate = st.winRate;
                const winColor = winRate == null ? '#475569' : winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ef4444';
                return (
                  <div key={st.strategy} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 14, padding: '18px 20px',
                  }}>
                    {/* Titre stratégie */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, color: '#818cf8' }}>{st.strategy}</div>
                      <div style={{
                        fontSize: 20, fontWeight: 900, color: winColor,
                        background: winColor + '18', border: `1px solid ${winColor}33`,
                        borderRadius: 8, padding: '2px 10px',
                      }}>
                        {winRate != null ? `${winRate}%` : 'N/A'}
                      </div>
                    </div>

                    {/* Totaux */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                      {[
                        { l: '✅ Gain', v: st.totals.gagne, c: '#22c55e' },
                        { l: '❌ Perte', v: st.totals.perdu, c: '#ef4444' },
                        { l: '⏱ Expiré', v: st.totals.expire, c: '#64748b' },
                        { l: 'Total', v: st.totals.total, c: '#818cf8' },
                      ].map(({ l, v, c }) => (
                        <div key={l} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: '#475569', fontWeight: 700 }}>{l}</div>
                          <div style={{ fontSize: 17, fontWeight: 900, color: c }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Courbe SVG */}
                    <div>
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Prédictions / jour (7j)
                      </div>
                      <svg viewBox="0 0 280 60" style={{ width: '100%', height: 60 }}>
                        {/* Lignes de grille */}
                        {[0, 20, 40, 60].map(y => (
                          <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                        ))}
                        {/* Barres gagnées */}
                        {st.days.map((d, i) => {
                          const w = 280 / st.days.length;
                          const xOff = i * w + 4;
                          const bw = Math.max(w - 8, 4);
                          const totalH = maxTotal > 0 ? (d.total / maxTotal) * 52 : 0;
                          const gagneH = maxTotal > 0 ? (d.gagne / maxTotal) * 52 : 0;
                          return (
                            <g key={i}>
                              {/* Barre totale (gris foncé) */}
                              <rect x={xOff} y={60 - totalH} width={bw} height={totalH}
                                fill="rgba(99,102,241,0.25)" rx="2" />
                              {/* Barre gagnée (vert) */}
                              <rect x={xOff} y={60 - gagneH} width={bw} height={gagneH}
                                fill="rgba(34,197,94,0.6)" rx="2" />
                            </g>
                          );
                        })}
                      </svg>
                      {/* Labels jours */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                        {st.days.map((d, i) => (
                          <div key={i} style={{ fontSize: 9, color: '#334155', textAlign: 'center' }}>
                            {new Date(d.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ONG 5 : Bots hébergés ── */}
      {activeTab === 'bots' && (
        <div>
          {(data?.bots || []).length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 60 }}>Aucun bot hébergé</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {(data.bots || []).map(bot => (
                <div key={bot.id} style={{
                  background: 'rgba(255,255,255,0.03)', border: `1px solid ${bot.status === 'running' ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 14, padding: '18px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 20 }}>{bot.language === 'node' ? '🟨' : '🐍'}</span>
                    <div>
                      <div style={{ fontWeight: 800, color: '#e2e8f0' }}>{bot.name}</div>
                      <div style={{ fontSize: 11, color: '#475569' }}>#{bot.id} • {bot.language}</div>
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                      <span style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700,
                        background: bot.status === 'running' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.15)',
                        color: bot.status === 'running' ? '#22c55e' : '#ef4444',
                        border: `1px solid ${bot.status === 'running' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.3)'}`,
                      }}>
                        {bot.status === 'running' ? '● En cours' : '○ Arrêté'}
                      </span>
                    </div>
                  </div>
                  {bot.is_prediction_bot && (
                    <div style={{ fontSize: 11, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: '4px 10px', marginBottom: 8, color: '#22c55e' }}>
                      🎯 Bot de prédiction auto {bot.auto_strategy_id ? `• Stratégie S${bot.auto_strategy_id}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#475569' }}>
                    Créé : {bot.created_at ? new Date(bot.created_at).toLocaleDateString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ONG 5 : Santé système ── */}
      {activeTab === 'health' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <button
              onClick={checkHealth}
              disabled={loadingHealth}
              style={{
                padding: '12px 28px', borderRadius: 12, border: 'none', cursor: loadingHealth ? 'wait' : 'pointer',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontWeight: 800, fontSize: 14, opacity: loadingHealth ? 0.7 : 1,
                boxShadow: '0 4px 20px rgba(34,197,94,0.3)',
              }}
            >
              {loadingHealth ? '⏳ Vérification...' : '🩺 Vérifier l\'état du site'}
            </button>
            {health && (
              <div>
                <Badge status={health.ok ? 'ok' : 'error'} />
                <span style={{ fontSize: 11, color: '#475569', marginLeft: 10 }}>
                  Vérifié : {new Date(health.time).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>

          {health?.checks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
              {health.checks.map((check, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, padding: '14px 18px',
                  borderLeft: `3px solid ${STATUS_COLOR[check.status] || '#475569'}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{check.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{check.detail}</div>
                  </div>
                  <Badge status={check.status} />
                </div>
              ))}
            </div>
          )}

          {!health && !loadingHealth && (
            <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>
              Cliquez sur "Vérifier l'état du site" pour lancer le diagnostic.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
