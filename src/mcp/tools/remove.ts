import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removeResource } from "../../models/resource.js";

export function registerRemoveTool(server: McpServer) {
  server.tool(
    "veles_remove",
    "Delete a resource and all its chunks",
    {
      id: z.string().describe("Resource ID to delete"),
    },
    async ({ id }) => {
      const deleted = await removeResource(id);

      if (!deleted) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Resource not found: ${id}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Resource ${id} and all its chunks have been deleted.`,
          },
        ],
      };
    },
  );
}
