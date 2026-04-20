import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import StrategySelect from './pages/StrategySelect';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import TelegramFeed from './pages/TelegramFeed';
import Programmation from './pages/Programmation';
import SystemLogs from './pages/SystemLogs';

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
  if (loading) return <div className="loader-screen"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/connexion" replace />;
  if (adminOnly && !user.is_admin) return <Navigate to="/choisir" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loader-screen"><div className="spinner" /></div>;
  if (user) return <Navigate to="/choisir" replace />;
  return children;
}

export default function App() {
  useUiStyles();
  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  );
}
