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
