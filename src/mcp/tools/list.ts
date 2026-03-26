import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listResources } from "../../models/resource.js";
import { formatTagsWithTickets } from "../../utils/tickets.js";

export function registerListTool(server: McpServer) {
  server.tool(
    "veles_list",
    "List resources in the knowledge base with optional filters",
    {
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags"),
      collection: z
        .string()
        .optional()
        .describe("Filter by collection"),
      type: z
        .enum(["markdown", "text", "image"])
        .optional()
        .describe("Filter by resource type"),
      sort: z
        .enum(["created", "updated", "title"])
        .optional()
        .describe("Sort order for results"),
      limit: z
        .number()
        .int()
        .optional()
        .default(20)
        .describe("Maximum number of results to return"),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to list from (e.g. 'work', 'personal'). Defaults to 'default'"),
    },
    async ({ tags, collection, type, sort, limit, brain }) => {
      const resources = await listResources({
        tags,
        collection,
        type,
        sort,
        limit,
        brain,
      });

      if (resources.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No resources found." },
          ],
        };
      }

      const formatted = resources
        .map((r) => {
          const date = r.updatedAt || r.createdAt;
          return [
            `- ${r.title}`,
            `  ID: ${r.id}`,
            `  Type: ${r.type}`,
            `  Tags: ${formatTagsWithTickets(r.tags)}`,
            `  Date: ${date}`,
          ].join("\n");
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${resources.length} resource(s):\n\n${formatted}`,
          },
        ],
      };
    },
  );
}
