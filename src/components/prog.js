const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const fetch   = require('node-fetch');
const db      = require('./db');
const router  = express.Router();

const PROG_EMAIL    = 'admin';
const PROG_PASSWORD = 'prog2026';

const EXCLUDED_DIRS  = ['node_modules', 'dist', '.git', '.local', '.cache', '.npm', '.upm'];
const EXCLUDED_FILES = ['.env'];
const INCLUDED_EXTS  = ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.md', '.txt', '.sh', '.cjs', '.mjs'];
const MAX_FILE_SIZE  = 500 * 1024;
const ROOT           = path.join(__dirname);

// ── Ollama — URL locale ────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

async function ollamaVerify() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, error: `Ollama répond HTTP ${r.status}`, running: false };
    const d = await r.json();
    const models = (d.models || []).map(m => m.name);
    return {
      ok: true,
      running: true,
      models,
      info: {
        modèles_installés: models.length,
        url: OLLAMA_BASE,
        statut: 'En ligne ✓',
      },
    };
  } catch (e) {
    return {
      ok: false,
      running: false,
      error: 'Ollama n\'est pas démarré sur ce serveur.',
      installSteps: [
        'curl -fsSL https://ollama.com/install.sh | sh',
        'ollama serve &',
        'ollama pull llama3',
      ],
    };
  }
}

// ── Liste des API IA gratuites supportées ─────────────────────────────────────

const AI_APIS = [
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    badge: 'Fallback · Aucune clé',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #059669, #10b981)',
    icon: '🦙',
    isLocal: true,
    noKeyRequired: true,
    description: 'Modèles IA en local sur ce serveur. Aucune clé API requise. Utilisé automatiquement si aucune autre clé n\'est configurée.',
    site: 'https://ollama.com',
    keyFormat: '(aucune clé nécessaire)',
    freeModels: ['llama3', 'mistral', 'gemma', 'phi3', 'qwen2', 'deepseek-r1'],
    rateLimit: '100% gratuit · illimité · local · privé',
    verify: ollamaVerify,
  },
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Ultra-rapide',
    color: '#f55036',
    gradient: 'linear-gradient(135deg, #f55036, #ff8c69)',
    icon: '⚡',
    description: 'Inférence ultra-rapide grâce au matériel LPU. Tier gratuit généreux.',
    site: 'https://console.groq.com',
    keyFormat: 'gsk_...',
    freeModels: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'gemma2-9b-it', 'llama-3.2-11b-vision-preview'],
    rateLimit: '30 req/min · 14 400 req/jour · gratuit',
    verify: async (key) => {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      const models = (d.data || []).map(m => m.id);
      return { ok: true, models, info: { totalModels: models.length, org: d.object || 'groq' } };
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'Multi-modèles',
    color: '#7c3aed',
    gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
    icon: '🔀',
    description: 'Accès unifié à des centaines de modèles dont plusieurs entièrement gratuits.',
    site: 'https://openrouter.ai',
    keyFormat: 'sk-or-v1-...',
    freeModels: ['meta-llama/llama-3-8b-instruct:free', 'google/gemma-7b-it:free', 'mistralai/mistral-7b-instruct:free', 'openchat/openchat-7b:free'],
    rateLimit: '20 req/min · modèles :free illimités',
    verify: async (key) => {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://baccarat.pro' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      const allModels = (d.data || []).map(m => m.id);
      const freeModels = allModels.filter(m => m.includes(':free'));
      return { ok: true, models: freeModels.slice(0, 10), info: { totalModels: allModels.length, freeModels: freeModels.length } };
    },
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    badge: 'Français',
    color: '#ff7000',
    gradient: 'linear-gradient(135deg, #ff7000, #ffb347)',
    icon: '🌬️',
    description: 'Modèles français haute performance. Excellent pour le code et le raisonnement.',
    site: 'https://console.mistral.ai',
    keyFormat: '...',
    freeModels: ['open-mistral-7b', 'open-mixtral-8x7b', 'open-mistral-nemo'],
    rateLimit: '1 req/s · 500 000 tokens/mois gratuits',
    verify: async (key) => {
      const r = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      const models = (d.data || []).map(m => m.id);
      return { ok: true, models, info: { totalModels: models.length, provider: 'Mistral AI' } };
    },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Google',
    color: '#4285f4',
    gradient: 'linear-gradient(135deg, #4285f4, #34a853)',
    icon: '✨',
    description: 'Modèles Gemini de Google. Gemini Flash est gratuit avec un quota élevé.',
    site: 'https://aistudio.google.com',
    keyFormat: 'AIza...',
    freeModels: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.0-pro'],
    rateLimit: '15 req/min · 1 500 req/jour · gratuit',
    verify: async (key) => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      const models = (d.models || []).map(m => m.name.replace('models/', ''));
      return { ok: true, models, info: { totalModels: models.length, provider: 'Google' } };
    },
  },
  {
    id: 'cohere',
    name: 'Cohere',
    badge: 'NLP Expert',
    color: '#39594d',
    gradient: 'linear-gradient(135deg, #39594d, #52b788)',
    icon: '🧠',
    description: 'Spécialiste du NLP et de la génération de texte. Trial key gratuite.',
    site: 'https://dashboard.cohere.com',
    keyFormat: '...',
    freeModels: ['command-light', 'command-r', 'command-r-plus'],
    rateLimit: '5 req/min · 1 000 req/mois gratuits (trial)',
    verify: async (key) => {
      const r = await fetch('https://api.cohere.com/v1/check-api-key', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, models: ['command-light', 'command-r', 'command-r-plus'], info: { valid: d.valid, plan: 'trial' } };
    },
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    badge: 'Open Source',
    color: '#ff9a00',
    gradient: 'linear-gradient(135deg, #ff9a00, #ffd166)',
    icon: '🤗',
    description: 'Accès à des milliers de modèles open source via l\'Inference API.',
    site: 'https://huggingface.co/settings/tokens',
    keyFormat: 'hf_...',
    freeModels: ['mistralai/Mistral-7B-Instruct-v0.2', 'meta-llama/Meta-Llama-3-8B-Instruct', 'google/gemma-7b-it'],
    rateLimit: 'Gratuit avec limites · Pro: illimité',
    verify: async (key) => {
      const r = await fetch('https://huggingface.co/api/whoami', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: true, models: ['mistralai/Mistral-7B-Instruct-v0.2', 'meta-llama/Meta-Llama-3-8B-Instruct'], info: { username: d.name || d.fullname, plan: d.isPro ? 'Pro' : 'Gratuit', orgs: (d.orgs || []).length } };
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    badge: '$25 gratuits',
    color: '#5b8dd9',
    gradient: 'linear-gradient(135deg, #5b8dd9, #93c5fd)',
    icon: '🤝',
    description: '$25 de crédits gratuits à l\'inscription. Large choix de modèles open source.',
    site: 'https://api.together.xyz',
    keyFormat: '...',
    freeModels: ['meta-llama/Llama-3-8b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'google/gemma-7b-it'],
    rateLimit: '$25 crédits offerts · Paiement ensuite',
    verify: async (key) => {
      const r = await fetch('https://api.together.xyz/v1/models', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const d = await r.json();
      const models = Array.isArray(d) ? d.map(m => m.id).slice(0, 8) : [];
      return { ok: true, models, info: { totalModels: Array.isArray(d) ? d.length : 0 } };
    },
  },
];

// ── Middleware ─────────────────────────────────────────────────────────────────

function requireProg(req, res, next) {
  if (!req.session?.progAuth) return res.status(401).json({ error: 'Authentification programmation requise' });
  next();
}

// ── Scanner de fichiers ────────────────────────────────────────────────────────

function scanFiles(dir, base) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relPath  = base ? `${base}/${entry}` : entry;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push({ name: entry, path: relPath, type: 'dir', children: scanFiles(fullPath, relPath) });
    } else if (stat.isFile()) {
      if (EXCLUDED_FILES.includes(entry)) continue;
      const ext = path.extname(entry).toLowerCase();
      if (!INCLUDED_EXTS.includes(ext)) continue;
      if (stat.size > MAX_FILE_SIZE) continue;
      results.push({ name: entry, path: relPath, type: 'file', size: stat.size, ext });
    }
  }
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

router.post('/auth', (req, res) => {
  const { email, password } = req.body;
  const emailMatch = email === PROG_EMAIL;
  const passMatch  = password === PROG_PASSWORD;
  console.log(`[Prog Auth] email reçu: "${email}" (${emailMatch ? '✓' : `✗ attendu: "${PROG_EMAIL}"`}) | mdp: ${passMatch ? '✓' : `✗ (longueur: ${(password||'').length})`}`);
  if (emailMatch && passMatch) {
    req.session.progAuth = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Identifiants incorrects' });
});

router.post('/logout', (req, res) => {
  req.session.progAuth = false;
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  res.json({ auth: !!req.session?.progAuth });
});

// ── Fichiers ───────────────────────────────────────────────────────────────────

router.get('/files', requireProg, (req, res) => {
  try {
    const tree = scanFiles(ROOT, '');
    res.json(tree);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/file', requireProg, (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'Chemin requis' });
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT)) return res.status(403).json({ error: 'Accès refusé' });
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ content, path: rel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/file', requireProg, (req, res) => {
  try {
    const { path: rel, content } = req.body;
    if (!rel || content === undefined) return res.status(400).json({ error: 'Chemin et contenu requis' });
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT)) return res.status(403).json({ error: 'Accès refusé' });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, path: rel, size: Buffer.byteLength(content, 'utf8') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Exécution ──────────────────────────────────────────────────────────────────

router.post('/exec', requireProg, (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ error: 'Code vide' });
    let output = '';
    let errOut = '';
    const proc = spawn('node', ['-e', code], {
      cwd: ROOT,
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
      timeout: 8000,
    });
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { errOut += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      res.json({ output: output || '', error: 'Timeout — exécution dépassée (8s)', exitCode: -1 });
    }, 8500);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (res.headersSent) return;
      res.json({ output: output || '', error: errOut || null, exitCode: code });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API IA — Liste ─────────────────────────────────────────────────────────────

router.get('/ai-apis', requireProg, (req, res) => {
  const list = AI_APIS.map(a => ({
    id: a.id, name: a.name, badge: a.badge, color: a.color, gradient: a.gradient,
    icon: a.icon, description: a.description, site: a.site, keyFormat: a.keyFormat,
    freeModels: a.freeModels, rateLimit: a.rateLimit,
    isLocal: !!a.isLocal, noKeyRequired: !!a.noKeyRequired,
  }));
  res.json(list);
});

// ── API IA — API active (fallback Ollama si aucune clé) ───────────────────────

router.get('/ai-active', requireProg, async (req, res) => {
  try {
    const raw = await db.getSetting('prog_ai_keys');
    const keys = raw ? JSON.parse(raw) : {};
    const savedIds = Object.keys(keys);
    if (savedIds.length > 0) {
      const firstId = savedIds[0];
      const api = AI_APIS.find(a => a.id === firstId);
      return res.json({ activeId: firstId, apiName: keys[firstId]?.apiName || firstId, fallback: false, source: 'saved_key', api: api ? { id: api.id, name: api.name, icon: api.icon, color: api.color, badge: api.badge } : null });
    }
    // Aucune clé → fallback Ollama
    const ollamaStatus = await ollamaVerify();
    return res.json({
      activeId: 'ollama',
      apiName: 'Ollama (Local)',
      fallback: true,
      source: 'ollama_fallback',
      ollamaRunning: ollamaStatus.running || false,
      ollamaModels: ollamaStatus.models || [],
      ollamaError: ollamaStatus.error || null,
      installSteps: ollamaStatus.installSteps || null,
      api: { id: 'ollama', name: 'Ollama (Local)', icon: '🦙', color: '#10b981', badge: 'Fallback local' },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API IA — Vérifier une clé ──────────────────────────────────────────────────

router.post('/ai-verify', requireProg, async (req, res) => {
  const { apiId, key } = req.body;
  if (!apiId) return res.status(400).json({ error: 'apiId requis' });
  const api = AI_APIS.find(a => a.id === apiId);
  if (!api) return res.status(404).json({ error: 'API inconnue' });
  try {
    // Ollama ne nécessite pas de clé
    const result = api.noKeyRequired ? await api.verify() : await api.verify((key || '').trim());
    res.json({ ...result, apiId, apiName: api.name });
  } catch (e) {
    res.json({ ok: false, error: e.message, apiId, apiName: api.name });
  }
});

// ── API IA — Sauvegarder une clé ──────────────────────────────────────────────

router.post('/ai-save', requireProg, async (req, res) => {
  const { apiId, key } = req.body;
  if (!apiId) return res.status(400).json({ error: 'apiId requis' });
  const api = AI_APIS.find(a => a.id === apiId);
  if (!api) return res.status(404).json({ error: 'API inconnue' });
  try {
    const raw = await db.getSetting('prog_ai_keys');
    const keys = raw ? JSON.parse(raw) : {};
    keys[apiId] = { key: key.trim(), savedAt: new Date().toISOString(), apiName: api.name };
    await db.setSetting('prog_ai_keys', JSON.stringify(keys));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API IA — Récupérer les clés sauvegardées (masquées) ───────────────────────

router.get('/ai-keys', requireProg, async (req, res) => {
  try {
    const raw = await db.getSetting('prog_ai_keys');
    const keys = raw ? JSON.parse(raw) : {};
    const masked = {};
    for (const [id, val] of Object.entries(keys)) {
      const k = val.key || '';
      masked[id] = {
        apiName: val.apiName,
        savedAt: val.savedAt,
        masked: k.length > 8 ? k.slice(0, 4) + '••••••••' + k.slice(-4) : '••••••••',
        hasKey: true,
      };
    }
    res.json(masked);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API IA — Supprimer une clé ────────────────────────────────────────────────

router.delete('/ai-keys/:apiId', requireProg, async (req, res) => {
  try {
    const { apiId } = req.params;
    const raw = await db.getSetting('prog_ai_keys');
    const keys = raw ? JSON.parse(raw) : {};
    delete keys[apiId];
    await db.setSetting('prog_ai_keys', JSON.stringify(keys));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BOTS HORS PROJET — CRUD ───────────────────────────────────────────────────

router.get('/bots', requireProg, async (req, res) => {
  try {
    const raw = await db.getSetting('prog_bots');
    const bots = raw ? JSON.parse(raw) : {};
    const list = Object.values(bots).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/bots', requireProg, async (req, res) => {
  const { id, name, description, code, lang } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const raw = await db.getSetting('prog_bots');
    const bots = raw ? JSON.parse(raw) : {};
    const botId = id || `bot_${Date.now()}`;
    bots[botId] = {
      id: botId, name: name.trim(),
      description: description || '',
      code: code || '',
      lang: lang || 'js',
      createdAt: bots[botId]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.setSetting('prog_bots', JSON.stringify(bots));
    res.json({ ok: true, bot: bots[botId] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bots/:id', requireProg, async (req, res) => {
  try {
    const raw = await db.getSetting('prog_bots');
    const bots = raw ? JSON.parse(raw) : {};
    delete bots[req.params.id];
    await db.setSetting('prog_bots', JSON.stringify(bots));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API IA — Chat / Génération de code ───────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant de développement expert. Tu réponds toujours en français.
Quand tu génères du code, tu utilises des blocs markdown avec le langage (ex: \`\`\`js ... \`\`\`).
Tu es concis, précis et tu expliques brièvement ce que tu as généré.`;

async function callAiApi(apiId, key, messages) {
  // ── OpenAI-compatible (Groq, OpenRouter, Mistral, Together) ────────
  const openAiApis = {
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',         model: 'llama-3.1-8b-instant' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',           model: 'meta-llama/llama-3-8b-instruct:free' },
    mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',              model: 'open-mistral-7b' },
    together:   { url: 'https://api.together.xyz/v1/chat/completions',            model: 'meta-llama/Llama-3-8b-chat-hf' },
  };

  if (openAiApis[apiId]) {
    const { url, model } = openAiApis[apiId];
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    if (apiId === 'openrouter') headers['HTTP-Referer'] = 'https://baccarat.pro';
    const r = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.7 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`${apiId} HTTP ${r.status}: ${e.slice(0,200)}`); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '(réponse vide)';
  }

  // ── Google Gemini ─────────────────────────────────────────────────
  if (apiId === 'gemini') {
    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const systemInstruction = messages.find(m => m.role === 'system');
    const body = { contents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`Gemini HTTP ${r.status}: ${e.slice(0,200)}`); }
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '(réponse vide)';
  }

  // ── Cohere ────────────────────────────────────────────────────────
  if (apiId === 'cohere') {
    const userMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
    const chatHistory = messages.filter(m => m.role !== 'system').slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content,
    }));
    const r = await fetch('https://api.cohere.com/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'command-r', message: userMsg, chat_history: chatHistory, preamble: SYSTEM_PROMPT }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`Cohere HTTP ${r.status}: ${e.slice(0,200)}`); }
    const d = await r.json();
    return d.text || '(réponse vide)';
  }

  // ── Hugging Face ──────────────────────────────────────────────────
  if (apiId === 'huggingface') {
    const model = 'mistralai/Mistral-7B-Instruct-v0.2';
    const prompt = messages.map(m => `${m.role === 'user' ? '[INST]' : ''}${m.content}${m.role === 'user' ? '[/INST]' : ''}`).join('\n');
    const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 1024, return_full_text: false } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`HuggingFace HTTP ${r.status}: ${e.slice(0,200)}`); }
    const d = await r.json();
    return Array.isArray(d) ? d[0]?.generated_text || '(réponse vide)' : d.generated_text || JSON.stringify(d);
  }

  // ── Ollama (local) ─────────────────────────────────────────────────
  if (apiId === 'ollama') {
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_DEFAULT_MODEL || 'phi3:mini', messages, stream: false }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`Ollama HTTP ${r.status}: ${e.slice(0,200)}`); }
    const d = await r.json();
    return d.message?.content || '(réponse vide)';
  }

  throw new Error(`API "${apiId}" non supportée pour le chat`);
}

router.post('/ai-chat', requireProg, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message vide' });

  try {
    // Récupérer la clé active
    const raw = await db.getSetting('prog_ai_keys');
    const savedKeys = raw ? JSON.parse(raw) : {};
    const savedIds = Object.keys(savedKeys);

    let apiId, apiKey, apiName;

    if (savedIds.length > 0) {
      apiId   = savedIds[0];
      apiKey  = savedKeys[apiId].key;
      apiName = savedKeys[apiId].apiName || apiId;
    } else {
      // Vérifier si Ollama est disponible avant de l'utiliser
      let ollamaOk = false;
      try {
        const test = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
        ollamaOk = test.ok;
      } catch (_) { ollamaOk = false; }

      if (!ollamaOk) {
        return res.json({
          ok: false,
          noKey: true,
          error: "Aucune clé API configurée et Ollama n'est pas disponible dans cet environnement. Cliquez sur \"🤖 Config IA\" pour ajouter gratuitement une clé Groq, Gemini ou autre.",
        });
      }
      apiId   = 'ollama';
      apiKey  = '';
      apiName = 'Ollama (Local)';
    }

    // Construire les messages
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-10),
      { role: 'user', content: message.trim() },
    ];

    const reply = await callAiApi(apiId, apiKey, messages);
    res.json({ ok: true, reply, apiId, apiName });
  } catch (e) {
    const msg = e.message || '';
    const friendly = msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
      ? 'Impossible de joindre l\'API. Vérifiez votre clé dans "🤖 Config IA" ou ajoutez une nouvelle clé.'
      : msg;
    res.json({ ok: false, error: friendly });
  }
});

module.exports = router;
