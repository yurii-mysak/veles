import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walkDirectory, readTextFile } from "../../utils/files.js";
import { extractFrontmatterTags } from "../../utils/markdown.js";
import { ingestFile } from "../../core/ingestion.js";

export function registerImportTool(server: McpServer) {
  server.tool(
    "veles_import",
    "Bulk import a directory of files into the knowledge base",
    {
      directory_path: z
        .string()
        .describe("Absolute path to the directory to import"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to apply to all imported files"),
      collection: z
        .string()
        .optional()
        .describe("Collection to add all imported files to"),
      recursive: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to recurse into subdirectories (default: true)"),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to import into (e.g. 'work', 'personal'). Defaults to 'default'"),
    },
    async ({ directory_path, tags, collection, recursive, brain }) => {
      const files = await walkDirectory(directory_path, recursive);
      const totalFound = files.length;
      const importedNames: string[] = [];
      const skippedImages: string[] = [];
      let errorCount = 0;

      for (const file of files) {
        if (file.isImage) {
          skippedImages.push(file.name);
          continue;
        }

        try {
          const content = await readTextFile(file.path);
          const frontmatterTags = extractFrontmatterTags(content);
          const mergedTags = [
            ...new Set([...(tags || []), ...frontmatterTags]),
          ];

          await ingestFile(file.path, content, {
            tags: mergedTags,
            collection,
            brain,
          });

          importedNames.push(file.name);
        } catch {
          errorCount++;
        }
      }

      const lines = [
        `Import complete.`,
        `  Total files found: ${totalFound}`,
        `  Successfully imported: ${importedNames.length}`,
        `  Skipped (images): ${skippedImages.length}`,
        `  Errors: ${errorCount}`,
        ``,
        `Imported files:`,
        ...importedNames.map((name) => `  - ${name}`),
      ];

      if (skippedImages.length > 0) {
        lines.push(``, `Skipped images (not yet supported):`);
        lines.push(...skippedImages.map((name) => `  - ${name}`));
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
