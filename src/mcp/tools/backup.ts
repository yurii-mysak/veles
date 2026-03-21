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
