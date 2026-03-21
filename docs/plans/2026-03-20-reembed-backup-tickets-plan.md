# Embedding Migration, APOC Backup/Restore, Ticket Tagging — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three features to Veles: (1) resumable embedding migration script, (2) APOC-based full database backup/restore, (3) ticket-pattern tag detection in tool output. Then update docs and README.

**Architecture:** The reembed script is a standalone CLI script that queries Neo4j for stale chunks and re-embeds them via Ollama. Backup/restore uses Neo4j's APOC plugin to export/import the full graph as JSON, exposed as both MCP tools and CLI scripts. Ticket tagging adds a utility function to detect patterns like `PROJ-1234` and surfaces them in add/edit/search/list tool output formatting.

**Tech Stack:** TypeScript, Neo4j 5.x APOC, Ollama, MCP SDK, Vitest

---

### Task 1: Add `embedding_model` tracking to ingestion pipeline

**Files:**
- Modify: `src/core/ingestion.ts:73-92` (chunk creation Cypher)
- Modify: `src/mcp/tools/edit.ts:76-95` (chunk creation in edit tool)

**Step 1: Update chunk creation in `ingestResource` to include `embedding_model`**

In `src/core/ingestion.ts`, update the chunk creation Cypher (inside the for loop at line 73) to add `embedding_model`:

```typescript
      await session.run(
        `
        MATCH (r:Resource {id: $resourceId})
        CREATE (c:Chunk {
          id: $chunkId,
          content: $content,
          embedding: $embedding,
          position: $position,
          resource_id: $resourceId,
          embedding_model: $embeddingModel
        })
        CREATE (r)-[:HAS_CHUNK]->(c)
        `,
        {
          resourceId,
          chunkId,
          content: chunks[i],
          embedding: embeddings[i],
          position: i,
          embeddingModel: config.ollama.model,
        },
      );
```

**Step 2: Update chunk creation in `edit.ts` to include `embedding_model`**

In `src/mcp/tools/edit.ts`, update the chunk creation Cypher (inside the for loop at line 76) identically — add `embedding_model: $embeddingModel` to the Chunk node and pass `embeddingModel: config.ollama.model` in params. Add `import { config } from "../../config.js";` if not already present (it is at line 9).

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/core/ingestion.ts src/mcp/tools/edit.ts
git commit -m "feat: track embedding_model on Chunk nodes for migration support"
```

---

### Task 2: Create the resumable reembed script

**Files:**
- Create: `scripts/reembed.ts`
- Modify: `package.json` (add `reembed` script)

**Step 1: Create `scripts/reembed.ts`**

```typescript
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

import { config } from "../src/config.js";
import { getSession, initializeIndexes, verifyConnectivity } from "../src/core/neo4j.js";
import { embedTexts } from "../src/core/embeddings.js";

const BATCH_SIZE = 50;

async function reembed(brain?: string) {
  const targetModel = config.ollama.model;
  console.log(`\nVeles Embedding Migration`);
  console.log(`========================`);
  console.log(`Target model: ${targetModel}`);
  console.log(`Target dimensions: ${config.embedding.dimensions}`);
  console.log(`Brain: ${brain || config.defaultBrain}\n`);

  // Verify connectivity
  console.log("Verifying Neo4j connectivity...");
  await verifyConnectivity(brain);
  console.log("Verifying Ollama connectivity...");
  const testEmbed = await embedTexts(["test"]);
  const actualDims = testEmbed[0].length;
  console.log(`Ollama OK — model produces ${actualDims}-dimensional vectors\n`);

  // Check if dimensions changed — need to recreate vector index
  if (actualDims !== config.embedding.dimensions) {
    console.log(`WARNING: Configured dimensions (${config.embedding.dimensions}) differ from model output (${actualDims}).`);
    console.log(`Update EMBEDDING_DIMENSIONS=${actualDims} in .env before running this script.`);
    process.exit(1);
  }

  // Drop and recreate vector index if dimensions might have changed
  const session = getSession(brain);
  try {
    // Check existing vector index dimensions
    const indexResult = await session.run(`
      SHOW INDEXES YIELD name, type, options
      WHERE name = 'chunk_embeddings'
      RETURN options
    `);

    if (indexResult.records.length > 0) {
      const options = indexResult.records[0].get("options");
      const existingDims = options?.indexConfig?.["vector.dimensions"];
      if (existingDims && existingDims !== actualDims) {
        console.log(`Recreating vector index: ${existingDims} → ${actualDims} dimensions...`);
        await session.run(`DROP INDEX chunk_embeddings IF EXISTS`);
        await initializeIndexes(brain);
        console.log("Vector index recreated.\n");
      }
    }
  } finally {
    await session.close();
  }

  // Count total chunks needing migration
  const countSession = getSession(brain);
  let totalStale: number;
  try {
    const countResult = await countSession.run(
      `MATCH (c:Chunk)
       WHERE c.embedding_model IS NULL OR c.embedding_model <> $model
       RETURN count(c) AS total`,
      { model: targetModel },
    );
    totalStale = countResult.records[0].get("total").toNumber();
  } finally {
    await countSession.close();
  }

  if (totalStale === 0) {
    console.log("All chunks are already using the target model. Nothing to do.");
    return;
  }

  console.log(`Found ${totalStale} chunk(s) to re-embed.\n`);
  let processed = 0;

  while (processed < totalStale) {
    const batchSession = getSession(brain);
    try {
      // Fetch a batch of stale chunks
      const batchResult = await batchSession.run(
        `MATCH (c:Chunk)
         WHERE c.embedding_model IS NULL OR c.embedding_model <> $model
         RETURN c.id AS id, c.content AS content
         LIMIT $limit`,
        { model: targetModel, limit: BATCH_SIZE },
      );

      const chunks = batchResult.records.map((r) => ({
        id: r.get("id") as string,
        content: r.get("content") as string,
      }));

      if (chunks.length === 0) break;

      // Embed the batch
      const embeddings = await embedTexts(chunks.map((c) => c.content));

      // Update each chunk
      for (let i = 0; i < chunks.length; i++) {
        await batchSession.run(
          `MATCH (c:Chunk {id: $id})
           SET c.embedding = $embedding, c.embedding_model = $model`,
          { id: chunks[i].id, embedding: embeddings[i], model: targetModel },
        );
      }

      processed += chunks.length;
      console.log(`Processed ${processed}/${totalStale} chunks...`);
    } finally {
      await batchSession.close();
    }
  }

  console.log(`\nMigration complete. ${processed} chunks re-embedded with ${targetModel}.`);
}

// Parse args
const brainArg = process.argv.find((a) => a.startsWith("--brain="));
const brain = brainArg ? brainArg.split("=")[1] : undefined;

reembed(brain)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
```

**Step 2: Add npm script to `package.json`**

Add to `scripts` section:
```json
"reembed": "tsx scripts/reembed.ts"
```

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add scripts/reembed.ts package.json
git commit -m "feat: add resumable embedding migration script (npm run reembed)"
```

---

### Task 3: Configure APOC for file export/import in Docker

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add APOC file config and import volume to neo4j service**

In `docker-compose.yml`, update the neo4j service to:
1. Add `neo4j_import` volume mounted at `/var/lib/neo4j/import`
2. Add APOC configuration environment variables for file export

```yaml
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - neo4j_data:/data
      - neo4j_import:/var/lib/neo4j/import
    environment:
      NEO4J_AUTH: neo4j/veles_local
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_apoc_export_file_enabled: "true"
      NEO4J_apoc_import_file_enabled: "true"
      NEO4J_apoc_import_file_use__neo4j__config: "true"
    profiles:
      - neo4j
      - all
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
```

Add to volumes section:
```yaml
  neo4j_import:
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: enable APOC file import/export in Neo4j Docker config"
```

---

### Task 4: Create `veles_backup` MCP tool

**Files:**
- Create: `src/mcp/tools/backup.ts`
- Modify: `src/mcp/server.ts` (register tool)

**Step 1: Create `src/mcp/tools/backup.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../../core/neo4j.js";

export function registerBackupTool(server: McpServer) {
  server.tool(
    "veles_backup",
    "Export full Neo4j database as JSON backup via APOC (for migration between machines)",
    {
      output_file: z
        .string()
        .describe(
          "Filename for the backup (stored in Neo4j's import directory, e.g. 'veles-backup.json')",
        ),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to backup (default: 'default')"),
    },
    async ({ output_file, brain }) => {
      const session = getSession(brain);
      try {
        // Export all nodes and relationships via APOC
        const result = await session.run(
          `CALL apoc.export.json.all($file, {useTypes: true})`,
          { file: output_file },
        );

        const record = result.records[0];
        const nodes = record.get("nodes");
        const rels = record.get("relationships");
        const properties = record.get("properties");
        const source = record.get("file");

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Backup complete.`,
                `  File: ${source} (inside Neo4j import directory)`,
                `  Nodes exported: ${nodes}`,
                `  Relationships exported: ${rels}`,
                `  Properties exported: ${properties}`,
                ``,
                `To retrieve the file from Docker:`,
                `  docker compose cp neo4j:/var/lib/neo4j/import/${output_file} ./${output_file}`,
                ``,
                `To restore on another machine:`,
                `  1. Copy the file into Neo4j's import directory`,
                `  2. Use veles_restore tool with the same filename`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Backup failed: ${msg}\n\nMake sure APOC export is enabled (NEO4J_apoc_export_file_enabled=true in docker-compose.yml).`,
            },
          ],
        };
      } finally {
        await session.close();
      }
    },
  );
}
```

**Step 2: Register in `src/mcp/server.ts`**

Add import: `import { registerBackupTool } from "./tools/backup.js";`
Add call: `registerBackupTool(server);` (after `registerStatsTool(server);`)

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/tools/backup.ts src/mcp/server.ts
git commit -m "feat: add veles_backup MCP tool (APOC full graph export)"
```

---

### Task 5: Create `veles_restore` MCP tool

**Files:**
- Create: `src/mcp/tools/restore.ts`
- Modify: `src/mcp/server.ts` (register tool)

**Step 1: Create `src/mcp/tools/restore.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession, initializeIndexes } from "../../core/neo4j.js";

export function registerRestoreTool(server: McpServer) {
  server.tool(
    "veles_restore",
    "Restore Neo4j database from a JSON backup file created by veles_backup",
    {
      input_file: z
        .string()
        .describe(
          "Backup filename (must be in Neo4j's import directory, e.g. 'veles-backup.json')",
        ),
      confirm_overwrite: z
        .boolean()
        .describe(
          "Must be true to confirm — this will DELETE all existing data before restoring",
        ),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to restore into (default: 'default')"),
    },
    async ({ input_file, confirm_overwrite, brain }) => {
      if (!confirm_overwrite) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Restore aborted. Set confirm_overwrite to true to proceed. WARNING: this will delete all existing data in the database before restoring.",
            },
          ],
        };
      }

      const session = getSession(brain);
      try {
        // Clear all existing data
        await session.run(`
          CALL apoc.periodic.iterate(
            'MATCH (n) RETURN n',
            'DETACH DELETE n',
            {batchSize: 1000}
          )
        `);

        // Drop existing indexes (they'll be recreated)
        const indexes = await session.run(`SHOW INDEXES YIELD name RETURN name`);
        for (const record of indexes.records) {
          const name = record.get("name") as string;
          // Skip system indexes
          if (!name.startsWith("__")) {
            try {
              await session.run(`DROP INDEX ${name} IF EXISTS`);
            } catch {
              // Constraints show as indexes too, try dropping as constraint
              try {
                await session.run(`DROP CONSTRAINT ${name} IF EXISTS`);
              } catch {
                // Ignore — some system indexes can't be dropped
              }
            }
          }
        }

        // Import from backup file
        const result = await session.run(
          `CALL apoc.import.json($file)`,
          { file: input_file },
        );

        const record = result.records[0];
        const nodes = record.get("nodes");
        const rels = record.get("relationships");

        // Recreate all indexes
        await initializeIndexes(brain);

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Restore complete.`,
                `  Nodes restored: ${nodes}`,
                `  Relationships restored: ${rels}`,
                `  Indexes: recreated`,
                ``,
                `The database has been fully restored from ${input_file}.`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Restore failed: ${msg}\n\nMake sure:\n  1. The backup file is in Neo4j's import directory\n  2. APOC import is enabled (NEO4J_apoc_import_file_enabled=true)\n  3. To copy the file into Docker: docker compose cp ./backup.json neo4j:/var/lib/neo4j/import/`,
            },
          ],
        };
      } finally {
        await session.close();
      }
    },
  );
}
```

**Step 2: Register in `src/mcp/server.ts`**

Add import: `import { registerRestoreTool } from "./tools/restore.js";`
Add call: `registerRestoreTool(server);` (after `registerBackupTool(server);`)

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/tools/restore.ts src/mcp/server.ts
git commit -m "feat: add veles_restore MCP tool (APOC full graph import)"
```

---

### Task 6: Create CLI backup/restore scripts

**Files:**
- Create: `scripts/backup.ts`
- Create: `scripts/restore.ts`
- Modify: `package.json` (add scripts)

**Step 1: Create `scripts/backup.ts`**

```typescript
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

import { getSession, verifyConnectivity } from "../src/core/neo4j.js";
import { execSync } from "child_process";

async function backup() {
  const outputArg = process.argv.find((a) => a.startsWith("--output="));
  const brainArg = process.argv.find((a) => a.startsWith("--brain="));
  const output = outputArg?.split("=")[1];
  const brain = brainArg?.split("=")[1];

  if (!output) {
    console.error("Usage: npm run backup -- --output=/path/to/output/directory");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `veles-backup-${timestamp}.json`;

  console.log(`Veles Backup`);
  console.log(`============`);
  console.log(`Brain: ${brain || "default"}`);
  console.log(`Output: ${output}/${filename}\n`);

  await verifyConnectivity(brain);

  const session = getSession(brain);
  try {
    const result = await session.run(
      `CALL apoc.export.json.all($file, {useTypes: true})`,
      { file: filename },
    );

    const record = result.records[0];
    console.log(`Nodes exported: ${record.get("nodes")}`);
    console.log(`Relationships exported: ${record.get("relationships")}`);

    // Copy file out of Docker container
    console.log(`\nCopying from Docker container...`);
    execSync(
      `docker compose cp neo4j:/var/lib/neo4j/import/${filename} ${resolve(output, filename)}`,
      { cwd: resolve(import.meta.dirname, ".."), stdio: "inherit" },
    );

    console.log(`\nBackup saved to: ${resolve(output, filename)}`);
  } finally {
    await session.close();
  }
}

backup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
```

**Step 2: Create `scripts/restore.ts`**

```typescript
import dotenv from "dotenv";
import { resolve, basename } from "path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

import { getSession, verifyConnectivity, initializeIndexes } from "../src/core/neo4j.js";
import { execSync } from "child_process";

async function restore() {
  const inputArg = process.argv.find((a) => a.startsWith("--input="));
  const brainArg = process.argv.find((a) => a.startsWith("--brain="));
  const input = inputArg?.split("=")[1];
  const brain = brainArg?.split("=")[1];

  if (!input) {
    console.error("Usage: npm run restore -- --input=/path/to/veles-backup.json");
    process.exit(1);
  }

  const filename = basename(input);

  console.log(`Veles Restore`);
  console.log(`=============`);
  console.log(`Brain: ${brain || "default"}`);
  console.log(`Input: ${input}\n`);
  console.log(`WARNING: This will DELETE all existing data in the target database.\n`);

  await verifyConnectivity(brain);

  // Copy file into Docker container
  console.log("Copying backup file into Docker container...");
  execSync(
    `docker compose cp ${resolve(input)} neo4j:/var/lib/neo4j/import/${filename}`,
    { cwd: resolve(import.meta.dirname, ".."), stdio: "inherit" },
  );

  const session = getSession(brain);
  try {
    // Clear existing data
    console.log("Clearing existing data...");
    await session.run(`
      CALL apoc.periodic.iterate(
        'MATCH (n) RETURN n',
        'DETACH DELETE n',
        {batchSize: 1000}
      )
    `);

    // Drop custom indexes
    const indexes = await session.run(`SHOW INDEXES YIELD name RETURN name`);
    for (const record of indexes.records) {
      const name = record.get("name") as string;
      if (!name.startsWith("__")) {
        try {
          await session.run(`DROP INDEX ${name} IF EXISTS`);
        } catch {
          try {
            await session.run(`DROP CONSTRAINT ${name} IF EXISTS`);
          } catch {
            // Ignore system indexes
          }
        }
      }
    }

    // Import
    console.log("Importing data...");
    const result = await session.run(
      `CALL apoc.import.json($file)`,
      { file: filename },
    );

    const record = result.records[0];
    console.log(`Nodes restored: ${record.get("nodes")}`);
    console.log(`Relationships restored: ${record.get("relationships")}`);

    // Recreate indexes
    console.log("Recreating indexes...");
    await initializeIndexes(brain);

    console.log("\nRestore complete.");
  } finally {
    await session.close();
  }
}

restore()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
```

**Step 3: Add npm scripts to `package.json`**

Add to `scripts`:
```json
"backup": "tsx scripts/backup.ts",
"restore": "tsx scripts/restore.ts"
```

**Step 4: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add scripts/backup.ts scripts/restore.ts package.json
git commit -m "feat: add CLI backup/restore scripts (npm run backup/restore)"
```

---

### Task 7: Add ticket pattern detection utility

**Files:**
- Create: `src/utils/tickets.ts`
- Create: `tests/tickets.test.ts`

**Step 1: Write the test**

Create `tests/tickets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectTicketPatterns, formatTagsWithTickets } from "../src/utils/tickets.js";

describe("detectTicketPatterns", () => {
  it("detects JIRA-style ticket numbers", () => {
    expect(detectTicketPatterns("Related to PROJ-1234")).toEqual(["PROJ-1234"]);
  });

  it("detects multiple tickets", () => {
    expect(detectTicketPatterns("See PROJ-1234 and BUG-42")).toEqual(["PROJ-1234", "BUG-42"]);
  });

  it("returns empty array for no tickets", () => {
    expect(detectTicketPatterns("No tickets here")).toEqual([]);
  });

  it("deduplicates tickets", () => {
    expect(detectTicketPatterns("PROJ-1234 and PROJ-1234 again")).toEqual(["PROJ-1234"]);
  });

  it("handles various formats", () => {
    expect(detectTicketPatterns("ABC-1 DEF-99999")).toEqual(["ABC-1", "DEF-99999"]);
  });
});

describe("formatTagsWithTickets", () => {
  it("highlights ticket-pattern tags", () => {
    const result = formatTagsWithTickets(["architecture", "PROJ-1234", "design"]);
    expect(result).toBe("architecture, [PROJ-1234], design");
  });

  it("handles no ticket tags", () => {
    const result = formatTagsWithTickets(["architecture", "design"]);
    expect(result).toBe("architecture, design");
  });

  it("handles empty tags", () => {
    const result = formatTagsWithTickets([]);
    expect(result).toBe("(none)");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/yuriy/Github/veles && npx vitest run tests/tickets.test.ts`
Expected: FAIL — module not found

**Step 3: Create `src/utils/tickets.ts`**

```typescript
const TICKET_PATTERN = /\b([A-Z]{2,}-\d+)\b/g;

/**
 * Detect ticket-style patterns (e.g., PROJ-1234, BUG-42) in text.
 * Returns deduplicated array of ticket numbers found.
 */
export function detectTicketPatterns(text: string): string[] {
  const matches = text.match(TICKET_PATTERN);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * Returns true if a string looks like a ticket number.
 */
export function isTicketTag(tag: string): boolean {
  return /^[A-Z]{2,}-\d+$/.test(tag.toUpperCase());
}

/**
 * Format tags array with ticket-pattern tags highlighted in brackets.
 * Example: ["arch", "PROJ-1234"] → "arch, [PROJ-1234]"
 */
export function formatTagsWithTickets(tags: string[]): string {
  if (tags.length === 0) return "(none)";
  return tags
    .map((t) => (isTicketTag(t) ? `[${t}]` : t))
    .join(", ");
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/yuriy/Github/veles && npx vitest run tests/tickets.test.ts`
Expected: PASS — all 7 tests pass

**Step 5: Commit**

```bash
git add src/utils/tickets.ts tests/tickets.test.ts
git commit -m "feat: add ticket pattern detection utility with tests"
```

---

### Task 8: Integrate ticket detection into add/edit tool output

**Files:**
- Modify: `src/mcp/tools/add.ts:82-95` (response formatting)
- Modify: `src/mcp/tools/edit.ts:117-136` (response formatting)

**Step 1: Update `src/mcp/tools/add.ts`**

Add import at top: `import { detectTicketPatterns, formatTagsWithTickets } from "../../utils/tickets.js";`

Replace the return block (lines 82-95) with:

```typescript
      // Detect ticket patterns in content
      const detectedTickets = detectTicketPatterns(textContent);
      const untaggedTickets = detectedTickets.filter(
        (t) => !mergedTags.map((tag) => tag.toUpperCase()).includes(t),
      );

      const lines = [
        `Resource ingested successfully.`,
        `  Resource ID: ${result.resourceId}`,
        `  Title: ${resolvedTitle}`,
        `  Chunks: ${result.chunkCount}`,
        `  Tags: ${formatTagsWithTickets(result.tags)}`,
      ];

      if (untaggedTickets.length > 0) {
        lines.push(
          ``,
          `  Detected ticket references not yet tagged: ${untaggedTickets.join(", ")}`,
          `  Consider adding them as tags for easier lookup.`,
        );
      }

      return {
        content: [
          { type: "text" as const, text: lines.join("\n") },
        ],
      };
```

**Step 2: Update `src/mcp/tools/edit.ts`**

Add import at top: `import { detectTicketPatterns, formatTagsWithTickets } from "../../utils/tickets.js";`

Replace `Tags: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"}` (line 130) with:
```typescript
              `  Tags: ${formatTagsWithTickets(result.tags)}`,
```

If content was updated, detect tickets in the new content and add a hint (after line 131):

```typescript
      // Detect ticket patterns in updated content
      if (content) {
        const detectedTickets = detectTicketPatterns(content);
        const currentTags = result.tags.map((t: string) => t.toUpperCase());
        const untaggedTickets = detectedTickets.filter(
          (t) => !currentTags.includes(t),
        );
        if (untaggedTickets.length > 0) {
          changes.push(
            `detected ticket references not yet tagged: ${untaggedTickets.join(", ")}`,
          );
        }
      }
```

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/tools/add.ts src/mcp/tools/edit.ts
git commit -m "feat: surface detected ticket patterns in add/edit tool output"
```

---

### Task 9: Integrate ticket formatting into search/list output

**Files:**
- Modify: `src/mcp/tools/search.ts:57` (tags formatting)
- Modify: `src/mcp/tools/list.ts:60` (tags formatting)

**Step 1: Update `src/mcp/tools/search.ts`**

Add import: `import { formatTagsWithTickets } from "../../utils/tickets.js";`

Replace line 57:
```typescript
            `   Tags: ${r.tags.length > 0 ? r.tags.join(", ") : "(none)"}`,
```
with:
```typescript
            `   Tags: ${formatTagsWithTickets(r.tags)}`,
```

**Step 2: Update `src/mcp/tools/list.ts`**

Add import: `import { formatTagsWithTickets } from "../../utils/tickets.js";`

Replace line 60:
```typescript
            `  Tags: ${r.tags.length > 0 ? r.tags.join(", ") : "(none)"}`,
```
with:
```typescript
            `  Tags: ${formatTagsWithTickets(r.tags)}`,
```

**Step 3: Run typecheck and tests**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit && npx vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add src/mcp/tools/search.ts src/mcp/tools/list.ts
git commit -m "feat: highlight ticket-pattern tags in search/list output"
```

---

### Task 10: Update README and CLAUDE.md documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: Update README.md**

Add the following sections:

After the `veles_stats` tool reference (around line 299), add:

```markdown
### `veles_backup`
Export full database as JSON backup (via APOC).

\```
Parameters:
  output_file  - Filename for backup (stored in Neo4j import dir, required)
  brain?       - Brain namespace (default: "default")
\```

### `veles_restore`
Restore database from a JSON backup file.

\```
Parameters:
  input_file       - Backup filename in Neo4j import dir (required)
  confirm_overwrite - Must be true (deletes existing data first, required)
  brain?            - Brain namespace (default: "default")
\```
```

Add a new section before "## Troubleshooting":

```markdown
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

## Embedding Model Migration

When switching embedding models (e.g., `nomic-embed-text` → `mxbai-embed-large`):

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
```

**Step 2: Update CLAUDE.md**

Add to the "Commands" section:
```markdown
- `npm run reembed` — re-embed all chunks with current model (resumable)
- `npm run backup -- --output=<dir>` — APOC backup to JSON
- `npm run restore -- --input=<file>` — APOC restore from JSON
```

Add a new section:
```markdown
## Backup/Restore Tools
- `src/mcp/tools/backup.ts` — APOC full graph export
- `src/mcp/tools/restore.ts` — APOC full graph import with index recreation
- `scripts/backup.ts` — CLI backup with Docker cp
- `scripts/restore.ts` — CLI restore with Docker cp
- `scripts/reembed.ts` — Resumable embedding migration

## Ticket Patterns
- Tags matching `[A-Z]+-\d+` (e.g., PROJ-1234) are highlighted in output
- `src/utils/tickets.ts` — detection and formatting utilities
- Ticket detection runs on add/edit to suggest untagged ticket references
```

**Step 3: Update README MCP config section**

Change the README config example (around line 28) from `~/.claude/settings.json` to `~/.claude.json` (the correct location for user-level MCP config):

```markdown
Then add to your Claude Code config:

**For use in all projects** (`~/.claude.json`):
\```json
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
\```

**For use in a specific project only** (`.mcp.json` in that project's root):
Same format — committed to git so team members get it automatically.
```

**Step 4: Update the roadmap in README**

Remove the items we've now implemented:
```markdown
## Future Roadmap

- [ ] React web UI for browsing and managing knowledge
- [ ] Image content extraction and embedding
- [ ] Auto-tagging via LLM analysis
- [ ] Multi-user support with authentication
- [ ] Deployment support (Docker image, cloud hosting)
```

**Step 5: Run build to verify everything compiles**

Run: `cd /Users/yuriy/Github/veles && npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md with backup/restore, reembed, ticket tagging"
```

---

### Task 11: Run full test suite and final verification

**Step 1: Run all tests**

Run: `cd /Users/yuriy/Github/veles && npx vitest run`
Expected: All tests pass

**Step 2: Run full build**

Run: `cd /Users/yuriy/Github/veles && npm run build`
Expected: Clean compile

**Step 3: Run typecheck**

Run: `cd /Users/yuriy/Github/veles && npx tsc --noEmit`
Expected: No errors
