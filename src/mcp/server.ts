import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAddTool } from "./tools/add.js";
import { registerSearchTool } from "./tools/search.js";
import { registerListTool } from "./tools/list.js";
import { registerGetTool } from "./tools/get.js";
import { registerEditTool } from "./tools/edit.js";
import { registerRemoveTool } from "./tools/remove.js";
import { registerTagTool } from "./tools/tag.js";
import { registerRelateTool } from "./tools/relate.js";
import { registerImportTool } from "./tools/import.js";
import { registerExportTool } from "./tools/export.js";
import { registerStatsTool } from "./tools/stats.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "veles",
    version: "0.1.0",
  });

  registerAddTool(server);
  registerSearchTool(server);
  registerListTool(server);
  registerGetTool(server);
  registerEditTool(server);
  registerRemoveTool(server);
  registerTagTool(server);
  registerRelateTool(server);
  registerImportTool(server);
  registerExportTool(server);
  registerStatsTool(server);

  return server;
}
