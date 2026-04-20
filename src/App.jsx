import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

const Home          = lazy(() => import('./pages/Home'));
const Login         = lazy(() => import('./pages/Login'));
const Register      = lazy(() => import('./pages/Register'));
const StrategySelect = lazy(() => import('./pages/StrategySelect'));
const Dashboard     = lazy(() => import('./pages/Dashboard'));
const Admin         = lazy(() => import('./pages/Admin'));
const TelegramFeed  = lazy(() => import('./pages/TelegramFeed'));
const Programmation = lazy(() => import('./pages/Programmation'));
const SystemLogs    = lazy(() => import('./pages/SystemLogs'));

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

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/connexion" replace />;
  if (adminOnly && !user.is_admin) return <Navigate to="/choisir" replace />;
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
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/connexion" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/inscription" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/choisir" element={<ProtectedRoute><StrategySelect /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Navigate to="/choisir" replace /></ProtectedRoute>} />
            <Route path="/dashboard/:strategy" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
            <Route path="/canal-telegram" element={<ProtectedRoute><TelegramFeed /></ProtectedRoute>} />
            <Route path="/programmation" element={<Programmation />} />
            <Route path="/system-logs" element={<ProtectedRoute adminOnly><SystemLogs /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
