import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hybridSearch } from "../../core/retrieval.js";

export function registerSearchTool(server: McpServer) {
  server.tool(
    "veles_search",
    "Hybrid search across knowledge base (vector + keyword + graph)",
    {
      query: z.string().describe("Search query"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter results by tags"),
      collection: z
        .string()
        .optional()
        .describe("Filter results by collection"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results to return"),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to search in (e.g. 'work', 'personal'). Defaults to 'default'"),
    },
    async ({ query, tags, collection, limit, brain }) => {
      const results = await hybridSearch({
        query,
        tags,
        collection,
        limit,
        brain,
      });

      if (results.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No results found." },
          ],
        };
      }

      const formatted = results
        .map((r, i) => {
          const truncatedContent =
            r.content.length > 200
              ? r.content.slice(0, 200) + "..."
              : r.content;
          return [
            `${i + 1}. ${r.title}`,
            `   ID: ${r.resourceId}`,
            `   Score: ${r.score.toFixed(4)}`,
            `   Match: ${r.matchType}`,
            `   Tags: ${r.tags.length > 0 ? r.tags.join(", ") : "(none)"}`,
            `   ${truncatedContent}`,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} result(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );
}
