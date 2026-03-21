#!/usr/bin/env bash
set -euo pipefail

# Veles Setup Script
# Reads .env to determine which services to start via Docker vs local

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if it exists
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# Defaults
VELES_NEO4J_MODE="${VELES_NEO4J_MODE:-docker}"
VELES_OLLAMA_MODE="${VELES_OLLAMA_MODE:-docker}"
NEO4J_URI="${NEO4J_URI:-bolt://localhost:7687}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-nomic-embed-text}"

echo "=== Veles Setup ==="
echo ""

# --- Neo4j ---
if [ "$VELES_NEO4J_MODE" = "docker" ]; then
  echo "[Neo4j] Starting via Docker..."
  cd "$PROJECT_DIR"
  docker compose --profile neo4j up -d
  echo "[Neo4j] Waiting for Neo4j to be ready..."
  for i in $(seq 1 30); do
    if docker compose exec neo4j wget --no-verbose --tries=1 --spider http://localhost:7474 2>/dev/null; then
      echo "[Neo4j] Ready!"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "[Neo4j] ERROR: Neo4j did not start within 5 minutes"
      exit 1
    fi
    sleep 10
  done
else
  echo "[Neo4j] Mode: local — validating connection..."
  if command -v cypher-shell &>/dev/null; then
    echo "[Neo4j] cypher-shell found"
  fi
  # Try connecting via bolt
  if curl -s --max-time 5 "http://localhost:7474" >/dev/null 2>&1; then
    echo "[Neo4j] Local Neo4j is reachable at localhost:7474"
  else
    echo "[Neo4j] WARNING: Cannot reach Neo4j at localhost:7474. Make sure it's running."
  fi
fi

# --- Ollama ---
if [ "$VELES_OLLAMA_MODE" = "docker" ]; then
  echo ""
  echo "[Ollama] Starting via Docker..."
  cd "$PROJECT_DIR"
  docker compose --profile ollama up -d
  echo "[Ollama] Waiting for Ollama to be ready..."
  for i in $(seq 1 12); do
    if curl -s --max-time 5 "$OLLAMA_BASE_URL/api/tags" >/dev/null 2>&1; then
      echo "[Ollama] Ready!"
      break
    fi
    if [ "$i" -eq 12 ]; then
      echo "[Ollama] ERROR: Ollama did not start within 2 minutes"
      exit 1
    fi
    sleep 10
  done
else
  echo ""
  echo "[Ollama] Mode: local — validating connection..."
  if curl -s --max-time 5 "$OLLAMA_BASE_URL/api/tags" >/dev/null 2>&1; then
    echo "[Ollama] Local Ollama is reachable at $OLLAMA_BASE_URL"
  else
    echo "[Ollama] WARNING: Cannot reach Ollama at $OLLAMA_BASE_URL. Make sure it's running."
  fi
fi

# --- Pull embedding model ---
echo ""
echo "[Ollama] Pulling embedding model: $OLLAMA_MODEL..."
curl -s -X POST "$OLLAMA_BASE_URL/api/pull" -d "{\"name\": \"$OLLAMA_MODEL\"}" | while read -r line; do
  status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$status" ]; then
    echo "  $status"
  fi
done
echo "[Ollama] Model $OLLAMA_MODEL ready"

echo ""
echo "=== Setup complete ==="
echo "Run 'npm run build' to compile TypeScript"
echo "Run 'npm start' to start the MCP server"
