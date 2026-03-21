import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../../core/neo4j.js";

export function registerRelateTool(server: McpServer) {
  server.tool(
    "veles_relate",
    "Create or remove relationships between resources",
    {
      action: z
        .enum(["create", "remove", "list"])
        .default("create")
        .describe("Relationship action to perform"),
      source_id: z
        .string()
        .describe("Source resource ID"),
      target_id: z
        .string()
        .optional()
        .describe("Target resource ID (required for create and remove)"),
      type: z
        .string()
        .optional()
        .default("RELATES_TO")
        .describe("Relationship type (default: RELATES_TO)"),
    },
    async ({ action, source_id, target_id, type }) => {
      const relType = type || "RELATES_TO";

      switch (action) {
        case "create": {
          if (!target_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'target_id' is required for create action",
                },
              ],
            };
          }

          const session = getSession();
          try {
            // Verify both resources exist
            const check = await session.run(
              `
              OPTIONAL MATCH (a:Resource {id: $sourceId})
              OPTIONAL MATCH (b:Resource {id: $targetId})
              RETURN a IS NOT NULL AS sourceExists, b IS NOT NULL AS targetExists
              `,
              { sourceId: source_id, targetId: target_id },
            );

            const record = check.records[0];
            if (!record.get("sourceExists")) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Source resource not found: ${source_id}`,
                  },
                ],
              };
            }
            if (!record.get("targetExists")) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Target resource not found: ${target_id}`,
                  },
                ],
              };
            }

            // Create the relationship using APOC or dynamic rel type
            await session.run(
              `
              MATCH (a:Resource {id: $sourceId})
              MATCH (b:Resource {id: $targetId})
              MERGE (a)-[r:${sanitizeRelType(relType)}]->(b)
              SET r.created_at = coalesce(r.created_at, $now)
              `,
              {
                sourceId: source_id,
                targetId: target_id,
                now: new Date().toISOString(),
              },
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Relationship created: ${source_id} -[${relType}]-> ${target_id}`,
                },
              ],
            };
          } finally {
            await session.close();
          }
        }

        case "remove": {
          if (!target_id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: 'target_id' is required for remove action",
                },
              ],
            };
          }

          const session = getSession();
          try {
            const result = await session.run(
              `
              MATCH (a:Resource {id: $sourceId})-[r:${sanitizeRelType(relType)}]->(b:Resource {id: $targetId})
              DELETE r
              RETURN count(r) AS deleted
              `,
              { sourceId: source_id, targetId: target_id },
            );

            const deleted = result.records[0]?.get("deleted");
            const count =
              typeof deleted === "number" ? deleted : deleted.toNumber();

            if (count === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `No ${relType} relationship found between ${source_id} and ${target_id}.`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Relationship removed: ${source_id} -[${relType}]-> ${target_id}`,
                },
              ],
            };
          } finally {
            await session.close();
          }
        }

        case "list": {
          const session = getSession();
          try {
            const result = await session.run(
              `
              MATCH (a:Resource {id: $sourceId})-[r]->(b:Resource)
              RETURN type(r) AS relType, b.id AS targetId, b.title AS targetTitle, r.created_at AS createdAt
              ORDER BY type(r), b.title
              `,
              { sourceId: source_id },
            );

            if (result.records.length === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `No relationships found for resource: ${source_id}`,
                  },
                ],
              };
            }

            const rows = result.records.map((record) => {
              const rt = record.get("relType") as string;
              const tid = record.get("targetId") as string;
              const ttitle = record.get("targetTitle") as string;
              return `  -[${rt}]-> ${ttitle} (${tid})`;
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    `${result.records.length} relationship(s) for ${source_id}:`,
                    "",
                    ...rows,
                  ].join("\n"),
                },
              ],
            };
          } finally {
            await session.close();
          }
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown action: ${action}`,
              },
            ],
          };
      }
    },
  );
}

/**
 * Sanitize a relationship type string for safe use in Cypher queries.
 * Only allows alphanumeric characters and underscores.
 */
function sanitizeRelType(relType: string): string {
  const sanitized = relType.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  return sanitized || "RELATES_TO";
}
