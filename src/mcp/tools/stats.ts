import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSession } from "../../core/neo4j.js";

export function registerStatsTool(server: McpServer) {
  server.tool(
    "veles_stats",
    "Knowledge base overview and statistics",
    {},
    async () => {
      const session = getSession();
      try {
        // Total counts
        const countsResult = await session.run(`
          OPTIONAL MATCH (r:Resource)
          WITH count(r) AS resources
          OPTIONAL MATCH (c:Chunk)
          WITH resources, count(c) AS chunks
          OPTIONAL MATCH (t:Tag)
          WITH resources, chunks, count(t) AS tags
          OPTIONAL MATCH (col:Collection)
          RETURN resources, chunks, tags, count(col) AS collections
        `);

        const counts = countsResult.records[0];
        const totalResources = toNumber(counts.get("resources"));
        const totalChunks = toNumber(counts.get("chunks"));
        const totalTags = toNumber(counts.get("tags"));
        const totalCollections = toNumber(counts.get("collections"));

        // Resources by type
        const typeResult = await session.run(`
          MATCH (r:Resource)
          RETURN r.type AS type, count(r) AS count
          ORDER BY count DESC
        `);

        const byType = typeResult.records.map((rec) => ({
          type: rec.get("type") as string,
          count: toNumber(rec.get("count")),
        }));

        // Top 10 tags by usage
        const tagResult = await session.run(`
          MATCH (r:Resource)-[:TAGGED_WITH]->(t:Tag)
          RETURN t.name AS tag, count(r) AS count
          ORDER BY count DESC
          LIMIT 10
        `);

        const topTags = tagResult.records.map((rec) => ({
          tag: rec.get("tag") as string,
          count: toNumber(rec.get("count")),
        }));

        // Most recent 5 resources
        const recentResult = await session.run(`
          MATCH (r:Resource)
          RETURN r.title AS title, r.type AS type, r.created_at AS created_at
          ORDER BY r.created_at DESC
          LIMIT 5
        `);

        const recentResources = recentResult.records.map((rec) => ({
          title: rec.get("title") as string,
          type: rec.get("type") as string,
          createdAt: rec.get("created_at") as string,
        }));

        // Format output
        const lines: string[] = [
          "=== Veles Knowledge Base Stats ===",
          "",
          "Overview:",
          `  Resources:   ${totalResources}`,
          `  Chunks:      ${totalChunks}`,
          `  Tags:        ${totalTags}`,
          `  Collections: ${totalCollections}`,
          "",
          "Resources by type:",
          ...byType.map((t) => `  ${t.type}: ${t.count}`),
        ];

        if (topTags.length > 0) {
          lines.push("", "Top tags:");
          lines.push(
            ...topTags.map((t) => `  ${t.tag} (${t.count})`),
          );
        }

        if (recentResources.length > 0) {
          lines.push("", "Recent resources:");
          lines.push(
            ...recentResources.map(
              (r) => `  [${r.type}] ${r.title} (${r.createdAt})`,
            ),
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } finally {
        await session.close();
      }
    },
  );
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return 0;
}
