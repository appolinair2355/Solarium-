import { useEffect, lazy, Suspense, Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import LanguageSwitcher from './components/LanguageSwitcher';

function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const msg = String(err?.message || '');
      const isChunkError =
        err?.name === 'ChunkLoadError' ||
        /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg);
      if (isChunkError && typeof window !== 'undefined') {
        const KEY = '__chunk_reload_ts';
        const last = parseInt(sessionStorage.getItem(KEY) || '0', 10);
        const now = Date.now();
        if (now - last > 30000) {
          sessionStorage.setItem(KEY, String(now));
          const url = new URL(window.location.href);
          url.searchParams.set('_v', String(now));
          window.location.replace(url.toString());
          return { default: () => null };
        }
      }
      throw err;
    }
  });
}

const Home          = lazyWithRetry(() => import('./pages/Home'));
const Login         = lazyWithRetry(() => import('./pages/Login'));
const Register      = lazyWithRetry(() => import('./pages/Register'));
const StrategySelect = lazyWithRetry(() => import('./pages/StrategySelect'));
const Dashboard     = lazyWithRetry(() => import('./pages/Dashboard'));
const Admin         = lazyWithRetry(() => import('./pages/Admin'));
const Programmation = lazyWithRetry(() => import('./pages/Programmation'));
const SystemLogs    = lazyWithRetry(() => import('./pages/SystemLogs'));
const Comptages     = lazyWithRetry(() => import('./pages/Comptages'));
const Payment       = lazyWithRetry(() => import('./pages/Payment'));
const Shop          = lazyWithRetry(() => import('./pages/Shop'));

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    const msg = String(error?.message || '');
    const isChunkError =
      error?.name === 'ChunkLoadError' ||
      /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg);
    if (isChunkError && typeof window !== 'undefined') {
      const KEY = '__chunk_reload_ts';
      const last = parseInt(sessionStorage.getItem(KEY) || '0', 10);
      const now = Date.now();
      if (now - last > 30000) {
        sessionStorage.setItem(KEY, String(now));
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.set('_v', String(now));
          window.location.replace(url.toString());
        }, 200);
      }
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 24,
          background: '#0b0b14', color: '#e2e8f0', textAlign: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 48 }}>🔄</div>
          <h2 style={{ margin: 0, color: '#fbbf24' }}>Mise à jour en cours…</h2>
          <p style={{ margin: 0, maxWidth: 420, color: '#94a3b8' }}>
            Une nouvelle version de l'application est disponible.
            Cliquez sur le bouton ci-dessous pour la charger.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => {
                try { sessionStorage.removeItem('__chunk_reload_ts'); } catch {}
                const url = new URL(window.location.href);
                url.searchParams.set('_v', String(Date.now()));
                window.location.replace(url.toString());
              }}
              style={{
                padding: '12px 28px', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontSize: 15, fontWeight: 700,
                background: 'linear-gradient(135deg,#92400e,#fbbf24)', color: '#fff',
              }}>
              Recharger l'application
            </button>
            <button
              onClick={() => {
                try { sessionStorage.clear(); localStorage.clear(); } catch {}
                window.location.replace('/');
              }}
              style={{
                padding: '12px 28px', borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.3)',
                cursor: 'pointer', fontSize: 15, fontWeight: 700,
                background: 'transparent', color: '#cbd5e1',
              }}>
              Retour à l'accueil
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="loader-screen">
      <div className="spinner" />
    </div>
  );
}

function useUiStyles() {
  useEffect(() => {
    fetch('/api/settings/ui-styles')
      .then(r => r.ok ? r.json() : {})
      .then(styles => {
        for (const [key, val] of Object.entries(styles)) {
          if (key.startsWith('--')) {
            document.documentElement.style.setProperty(key, val);
          }
        }
      })
      .catch(() => {});
  }, []);
}

function ProtectedRoute({ children, adminOnly = false, adminOrPro = false, adminProOrPremium = false }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/connexion" replace />;
  if (!user.is_admin && user.status === 'expired') return <Navigate to="/paiement" replace />;
  if (!user.is_admin && user.status === 'pending') return <Navigate to="/choisir" replace />;
  if (adminOnly && !user.is_admin) return <Navigate to="/choisir" replace />;
  if (adminOrPro && !user.is_admin && !user.is_pro) return <Navigate to="/choisir" replace />;
  if (adminProOrPremium && !user.is_admin && !user.is_pro && !user.is_premium) return <Navigate to="/choisir" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/choisir" replace />;
  return children;
}

export default function App() {
  useUiStyles();
  return (
    <AppErrorBoundary>
    <LanguageProvider>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <div className="lang-switcher-floating">
            <LanguageSwitcher compact={false} />
          </div>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/connexion" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/inscription" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/choisir" element={<ProtectedRoute><StrategySelect /></ProtectedRoute>} />
            <Route path="/paiement" element={<ProtectedRoute><Payment /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Navigate to="/choisir" replace /></ProtectedRoute>} />
            <Route path="/dashboard/:strategy" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute adminOrPro><Admin /></ProtectedRoute>} />
            <Route path="/programmation" element={<Programmation />} />
            <Route path="/system-logs" element={<ProtectedRoute adminOrPro><SystemLogs /></ProtectedRoute>} />
            <Route path="/comptages" element={<ProtectedRoute adminProOrPremium><Comptages /></ProtectedRoute>} />
            <Route path="/boutique" element={<ProtectedRoute><Shop /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </LanguageProvider>
    </AppErrorBoundary>
  );
}
