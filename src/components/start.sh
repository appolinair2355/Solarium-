#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Script de démarrage — Baccarat Pro
#  Installe Ollama sur disque persistant Render, démarre le
#  serveur Ollama en arrière-plan, puis lance Node.js
# ═══════════════════════════════════════════════════════════════

# ── Chemins persistants sur Render (disque monté) ────────────────
PERSIST_DIR="/opt/render/project/src/data"
OLLAMA_DIR="$PERSIST_DIR/ollama"
OLLAMA_BIN="$OLLAMA_DIR/bin/ollama"
OLLAMA_MODELS_DIR="$OLLAMA_DIR/models"
OLLAMA_PORT=11434
OLLAMA_URL="http://localhost:$OLLAMA_PORT"
DEFAULT_MODEL="${OLLAMA_DEFAULT_MODEL:-phi3:mini}"

# ── Couleurs console ─────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${CYAN}[Ollama]${NC} $1"; }
ok()   { echo -e "${GREEN}[Ollama] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[Ollama] ⚠${NC} $1"; }
err()  { echo -e "${RED}[Ollama] ✗${NC} $1"; }

# ── Créer les répertoires ─────────────────────────────────────────
mkdir -p "$OLLAMA_DIR/bin" "$OLLAMA_MODELS_DIR"

# ── Installer Ollama si absent ────────────────────────────────────
if [ ! -f "$OLLAMA_BIN" ]; then
  log "Téléchargement d'Ollama (binaire Linux amd64)..."
  OLLAMA_RELEASE_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64"
  if curl -fsSL "$OLLAMA_RELEASE_URL" -o "$OLLAMA_BIN" 2>/dev/null; then
    chmod +x "$OLLAMA_BIN"
    ok "Ollama installé → $OLLAMA_BIN"
  else
    err "Échec du téléchargement d'Ollama — IA locale indisponible"
    # Démarrer Node.js sans Ollama
    exec node index.js
  fi
else
  ok "Ollama déjà installé (version: $($OLLAMA_BIN --version 2>/dev/null || echo 'inconnue'))"
fi

# ── Démarrer le serveur Ollama ────────────────────────────────────
log "Démarrage du serveur Ollama sur port $OLLAMA_PORT..."
OLLAMA_MODELS="$OLLAMA_MODELS_DIR" \
OLLAMA_HOST="0.0.0.0:$OLLAMA_PORT" \
  "$OLLAMA_BIN" serve > "$OLLAMA_DIR/server.log" 2>&1 &

OLLAMA_PID=$!
echo $OLLAMA_PID > "$OLLAMA_DIR/ollama.pid"

# ── Attendre que le serveur soit prêt (max 20s) ───────────────────
log "Attente du démarrage du serveur..."
READY=0
for i in $(seq 1 20); do
  if curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ $READY -eq 0 ]; then
  warn "Serveur Ollama pas encore prêt — continuons sans attendre"
else
  ok "Serveur Ollama opérationnel (PID=$OLLAMA_PID)"
fi

# ── Télécharger le modèle par défaut si absent ────────────────────
MODELS_MANIFEST="$OLLAMA_MODELS_DIR/manifests"
if [ $READY -eq 1 ] && ([ ! -d "$MODELS_MANIFEST" ] || [ -z "$(ls -A "$MODELS_MANIFEST" 2>/dev/null)" ]); then
  log "Téléchargement du modèle $DEFAULT_MODEL en arrière-plan..."
  OLLAMA_MODELS="$OLLAMA_MODELS_DIR" \
    "$OLLAMA_BIN" pull "$DEFAULT_MODEL" >> "$OLLAMA_DIR/server.log" 2>&1 &
  ok "Téléchargement lancé (visible dans $OLLAMA_DIR/server.log)"
else
  if [ $READY -eq 1 ]; then
    INSTALLED=$(OLLAMA_MODELS="$OLLAMA_MODELS_DIR" "$OLLAMA_BIN" list 2>/dev/null | tail -n +2 | awk '{print $1}' | tr '\n' ', ')
    ok "Modèles disponibles : ${INSTALLED:-aucun}"
  fi
fi

# ── Exporter l'URL Ollama pour Node.js ───────────────────────────
export OLLAMA_URL="$OLLAMA_URL"

# ── Démarrer l'application Node.js ───────────────────────────────
log "→ Démarrage de l'application Node.js..."
exec node index.js
