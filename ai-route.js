'use strict';
/**
 * ai-route.js — Routes pour la configuration IA et le système de réparation automatique
 * Fournit :
 *   - Configuration des APIs IA gratuites (Groq, Mistral, Gemini, Cohere, Together)
 *   - Diagnostic et réparation automatique du moteur de prédiction
 *   - Pré-vérification des fichiers de bot avant déploiement
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

// ── Providers IA gratuits disponibles ────────────────────────────────────────
const AI_PROVIDERS = [
  {
    id: 'groq', name: 'Groq — Llama 3.1 (Gratuit & Ultra-rapide)',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant', type: 'openai',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'together', name: 'Together AI — Llama 3.3 70B (Crédits gratuits)',
    url: 'https://api.together.xyz/v1/chat/completions',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', type: 'openai',
    keyUrl: 'https://api.together.xyz/',
  },
  {
    id: 'mistral', name: 'Mistral AI — Mistral Small (Gratuit)',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest', type: 'openai',
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'gemini', name: 'Google Gemini 1.5 Flash (Gratuit)',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    model: 'gemini-1.5-flash', type: 'gemini',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'cohere', name: 'Cohere — Command R (Gratuit)',
    url: 'https://api.cohere.ai/v2/chat',
    model: 'command-r', type: 'cohere',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'huggingface', name: 'HuggingFace — Inference API (Gratuit)',
    url: 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
    model: 'mistralai/Mistral-7B-Instruct-v0.2', type: 'huggingface',
    keyUrl: 'https://huggingface.co/settings/tokens',
  },
];

// ── Middleware super admin ────────────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  if (!req.session?.userId)  return res.status(401).json({ error: 'Non connecté' });
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  if ((req.session.adminLevel || 2) !== 1) return res.status(403).json({ error: 'Super admin requis' });
  next();
}

// ── Liste des providers ───────────────────────────────────────────────────────
router.get('/providers', requireSuperAdmin, (req, res) => {
  res.json({ providers: AI_PROVIDERS.map(p => ({ id: p.id, name: p.name, model: p.model, keyUrl: p.keyUrl })) });
});

// ── Config actuelle ───────────────────────────────────────────────────────────
router.get('/config', requireSuperAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('ai_config');
    if (!raw) return res.json({ provider: null, hasKey: false });
    const cfg = JSON.parse(raw);
    res.json({ provider: cfg.provider, hasKey: !!cfg.key });
  } catch { res.json({ provider: null, hasKey: false }); }
});

// ── Sauvegarder la config ─────────────────────────────────────────────────────
router.post('/config', requireSuperAdmin, async (req, res) => {
  const { provider, key } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider requis' });
  if (!AI_PROVIDERS.find(p => p.id === provider)) return res.status(400).json({ error: 'Provider inconnu' });
  if (key) {
    await db.setSetting('ai_config', JSON.stringify({ provider, key }));
  } else {
    const raw = await db.getSetting('ai_config').catch(() => null);
    const cur = raw ? JSON.parse(raw) : {};
    await db.setSetting('ai_config', JSON.stringify({ provider, key: cur.key || '' }));
  }
  res.json({ ok: true, provider });
});

router.delete('/config', requireSuperAdmin, async (req, res) => {
  await db.setSetting('ai_config', JSON.stringify({ provider: null, key: null }));
  res.json({ ok: true });
});

// ── Limites par provider (tokens d'entrée max, tokens de sortie max) ─────────
const PROVIDER_LIMITS = {
  groq:        { maxInputChars: 3500,  maxOutputTokens: 1200 },
  together:    { maxInputChars: 12000, maxOutputTokens: 3000 },
  mistral:     { maxInputChars: 12000, maxOutputTokens: 3000 },
  gemini:      { maxInputChars: 20000, maxOutputTokens: 4000 },
  cohere:      { maxInputChars: 10000, maxOutputTokens: 2500 },
  huggingface: { maxInputChars: 6000,  maxOutputTokens: 1500 },
};

async function getProviderLimits() {
  try {
    const raw = await db.getSetting('ai_config');
    if (!raw) return PROVIDER_LIMITS.groq;
    const { provider } = JSON.parse(raw);
    return PROVIDER_LIMITS[provider] || PROVIDER_LIMITS.groq;
  } catch { return PROVIDER_LIMITS.groq; }
}

// ── Appel interne vers l'API IA ───────────────────────────────────────────────
async function callAI(messages, maxTokens = 3000) {
  const raw = await db.getSetting('ai_config');
  if (!raw) throw new Error('Aucune IA configurée — configurez un provider dans "Configuration IA"');
  const { provider, key } = JSON.parse(raw);
  if (!key) throw new Error('Clé API manquante');

  const p = AI_PROVIDERS.find(x => x.id === provider);
  if (!p) throw new Error(`Provider "${provider}" inconnu`);

  let url, headers, body;

  if (p.type === 'gemini') {
    url = `${p.url}?key=${key}`;
    headers = { 'Content-Type': 'application/json' };
    const combined = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
    const sys = messages.find(m => m.role === 'system');
    body = {
      contents: [{ role: 'user', parts: [{ text: (sys ? sys.content + '\n\n' : '') + combined }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    };
  } else if (p.type === 'cohere') {
    url = p.url;
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    const sys = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');
    body = {
      model: p.model,
      preamble: sys?.content || '',
      messages: userMsgs.map(m => ({ role: m.role === 'user' ? 'user' : 'chatbot', message: m.content })),
      max_tokens: maxTokens,
    };
  } else if (p.type === 'huggingface') {
    url = p.url;
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    const text = messages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');
    body = { inputs: text, parameters: { max_new_tokens: maxTokens, temperature: 0.2 } };
  } else {
    // OpenAI-compatible (Groq, Mistral, Together)
    url = p.url;
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    body = { model: p.model, messages, max_tokens: maxTokens, temperature: 0.2 };
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
    };

    const req = mod.request(opts, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (resp.statusCode >= 400) {
            reject(new Error(`API ${provider} — erreur ${resp.statusCode}: ${(json.error?.message || json.message || JSON.stringify(json)).slice(0, 300)}`));
            return;
          }
          let text = '';
          if (p.type === 'gemini') text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          else if (p.type === 'cohere') text = json.message?.content?.[0]?.text || json.text || '';
          else if (p.type === 'huggingface') text = Array.isArray(json) ? json[0]?.generated_text || '' : json.generated_text || '';
          else text = json.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch (e) { reject(new Error('Réponse IA invalide : ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(90_000, () => { req.destroy(); reject(new Error('Timeout IA (90s dépassé)')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Test de connexion ─────────────────────────────────────────────────────────
router.post('/test', requireSuperAdmin, async (req, res) => {
  try {
    const text = await callAI([{ role: 'user', content: 'Réponds uniquement "OK" en un seul mot.' }], 20);
    res.json({ ok: true, response: text.trim().slice(0, 100) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── RÉPARATION AUTOMATIQUE ────────────────────────────────────────────────────
router.post('/repair', requireSuperAdmin, async (req, res) => {
  try {
    // 0. Récupérer les limites du provider actif
    const limits = await getProviderLimits();
    // Répartition : engine.js = 60%, db.js = 25%, admin.js = 15% du budget d'entrée
    const budgetTotal = limits.maxInputChars;
    const engMax  = Math.floor(budgetTotal * 0.60);
    const dbMax   = Math.floor(budgetTotal * 0.25);
    const admMax  = Math.floor(budgetTotal * 0.15);
    const predMax = Math.min(15, Math.floor(budgetTotal / 400)); // nb de prédictions selon budget

    // 1. Collecter l'état du système
    let todayStats = {}, blockedPreds = [], recentErrors = [];

    try {
      const r = await db.pool.query(`SELECT status, COUNT(*)::int AS n FROM predictions WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY status`);
      r.rows.forEach(row => todayStats[row.status] = row.n);
    } catch {}

    try {
      const r = await db.pool.query(`SELECT strategy, COUNT(*)::int AS n, MIN(created_at) AS oldest FROM predictions WHERE status='en_cours' AND created_at < NOW() - INTERVAL '20 minutes' GROUP BY strategy`);
      blockedPreds = r.rows;
    } catch {}

    try {
      const r = await db.pool.query(`SELECT strategy, status, game_number, created_at FROM predictions ORDER BY id DESC LIMIT ${predMax}`);
      recentErrors = r.rows;
    } catch {}

    // 2. Lire les fichiers clés (tronqués selon budget provider)
    const readSafe = (f, maxLen) => {
      try { return fs.readFileSync(path.join(__dirname, f), 'utf8').slice(0, maxLen); }
      catch { return `[Fichier "${f}" inaccessible]`; }
    };

    const systemContext = `=== BACCARAT PRO — DIAGNOSTIC ===
Stats 24h: ${JSON.stringify(todayStats)}
Bloquées >20min: ${blockedPreds.length ? blockedPreds.map(r => `${r.strategy}:${r.n}`).join(', ') : 'aucune'}
Dernières prédictions: ${recentErrors.map(r => `${r.strategy}#${r.game_number}→${r.status}`).join(', ')}

=== engine.js (${engMax} chars) ===
${readSafe('engine.js', engMax)}

=== db.js (${dbMax} chars) ===
${readSafe('db.js', dbMax)}

=== admin.js (${admMax} chars) ===
${readSafe('admin.js', admMax)}`;

    const systemPrompt = `Expert Node.js. Analyse ce système Baccarat. Retourne UNIQUEMENT JSON valide:
{"diagnostic":"...","score_sante":85,"problemes":[{"severity":"critical|warning|info","description":"...","solution":"..."}],"corrections":[{"file":"engine.js","description":"...","old_string":"code exact","new_string":"code corrigé"}]}
Si aucun problème: corrections=[].`;

    const response = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: systemContext },
    ], limits.maxOutputTokens);

    let parsed = null;
    try {
      const m = response.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { parsed = null; }

    res.json({ ok: true, raw: response, result: parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── RÉPARATION INTELLIGENTE LOCALE (sans API externe) ────────────────────────
router.post('/repair-smart', requireSuperAdmin, async (req, res) => {
  const { autofix = true } = req.body;
  const { execSync } = require('child_process');
  const problemes = [];
  const fixesApplied = [];
  let score = 100;

  // 1. ── CONNEXION DB ─────────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    await db.pool.query('SELECT 1');
    const ms = Date.now() - t0;
    if (ms > 500) {
      problemes.push({ severity: 'warning', description: `Base de données lente (${ms}ms de latence)`, solution: 'Vérifiez la charge du serveur PostgreSQL' });
      score -= 5;
    }
  } catch (e) {
    problemes.push({ severity: 'critical', description: `DB inaccessible: ${e.message}`, solution: 'Vérifiez la variable DATABASE_URL dans les secrets' });
    score -= 50;
    return res.json({ ok: true, result: { diagnostic: 'Base de données inaccessible — arrêt du diagnostic', score_sante: Math.max(0, score), problemes, corrections: [], fixesApplied } });
  }

  // 2. ── TABLES REQUISES ──────────────────────────────────────────────────────
  const requiredTables = ['predictions','users','settings','session','telegram_config','hosted_bots','deploy_logs','tg_pred_messages'];
  try {
    const r = await db.pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const existing = new Set(r.rows.map(x => x.table_name));
    for (const t of requiredTables) {
      if (!existing.has(t)) {
        problemes.push({ severity: 'critical', description: `Table manquante: "${t}"`, solution: 'Réinitialisez la base de données via le panneau Système' });
        score -= 15;
      }
    }
  } catch {}

  // 3. ── PRÉDICTIONS BLOQUÉES ─────────────────────────────────────────────────
  try {
    const r = await db.pool.query(`
      SELECT strategy, COUNT(*)::int as n, MIN(created_at) as oldest
      FROM predictions WHERE status='en_cours' AND created_at < NOW() - INTERVAL '30 minutes'
      GROUP BY strategy ORDER BY n DESC`);
    if (r.rows.length > 0) {
      const total = r.rows.reduce((s, x) => s + x.n, 0);
      const oldest = new Date(r.rows[0].oldest);
      const ageMin = Math.round((Date.now() - oldest) / 60000);
      problemes.push({
        severity: 'critical',
        description: `${total} prédiction(s) bloquée(s) "en_cours" depuis ${ageMin} min (${r.rows.map(x => `${x.strategy}:${x.n}`).join(', ')})`,
        solution: 'Les prédictions > 1h seront marquées "raté" automatiquement'
      });
      score -= Math.min(25, total * 5);
    }
    if (autofix) {
      const fix = await db.pool.query(`
        UPDATE predictions SET status='raté', resolved_at=NOW()
        WHERE status='en_cours' AND created_at < NOW() - INTERVAL '1 hour'
        RETURNING id`);
      if (fix.rowCount > 0)
        fixesApplied.push({ type: 'auto', icon: '🔧', description: `${fix.rowCount} prédiction(s) bloquée(s) depuis > 1h → marquées "raté" automatiquement` });
    }
  } catch {}

  // 4. ── STATS PRÉDICTIONS 24H ────────────────────────────────────────────────
  try {
    const r = await db.pool.query(`SELECT status, COUNT(*)::int as n FROM predictions WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY status`);
    const stats = {};
    r.rows.forEach(x => stats[x.status] = x.n);
    const total = Object.values(stats).reduce((s, v) => s + v, 0);
    if (total === 0) {
      problemes.push({ severity: 'warning', description: 'Aucune prédiction générée dans les 24 dernières heures', solution: 'Vérifiez que des parties sont en cours et que les stratégies sont activées' });
      score -= 10;
    } else {
      const gagneN = stats['gagne'] || 0;
      const rate = (gagneN / total * 100).toFixed(1);
      if (total >= 10 && parseFloat(rate) < 15) {
        problemes.push({ severity: 'warning', description: `Taux de victoire très faible: ${rate}% (${gagneN}/${total} en 24h)`, solution: 'Vérifiez vos seuils de prédiction et la configuration des stratégies' });
        score -= 8;
      }
    }
  } catch {}

  // 5. ── INTÉGRITÉ DES FICHIERS CRITIQUES ─────────────────────────────────────
  const criticalFiles = [
    { f: 'engine.js',           minSize: 5000  },
    { f: 'db.js',               minSize: 500   },
    { f: 'index.js',            minSize: 1000  },
    { f: 'telegram-service.js', minSize: 5000  },
    { f: 'admin.js',            minSize: 1000  },
    { f: 'ai-route.js',         minSize: 500   },
  ];
  for (const { f, minSize } of criticalFiles) {
    const fp = path.join(__dirname, f);
    if (!fs.existsSync(fp)) {
      problemes.push({ severity: 'critical', description: `Fichier manquant: ${f}`, solution: `Restaurer ${f} depuis le ZIP de déploiement` });
      score -= 20;
    } else {
      const size = fs.statSync(fp).size;
      if (size < minSize) {
        problemes.push({ severity: 'critical', description: `Fichier ${f} corrompu/vide (${size} bytes — attendu ≥ ${minSize})`, solution: `Restaurer ${f} depuis un backup` });
        score -= 15;
      }
    }
  }

  // 6. ── VÉRIFICATION SYNTAXE JS ──────────────────────────────────────────────
  const jsCheckFiles = ['engine.js', 'db.js', 'index.js', 'telegram-service.js', 'admin.js'];
  for (const f of jsCheckFiles) {
    const fp = path.join(__dirname, f);
    if (!fs.existsSync(fp)) continue;
    try {
      execSync(`node --check "${fp}"`, { stdio: 'pipe', timeout: 5000 });
    } catch (e) {
      const errMsg = (e.stderr ? e.stderr.toString() : e.message).replace(/\n/g, ' ').slice(0, 200);
      problemes.push({ severity: 'critical', description: `Erreur de syntaxe dans ${f}: ${errMsg}`, solution: `Corriger la syntaxe puis redémarrer le serveur` });
      score -= 30;
    }
  }

  // 7. ── CONFIGURATION TELEGRAM ───────────────────────────────────────────────
  try {
    const r = await db.pool.query(`SELECT COUNT(*)::int as n, SUM(CASE WHEN enabled THEN 1 ELSE 0 END)::int as active FROM telegram_config`);
    const { n, active } = r.rows[0];
    if (n === 0) {
      problemes.push({ severity: 'warning', description: 'Aucun canal Telegram configuré', solution: 'Ajoutez un canal dans l\'onglet 📢 Canaux' });
      score -= 5;
    } else if (active === 0) {
      problemes.push({ severity: 'warning', description: `${n} canal(aux) configuré(s) mais aucun activé`, solution: 'Activez au moins un canal dans l\'onglet 📢 Canaux' });
      score -= 5;
    }
  } catch {}

  // 8. ── BOTS HÉBERGÉS EN ERREUR ──────────────────────────────────────────────
  try {
    const r = await db.pool.query(`SELECT name, status FROM hosted_bots WHERE status='error'`);
    if (r.rows.length > 0) {
      problemes.push({ severity: 'warning', description: `${r.rows.length} bot(s) hébergé(s) en erreur: ${r.rows.map(x => x.name).join(', ')}`, solution: 'Redémarrez-les depuis l\'onglet 🤖 Hébergement' });
      score -= 10;
    }
  } catch {}

  // 9. ── PARAMÈTRES REQUIS ────────────────────────────────────────────────────
  const wantedSettings = [
    { key: 'max_rattrapage', label: 'Limite de rattrapages', defaultVal: '3' },
    { key: 'tg_msg_format',  label: 'Format messages Telegram', defaultVal: null },
  ];
  for (const s of wantedSettings) {
    try {
      const val = await db.getSetting(s.key);
      if ((val === null || val === undefined || val === '') && s.defaultVal !== null) {
        if (autofix) {
          await db.setSetting(s.key, s.defaultVal);
          fixesApplied.push({ type: 'auto', icon: '⚙️', description: `Paramètre "${s.label}" manquant → valeur par défaut appliquée (${s.defaultVal})` });
        } else {
          problemes.push({ severity: 'info', description: `Paramètre "${s.label}" non configuré`, solution: `Configurez-le dans le panneau admin` });
          score -= 2;
        }
      }
    } catch {}
  }

  // 10. ── MÉMOIRE SERVEUR ─────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB  = Math.round(mem.rss / 1024 / 1024);
  if (heapMB > 450) {
    problemes.push({ severity: 'warning', description: `Mémoire heap élevée: ${heapMB} MB (RSS: ${rssMB} MB)`, solution: 'Redémarrez le serveur pour libérer la mémoire' });
    score -= 8;
  }

  // 11. ── CONNEXIONS DB POOL ─────────────────────────────────────────────────
  try {
    const pool = db.pool;
    if (pool.totalCount > 15) {
      problemes.push({ severity: 'warning', description: `Pool DB: ${pool.totalCount} connexions ouvertes (max recommandé: 15)`, solution: 'Redémarrez le serveur pour libérer les connexions DB' });
      score -= 5;
    }
  } catch {}

  // ── SCORE & DIAGNOSTIC FINAL ────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));
  const critCount = problemes.filter(p => p.severity === 'critical').length;
  const warnCount = problemes.filter(p => p.severity === 'warning').length;
  const diagParts = [];
  if (critCount > 0) diagParts.push(`${critCount} problème(s) critique(s)`);
  if (warnCount > 0) diagParts.push(`${warnCount} avertissement(s)`);
  if (fixesApplied.length > 0) diagParts.push(`${fixesApplied.length} correction(s) appliquée(s) automatiquement`);
  if (diagParts.length === 0) diagParts.push('Système pleinement opérationnel');
  diagParts.push(`Mémoire: ${heapMB}MB`);

  res.json({
    ok: true,
    result: {
      diagnostic: diagParts.join(' — '),
      score_sante: score,
      problemes,
      corrections: [],
      fixesApplied,
    },
  });
});

// ── Appliquer une correction ──────────────────────────────────────────────────
const ALLOWED_FILES = [
  'engine.js', 'admin.js', 'db.js', 'system-logs-route.js',
  'index.js', 'auth.js', 'telegram-service.js', 'bot-host.js', 'bilan.js',
];

router.post('/apply-fix', requireSuperAdmin, async (req, res) => {
  const { file, old_string, new_string, description } = req.body;
  if (!file || old_string === undefined || new_string === undefined)
    return res.status(400).json({ error: 'file, old_string et new_string requis' });
  if (!ALLOWED_FILES.includes(file))
    return res.status(403).json({ error: `Fichier non autorisé: ${file}` });

  try {
    const filePath = path.join(__dirname, file);
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(old_string))
      return res.status(400).json({ error: 'Texte introuvable dans le fichier (peut-être déjà corrigé ?)' });
    const newContent = content.replace(old_string, new_string);
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`[AI Repair] ✅ Correction appliquée: ${file} — ${description || ''}`);
    res.json({ ok: true, file, description });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PRÉ-VÉRIFICATION BOT ──────────────────────────────────────────────────────
router.post('/bot-precheck', requireSuperAdmin, async (req, res) => {
  const { zip_base64, language } = req.body;
  if (!zip_base64) return res.status(400).json({ error: 'zip_base64 requis' });

  try {
    const limits = await getProviderLimits();
    // Adapter selon le budget : nb de fichiers et taille par fichier
    const maxFiles    = limits.maxInputChars >= 8000 ? 6 : 3;
    const maxPerFile  = Math.floor((limits.maxInputChars * 0.85) / maxFiles);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(Buffer.from(zip_base64, 'base64'));
    const entries = zip.getEntries();

    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;
      if (/\.(js|py|json)$/.test(name) && !name.includes('node_modules') && !name.includes('.min.')) {
        const content = entry.getData().toString('utf8').slice(0, maxPerFile);
        files.push({ name, content });
        if (files.length >= maxFiles) break;
      }
    }

    if (files.length === 0) return res.json({ ok: true, result: { can_deploy: true, issues: [], corrections: [] }, correctedZip64: null });

    const filesCtx = files.map(f => `### ${f.name}\n${f.content}`).join('\n---\n');

    const systemPrompt = `Expert bots Telegram (Node.js/Python). Retourne UNIQUEMENT JSON valide:
{"can_deploy":true,"issues":[{"file":"...","severity":"critical|warning","description":"..."}],"corrections":[{"file":"...","description":"...","old_string":"...","new_string":"..."}]}`;

    const response = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Langage: ${language || 'node'}\n${filesCtx}` },
    ], limits.maxOutputTokens);

    let parsed = null;
    try {
      const m = response.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch { parsed = null; }

    // Appliquer les corrections dans le zip si demandé
    let correctedZip64 = null;
    if (parsed?.corrections?.length > 0) {
      let modified = false;
      for (const corr of parsed.corrections) {
        const entry = zip.getEntry(corr.file);
        if (entry && corr.old_string && corr.new_string) {
          const content = entry.getData().toString('utf8');
          if (content.includes(corr.old_string)) {
            zip.updateFile(corr.file, Buffer.from(content.replace(corr.old_string, corr.new_string), 'utf8'));
            modified = true;
          }
        }
      }
      if (modified) correctedZip64 = zip.toBuffer().toString('base64');
    }

    res.json({ ok: true, result: parsed, raw: response, correctedZip64 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { router, callAI };
