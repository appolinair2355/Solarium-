import { createContext, useContext, useState, useEffect, useRef } from 'react';

const AuthContext = createContext(null);

const XBET_URL = 'https://1xbet.com/service-api/LiveFeed/GetSportsShortZip?' +
  'sports=236&champs=2050671&lng=en&gr=285&country=96&virtualSports=true&groupChamps=true';

async function fetchWithRetry(url, opts, retries = 3, delay = 1200) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok) return r.json();
      if (r.status === 401) return null;
      return null;
    } catch {
      if (i < retries) await new Promise(res => setTimeout(res, delay));
    }
  }
  return null;
}

// Relay : le navigateur récupère 1xBet et envoie au serveur
async function relayGames() {
  try {
    const resp = await fetch(XBET_URL, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return;
    const data = await resp.json();
    await fetch('/api/games/client-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* CORS ou réseau — on réessaiera dans 5s */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const relayRef = useRef(null);

  useEffect(() => {
    fetchWithRetry('/api/auth/me', { credentials: 'include' })
      .then(data => { if (data) setUser(data); })
      .finally(() => setLoading(false));
  }, []);

  // Relay 1xBet actif dès que l'utilisateur est connecté
  // Le navigateur fetch 1xBet et relaie au serveur — fonctionne même si le serveur est bloqué
  useEffect(() => {
    if (!user) {
      if (relayRef.current) { clearInterval(relayRef.current); relayRef.current = null; }
      return;
    }
    relayGames();
    relayRef.current = setInterval(relayGames, 1500);
    return () => { if (relayRef.current) clearInterval(relayRef.current); };
  }, [user]);

  const login = async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  const register = async (username, email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur d'inscription");
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
