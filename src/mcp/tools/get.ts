import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getResource } from "../../models/resource.js";
import { getChunksForResource } from "../../models/chunk.js";

export function registerGetTool(server: McpServer) {
  server.tool(
    "veles_get",
    "Get full resource details including content, tags, collections, and chunk count",
    {
      id: z
        .string()
        .describe("Resource ID or title to look up"),
    },
    async ({ id }) => {
      const resource = await getResource(id);

      if (!resource) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Resource not found: ${id}`,
            },
          ],
        };
      }

      const chunks = await getChunksForResource(resource.id);

      const details = [
        `Title: ${resource.title}`,
        `ID: ${resource.id}`,
        `Type: ${resource.type}`,
        `Source: ${resource.sourcePath || "(none)"}`,
        `Owner: ${resource.owner}`,
        `Created: ${resource.createdAt}`,
        `Updated: ${resource.updatedAt}`,
        `Tags: ${resource.tags.length > 0 ? resource.tags.join(", ") : "(none)"}`,
        `Collections: ${resource.collections.length > 0 ? resource.collections.join(", ") : "(none)"}`,
        `Chunks: ${chunks.length}`,
        ``,
        `--- Content ---`,
        resource.content,
      ].join("\n");

      return {
        content: [
          { type: "text" as const, text: details },
        ],
      };
    },
  );
}
