import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readTextFile } from "../../utils/files.js";
import {
  extractTitle,
  extractFrontmatterTags,
} from "../../utils/markdown.js";
import { ingestResource, ingestFile } from "../../core/ingestion.js";

export function registerAddTool(server: McpServer) {
  server.tool(
    "veles_add",
    "Ingest a single resource (file or text content) into the knowledge base",
    {
      content: z.string().optional().describe("Text content to ingest"),
      file_path: z
        .string()
        .optional()
        .describe("Absolute path to file to ingest"),
      title: z.string().optional().describe("Title for the resource"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to associate with the resource"),
      collection: z
        .string()
        .optional()
        .describe("Collection to add the resource to"),
      brain: z
        .string()
        .optional()
        .describe("Brain/namespace to store in (e.g. 'work', 'personal'). Defaults to 'default'"),
    },
    async ({ content, file_path, title, tags, collection, brain }) => {
      if (!content && !file_path) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Must provide either content or file_path",
            },
          ],
        };
      }

      let textContent: string;

      if (file_path) {
        textContent = await readTextFile(file_path);
      } else {
        textContent = content!;
      }

      // Extract title from content if not provided
      const resolvedTitle = title || extractTitle(textContent);

      // Extract frontmatter tags and merge with provided tags
      const frontmatterTags = extractFrontmatterTags(textContent);
      const mergedTags = [
        ...new Set([...(tags || []), ...frontmatterTags]),
      ];

      let result;

      if (file_path) {
        result = await ingestFile(file_path, textContent, {
          tags: mergedTags,
          collection,
          brain,
        });
      } else {
        result = await ingestResource({
          title: resolvedTitle,
          content: textContent,
          type: "text",
          tags: mergedTags,
          collection,
          brain,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Resource ingested successfully.`,
              `  Resource ID: ${result.resourceId}`,
              `  Title: ${resolvedTitle}`,
              `  Chunks: ${result.chunkCount}`,
              `  Tags: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"}`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
