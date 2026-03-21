# Veles — Project Conventions

## Overview
Veles is a personal second-brain RAG system. It's an MCP server (TypeScript) that connects Claude Code to a Neo4j knowledge graph with Ollama embeddings.

## Architecture
- **MCP server** at `src/index.ts` — entry point, stdio transport
- **Tools** in `src/mcp/tools/` — one file per tool, registered via `server.tool()`
- **Core** in `src/core/` — neo4j driver, embeddings, ingestion pipeline, retrieval
- **Models** in `src/models/` — resource, chunk, tag CRUD
- **Utils** in `src/utils/` — markdown parsing, file system helpers

## Key Patterns
- All functions that touch Neo4j accept an optional `brain?: string` parameter to route to the correct Neo4j instance
- `getSession(brain)` returns a session connected to the brain's Neo4j instance
- Brain configs are read from env vars: `VELES_BRAIN_<NAME>_URI`, etc.
- Tags are always lowercased before storage
- Resources store a `brain` property for metadata/export purposes

## Tech Stack
- TypeScript with ESM (`"type": "module"` in package.json)
- LangChain.js for embeddings and text splitting
- Neo4j 5.x Community with vector indexes
- Ollama (nomic-embed-text, 768 dimensions)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Vitest for testing

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — dev mode with tsx watch
- `npm test` — run tests
- `npm run setup` — first-time infrastructure setup

## Import Conventions
- Use `.js` extensions in imports (ESM requirement)
- Import from `../core/neo4j.js`, `../models/resource.js`, etc.

## Adding New Tools
1. Create `src/mcp/tools/<name>.ts`
2. Export `registerXxxTool(server: McpServer)` function
3. Register in `src/mcp/server.ts`
4. Accept `brain?: string` parameter if the tool touches Neo4j
