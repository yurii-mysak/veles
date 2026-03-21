# Design: Embedding Migration, APOC Backup/Restore, Ticket Tagging

Date: 2026-03-20

## 1. Embedding Migration Script (Resumable)

### Problem
When switching Ollama models (e.g., nomic-embed-text to mxbai-embed-large), all existing chunk embeddings become incompatible with the new model's vector space.

### Solution
A resumable migration script (`scripts/reembed.ts`, run via `npm run reembed`) that re-embeds all chunks with the currently configured model.

### Design
- Add `embedding_model` property to Chunk nodes to track which model produced the embedding
- Query chunks in batches of 50 where `embedding_model != currentModel` (or is missing)
- Re-embed each batch via Ollama, update `embedding` vector and `embedding_model`
- Log progress: `Processed 150/2340 chunks...`
- If interrupted, re-run picks up where it left off
- If `EMBEDDING_DIMENSIONS` changed, drop and recreate the vector index before processing
- Validate Ollama connectivity and model availability before starting

### Files
- `scripts/reembed.ts` — migration script
- `src/core/ingestion.ts` — set `embedding_model` on new chunks
- `src/core/neo4j.ts` — helper to drop/recreate vector index if dimensions change
- `package.json` — add `reembed` script

## 2. APOC-based Database Backup/Restore

### Problem
Users need to migrate their full knowledge base between machines. Neo4j Community Edition doesn't support `neo4j-admin dump/load`.

### Solution
Use APOC plugin (already included in docker-compose) for full graph export/import as JSON.

### Design

#### `veles_backup` MCP tool
- Uses `apoc.export.json.all()` to export entire graph
- Output: `veles-backup-<timestamp>.json` at specified path
- Includes all nodes, relationships, properties (including embedding vectors)
- Optional `brain` parameter

#### `veles_restore` MCP tool
- Uses `apoc.import.json()` to import from backup file
- Requires `confirm_overwrite: true` parameter (clears existing data first)
- After import, runs `initializeIndexes()` to rebuild indexes
- Optional `brain` parameter

#### CLI scripts
- `npm run backup -- --output ~/backups/`
- `npm run restore -- --input ~/backups/veles-backup-2026-03-20.json`

### APOC Configuration
- Docker compose needs `apoc.export.file.enabled=true` and `apoc.import.file.enabled=true`
- Mount a shared volume for import/export files at `/var/lib/neo4j/import/`

### Files
- `src/mcp/tools/backup.ts` — backup MCP tool
- `src/mcp/tools/restore.ts` — restore MCP tool
- `scripts/backup.ts` — CLI backup script
- `scripts/restore.ts` — CLI restore script
- `src/mcp/server.ts` — register new tools
- `docker-compose.yml` — APOC config and import volume

## 3. Ticket Number Tagging (Convention-based)

### Problem
Users want to associate resources with ticketing system tickets (Jira, Linear, GitHub Issues) without direct API integration.

### Solution
Leverage existing tag system with ticket numbers as regular tags (e.g., `PROJ-1234`). No new API integrations needed.

### Design
- Ticket pattern: `/[A-Z]+-\d+/` (e.g., PROJ-1234, BUG-42)
- Existing `veles_add`, `veles_tag` tools already support this — no core changes needed
- Add pattern detection in `add` and `edit` tool responses to surface detected ticket numbers
- Update `search` and `list` output formatting to highlight ticket-pattern tags
- Document the convention in README

### Files
- `src/mcp/tools/add.ts` — detect ticket patterns in content, mention in response
- `src/mcp/tools/edit.ts` — same detection
- `src/mcp/tools/search.ts` — highlight ticket tags in output
- `src/mcp/tools/list.ts` — highlight ticket tags in output
- `README.md` — document ticket tagging convention
