# Veles

**Personal second-brain RAG system backed by Neo4j** — named after the Slavic god of wisdom and hidden knowledge.

Veles is an MCP (Model Context Protocol) server that gives Claude Code direct access to your personal knowledge graph. Add resources, tag them, search semantically, and let Claude reason over your accumulated knowledge.

## Features

- **Hybrid search** — vector similarity + keyword matching + graph traversal
- **Knowledge graph** — resources, tags, collections, and relationships stored in Neo4j
- **Multi-brain support** — separate namespaces for work, personal, projects
- **Tagging system** — hierarchical tags with parent/child relationships
- **Bulk import/export** — ingest entire directories, export as markdown or JSON
- **Backup & restore** — full database backup/restore via APOC for machine migration
- **CLI query** — search, list, and read full documents directly from the terminal without Claude
- **Ticket tagging** — auto-detects ticket patterns (PROJ-1234) and highlights them
- **Embedding migration** — resumable script for switching embedding models
- **Local-first** — everything runs on your machine, no cloud dependency
- **Mobile access** — dispatch tasks from phone via Claude Dispatch (requires Max subscription)

## Quick Start

```bash
git clone <repo-url>
cd veles
cp .env.example .env
npm install
npm run setup          # starts Docker services, pulls embedding model, creates indexes
npm run build
```

Then add to your Claude Code config.

**For use in all projects** (`~/.claude.json` — user-level, works everywhere):

```json
{
  "mcpServers": {
    "veles": {
      "command": "node",
      "args": ["/absolute/path/to/veles/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_PASSWORD": "veles_local"
      }
    }
  }
}
```

**For use in a specific project only** (`.mcp.json` in that project's root):
Same format — committed to git so team members get it automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code (User)                      │
│                           ↕ MCP (stdio)                      │
├─────────────────────────────────────────────────────────────┤
│                    Veles MCP Server (TS)                      │
│  Tools: add | search | list | get | edit | remove | tag      │
│         relate | import | export | stats | backup | restore  │
├──────────┬────────────────────────────────┬─────────────────┤
│ Ingestion│      Retrieval Pipeline        │   Tag Manager   │
│ Pipeline │   (Vector+Keyword+Graph)       │                 │
├──────────┴────────────────────────────────┴─────────────────┤
│                LangChain.js Orchestration                    │
│       (Document Loaders, Splitters, Embeddings)              │
├───────────────────────┬─────────────────────────────────────┤
│      Neo4j 5.x        │           Ollama                    │
│   (Graph + Vectors)   │      (nomic-embed-text)             │
└───────────────────────┴─────────────────────────────────────┘
```

## How Data Flows

### Adding a Resource

```
User: "Add this note about event sourcing, tag it #architecture"
                            │
                            ▼
                    ┌───────────────┐
                    │  veles_add    │
                    │  MCP Tool     │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Parse   │ │  Chunk   │ │  Create  │
        │  Title & │ │  Text    │ │  Tags    │
        │  Tags    │ │  (1000   │ │  (MERGE  │
        │          │ │  chars)  │ │  nodes)  │
        └──────────┘ └────┬─────┘ └──────────┘
                          │
                          ▼
                    ┌──────────┐
                    │  Embed   │
                    │  via     │──── Ollama (nomic-embed-text)
                    │  Ollama  │     768-dim vectors
                    └────┬─────┘
                         │
                         ▼
                   ┌───────────┐
                   │  Neo4j    │
                   │           │
                   │ (:Resource)──[:HAS_CHUNK]──▶(:Chunk{embedding})
                   │     │                            │
                   │     ├──[:TAGGED_WITH]──▶(:Tag)   ├──[:NEXT]──▶(:Chunk)
                   │     └──[:PART_OF]──▶(:Collection)│
                   └───────────┘
```

### Searching

```
User: "What do I know about graph database design patterns?"
                            │
                            ▼
                    ┌───────────────┐
                    │ veles_search  │
                    │ MCP Tool      │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │ 1. Vector    │ │ 2. Full  │ │ 3. Graph     │
     │ Search       │ │ Text     │ │ Traversal    │
     │              │ │ Search   │ │              │
     │ Embed query  │ │ Keyword  │ │ Shared tags  │
     │ → cosine     │ │ matching │ │ between top  │
     │ similarity   │ │ on title │ │ results →    │
     │ on chunks    │ │ + content│ │ related docs │
     └──────┬───────┘ └────┬─────┘ └──────┬───────┘
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                    ┌──────────────┐
                    │ Merge &      │
                    │ Rank Results │
                    │ (weighted    │
                    │  scoring)    │
                    └──────┬───────┘
                           ▼
                    Results with source attribution
```

### How Chunking Works

When you add a resource, Veles processes it through this pipeline:

1. **Read** — Load the file or text content
2. **Split** — Use LangChain's `MarkdownTextSplitter` to break content into chunks
   - Default chunk size: 1000 characters
   - Overlap: 200 characters (preserves context at boundaries)
   - Markdown-aware: splits at headings, paragraphs, then sentences
3. **Embed** — Each chunk is sent to Ollama's `nomic-embed-text` model
   - Returns a 768-dimensional vector per chunk
   - Captures semantic meaning of the text
4. **Store** — Each chunk becomes a `(:Chunk)` node in Neo4j with:
   - The text content
   - The embedding vector (indexed for fast similarity search)
   - Position index (for reconstructing order)
   - `NEXT` relationship to the following chunk

## Neo4j Data Model

```
(:Resource {id, title, content, type, source_path, owner, brain, created_at, updated_at})
    │
    ├──[:HAS_CHUNK]──▶ (:Chunk {id, content, embedding, position, resource_id})
    │                       │
    │                       └──[:NEXT]──▶ (:Chunk)  (preserves ordering)
    │
    ├──[:TAGGED_WITH]──▶ (:Tag {id, name, category, created_at})
    │                       │
    │                       └──[:CHILD_OF]──▶ (:Tag)  (hierarchy)
    │
    ├──[:PART_OF]──▶ (:Collection {id, name, description})
    │
    └──[:RELATES_TO]──▶ (:Resource)  (cross-references)
```

**Indexes:**
- Vector index on `Chunk.embedding` — cosine similarity, 768 dimensions
- Full-text index on `Resource.title` + `Resource.content`
- Full-text index on `Chunk.content`
- Unique constraints on `Tag.name`, `Resource.id`, `Collection.name`
- Index on `Resource.owner` (future multi-user)

## MCP Tools Reference

### `veles_add`
Ingest a single resource (file or text).

```
Parameters:
  content?     - Text content to ingest
  file_path?   - Absolute path to file (reads it for you)
  title?       - Title (auto-extracted from content if omitted)
  tags?        - Array of tag names
  collection?  - Collection to add to
  brain?       - Brain namespace (default: "default")
```

### `veles_search`
Hybrid search across your knowledge base.

```
Parameters:
  query        - Search query (required)
  tags?        - Filter by tags
  collection?  - Filter by collection
  limit?       - Max results (default: 10)
  brain?       - Brain namespace (default: "default")
```

### `veles_list`
List resources with filters.

```
Parameters:
  tags?        - Filter by tags
  collection?  - Filter by collection
  type?        - "markdown" | "text" | "image"
  sort?        - "created" | "updated" | "title"
  limit?       - Max results (default: 20)
  brain?       - Brain namespace (default: "default")
```

### `veles_get`
Get full resource details.

```
Parameters:
  id           - Resource ID or title (required)
```

### `veles_edit`
Update resource metadata or content. Re-chunks and re-embeds if content changes.

```
Parameters:
  id           - Resource ID (required)
  title?       - New title
  content?     - New content (triggers re-chunking)
  tags?        - New tags (replaces existing)
```

### `veles_remove`
Delete a resource and all its chunks.

```
Parameters:
  id           - Resource ID (required)
```

### `veles_tag`
Manage tags (create, list, rename, delete, set hierarchy).

```
Parameters:
  action       - "create" | "list" | "rename" | "delete" | "set_parent"
  name?        - Tag name (required for most actions)
  new_name?    - For rename
  parent?      - Parent tag name (for create/set_parent)
  category?    - Tag category (for create)
```

### `veles_relate`
Manage relationships between resources.

```
Parameters:
  action?      - "create" | "remove" | "list" (default: "create")
  source_id    - Source resource ID (required)
  target_id?   - Target resource ID (for create/remove)
  type?        - Relationship type (default: "RELATES_TO")
```

### `veles_import`
Bulk import a directory of files.

```
Parameters:
  directory_path - Absolute path to directory (required)
  tags?          - Tags for all imported files
  collection?    - Collection for all imported files
  recursive?     - Recurse into subdirectories (default: true)
  brain?         - Brain namespace (default: "default")
```

### `veles_export`
Export resources as markdown or JSON.

```
Parameters:
  format       - "markdown" | "json" (required)
  tags?        - Filter by tags
  collection?  - Filter by collection
  output_path  - Absolute output directory path (required)
```

### `veles_stats`
Knowledge base overview (no parameters).

### `veles_backup`
Export full database as JSON backup (via APOC).

```
Parameters:
  output_file  - Filename for backup (stored in Neo4j import dir, required)
  brain?       - Brain namespace (default: "default")
```

### `veles_restore`
Restore database from a JSON backup file.

```
Parameters:
  input_file       - Backup filename in Neo4j import dir (required)
  confirm_overwrite - Must be true (deletes existing data first, required)
  brain?            - Brain namespace (default: "default")
```

## Multi-Brain Support

Veles supports separate "brains" — each brain runs its own Neo4j instance for complete data isolation.

### Setup

1. Add a new Neo4j container in `docker-compose.yml` (templates are commented out)
2. Configure the brain in `.env`:

```bash
# Default brain uses NEO4J_URI, NEO4J_PASSWORD, etc.
VELES_DEFAULT_BRAIN=default

# Work brain — separate Neo4j instance on port 7688
VELES_BRAIN_WORK_URI=bolt://localhost:7688
VELES_BRAIN_WORK_PASSWORD=veles_work

# Personal brain — separate instance on port 7689
VELES_BRAIN_PERSONAL_URI=bolt://localhost:7689
VELES_BRAIN_PERSONAL_PASSWORD=veles_personal
```

3. Use the `brain` parameter in tool calls:

```
"Add this to my work brain" → brain: "work"
"Search my personal brain for..." → brain: "personal"
```

### Why separate instances?

- **Complete isolation** — no risk of data leaking between brains
- **Independent backup/restore** — back up work brain without personal data
- **Portable** — each brain's Neo4j data volume can be moved independently
- **Different retention policies** — keep work brain forever, prune personal periodically

Use cases:
- **work** — company knowledge, architecture decisions, meeting notes
- **personal** — learning notes, bookmarks, hobbies
- **project-x** — isolated knowledge for a specific project

## Configuration

All settings via `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USERNAME` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `veles_local` | Neo4j password |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Embedding model |
| `EMBEDDING_DIMENSIONS` | `768` | Vector dimensions |
| `CHUNK_SIZE` | `1000` | Characters per chunk |
| `CHUNK_OVERLAP` | `200` | Overlap between chunks |
| `VELES_NEO4J_MODE` | `docker` | `docker` or `local` |
| `VELES_OLLAMA_MODE` | `docker` | `docker` or `local` |
| `VELES_DEFAULT_BRAIN` | `default` | Default brain namespace |

## Infrastructure Options

### Option A: Full Docker (simplest)
```bash
cp .env.example .env    # defaults to docker mode
npm run setup           # starts Neo4j + Ollama containers
```

### Option B: Local installations
```bash
# Edit .env: set VELES_NEO4J_MODE=local, VELES_OLLAMA_MODE=local
# Ensure Neo4j 5.x and Ollama are running locally
npm run setup           # validates connections, creates indexes
```

### Option C: Mix
```bash
# Edit .env: e.g., VELES_NEO4J_MODE=docker, VELES_OLLAMA_MODE=local
npm run setup           # starts only Docker Neo4j, validates local Ollama
```

## Mobile Access via Claude Dispatch

With Claude Max subscription and Claude Dispatch (March 2026+):

1. Pair your mobile Claude app with your desktop
2. Desktop must have Claude Code running with Veles MCP configured
3. Send tasks from your phone: "Add a note about today's standup, tag it #meeting"
4. Claude Dispatch routes to desktop → Veles MCP → Neo4j
5. Confirmation returned to your phone

No changes to Veles needed — Dispatch uses the existing MCP server transparently.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| RAG Framework | LangChain.js |
| Database | Neo4j 5.x Community (graph + vectors) |
| Embeddings | Ollama (nomic-embed-text, 768 dims) |
| MCP Protocol | @modelcontextprotocol/sdk |
| Testing | Vitest |
| Infrastructure | Docker Compose |

## Project Structure

```
veles/
├── src/
│   ├── index.ts              # Entry point — MCP server startup
│   ├── config.ts             # Environment configuration
│   ├── mcp/
│   │   ├── server.ts         # MCP server setup, tool registration
│   │   └── tools/            # One file per MCP tool (13 tools)
│   ├── core/
│   │   ├── neo4j.ts          # Neo4j driver, indexes, connectivity
│   │   ├── embeddings.ts     # Ollama embedding wrapper
│   │   ├── ingestion.ts      # Chunking + embedding pipeline
│   │   └── retrieval.ts      # Hybrid search (vector+keyword+graph)
│   ├── models/
│   │   ├── resource.ts       # Resource CRUD
│   │   ├── chunk.ts          # Chunk operations
│   │   └── tag.ts            # Tag CRUD + hierarchy
│   └── utils/
│       ├── markdown.ts       # Title/frontmatter extraction
│       ├── files.ts          # File system utilities
│       └── tickets.ts        # Ticket pattern detection
├── tests/                    # Vitest test files
├── scripts/
│   ├── setup.sh              # First-time setup script
│   ├── seed.ts               # Optional seed data
│   ├── reembed.ts            # Embedding model migration
│   ├── backup.ts             # CLI database backup
│   ├── restore.ts            # CLI database restore
│   └── query.ts              # CLI query (search, list, get)
├── docker-compose.yml        # Neo4j + Ollama containers
├── .env.example              # Configuration template
└── package.json
```

## Backup & Restore

### Via MCP Tools (from Claude Code)
```
"Back up my knowledge base" → veles_backup
"Restore from backup" → veles_restore
```

### Via CLI
```bash
# Backup
npm run backup -- --output=~/backups

# Restore on another machine
npm run restore -- --input=~/backups/veles-backup-2026-03-20T10-30-00.json
```

### Migration to Another Machine
1. On source: `npm run backup -- --output=~/Desktop`
2. Copy the JSON file to the target machine
3. On target: clone repo, `npm install && npm run setup`
4. On target: `npm run restore -- --input=/path/to/backup.json`

Backup includes all nodes, relationships, and embedding vectors. Indexes are automatically recreated on restore.

## CLI Query

Query your knowledge base directly from the terminal — no Claude or MCP client required.

```bash
# Search (hybrid vector + keyword + graph)
npm run query -- "authentication flow"
npm run query -- "event sourcing" --tags=architecture --limit=5
npm run query -- "standup notes" --collection=meetings --brain=work

# Search and fetch full content of every result
npm run query -- "authentication flow" --full
npm run query -- "event sourcing" --full --limit=3

# List resources
npm run query -- --list
npm run query -- --list --tags=architecture --limit=20

# Get a single resource by ID or exact title
npm run query -- --get=<resource-id>
npm run query -- --get="Event Sourcing Patterns"
```

**Flags (all optional):**

| Flag | Applies to | Description |
|---|---|---|
| `--tags=a,b,c` | search, list | Filter by tags (comma-separated) |
| `--collection=x` | search, list | Filter by collection |
| `--limit=N` | search, list | Max results (default: 10) |
| `--brain=name` | all | Brain namespace (default: default) |
| `--full` | search | Fetch and print the complete document for every result |

**Typical workflow:**

```bash
# 1. Search to find candidates
npm run query -- "circuit breaker pattern"

# 2. Get the full document for a specific result
npm run query -- --get=abc-123

# Or fetch everything at once
npm run query -- "circuit breaker pattern" --full
```

## Embedding Model Migration

When switching embedding models (e.g., `nomic-embed-text` to `mxbai-embed-large`):

```bash
# 1. Update .env with new model name and dimensions
# 2. Run the migration script
npm run reembed

# For a specific brain
npm run reembed -- --brain=work
```

The script is resumable — if interrupted, re-run and it picks up where it left off.

## Ticket Tagging

Associate resources with tickets from any system (Jira, Linear, GitHub Issues) using regular tags:

```
"Add this doc, tag it PROJ-1234" → tagged with proj-1234
"What do I have for BUG-42?" → searches for resources tagged bug-42
```

Ticket-pattern tags (like `PROJ-1234`) are automatically highlighted in search/list output with brackets: `[PROJ-1234]`.

When adding or editing resources, Veles detects ticket patterns in your content and suggests them as tags if not already applied.

## Troubleshooting

**Neo4j won't start:**
- Check if port 7474/7687 is already in use: `lsof -i :7687`
- For Docker: `docker compose --profile neo4j logs`
- For local: check Neo4j logs at `~/neo4j/logs/`

**Ollama connection refused:**
- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- For Docker: `docker compose --profile ollama logs`
- Pull the model manually: `ollama pull nomic-embed-text`

**MCP server not connecting to Claude Code:**
- Verify the path in settings.json is absolute
- Check that `npm run build` completed successfully
- Try running `node dist/index.js` directly to see error output

**Vector search returns no results:**
- Ensure resources have been added (check with `veles_stats`)
- Verify Neo4j vector index exists: open Neo4j Browser at `localhost:7474`, run `SHOW INDEXES`
- Check embedding dimensions match config (768 for nomic-embed-text)

## Future Roadmap

- [ ] React web UI for browsing and managing knowledge
- [ ] Image content extraction and embedding
- [ ] Auto-tagging via LLM analysis
- [ ] Multi-user support with authentication
- [ ] Deployment support (Docker image, cloud hosting)
