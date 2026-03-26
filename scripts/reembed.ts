import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../.env") });

import neo4j from "neo4j-driver";
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
        { model: targetModel, limit: neo4j.int(BATCH_SIZE) },
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
