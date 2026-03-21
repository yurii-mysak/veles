import dotenv from "dotenv";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../.env") });

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
