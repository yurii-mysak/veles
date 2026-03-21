#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server.js";
import { verifyConnectivity, initializeIndexes, closeDriver, listBrains } from "./core/neo4j.js";

async function main() {
  const brains = listBrains();

  // Verify connectivity and initialize indexes for all configured brains
  for (const brain of brains) {
    try {
      await verifyConnectivity(brain);
    } catch (error) {
      console.error(
        `Failed to connect to Neo4j for brain "${brain}". Make sure it's running and configured correctly.`,
      );
      console.error(error);
      // Don't exit — other brains may be available
      continue;
    }

    try {
      await initializeIndexes(brain);
    } catch (error) {
      console.error(`Failed to initialize Neo4j indexes for brain "${brain}":`, error);
    }
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on("SIGINT", async () => {
    await closeDriver();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closeDriver();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
