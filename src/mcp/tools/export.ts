import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { listResources } from "../../models/resource.js";

export function registerExportTool(server: McpServer) {
  server.tool(
    "veles_export",
    "Export resources as markdown files or JSON",
    {
      format: z
        .enum(["markdown", "json"])
        .describe("Export format: markdown (individual .md files) or json (single file)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter resources by tags"),
      collection: z
        .string()
        .optional()
        .describe("Filter resources by collection"),
      output_path: z
        .string()
        .describe("Absolute path to the output directory"),
    },
    async ({ format, tags, collection, output_path }) => {
      const resources = await listResources({
        tags,
        collection,
        limit: 10000,
      });

      await mkdir(output_path, { recursive: true });

      if (format === "json") {
        const data = resources.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          type: r.type,
          source_path: r.sourcePath,
          tags: r.tags,
          collections: r.collections,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        }));

        const filePath = join(output_path, "resources.json");
        await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      } else {
        for (const r of resources) {
          const frontmatter = [
            "---",
            `title: "${r.title.replace(/"/g, '\\"')}"`,
            `tags: [${r.tags.map((t) => `"${t}"`).join(", ")}]`,
            `created_at: "${r.createdAt}"`,
            r.sourcePath ? `source_path: "${r.sourcePath}"` : null,
            "---",
          ]
            .filter(Boolean)
            .join("\n");

          const fileContent = `${frontmatter}\n\n${r.content}`;
          const safeName = r.title
            .replace(/[^a-zA-Z0-9_\-. ]/g, "")
            .replace(/\s+/g, "_")
            .slice(0, 200);
          const fileName = `${safeName}.md`;

          await writeFile(join(output_path, fileName), fileContent, "utf-8");
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Export complete.`,
              `  Format: ${format}`,
              `  Resources exported: ${resources.length}`,
              `  Output path: ${output_path}`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
