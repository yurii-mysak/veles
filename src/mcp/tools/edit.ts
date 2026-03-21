import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { MarkdownTextSplitter } from "@langchain/textsplitters";
import { getResource, updateResource } from "../../models/resource.js";
import { deleteChunksForResource } from "../../models/chunk.js";
import { embedTexts } from "../../core/embeddings.js";
import { getSession } from "../../core/neo4j.js";
import { config } from "../../config.js";

const splitter = new MarkdownTextSplitter({
  chunkSize: config.chunking.chunkSize,
  chunkOverlap: config.chunking.chunkOverlap,
});

export function registerEditTool(server: McpServer) {
  server.tool(
    "veles_edit",
    "Update resource metadata or content",
    {
      id: z.string().describe("Resource ID to update"),
      title: z.string().optional().describe("New title for the resource"),
      content: z
        .string()
        .optional()
        .describe("New content for the resource"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags for the resource (replaces existing tags)"),
    },
    async ({ id, title, content, tags }) => {
      const existing = await getResource(id);

      if (!existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Resource not found: ${id}`,
            },
          ],
        };
      }

      if (!title && !content && !tags) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Must provide at least one field to update (title, content, or tags)",
            },
          ],
        };
      }

      // Update the resource metadata
      const updated = await updateResource(id, { title, content, tags });

      // If content changed, re-chunk and re-embed
      if (content) {
        // Delete old chunks
        await deleteChunksForResource(id);

        // Split new content into chunks
        const chunks = await splitter.splitText(content);

        // Generate embeddings for all chunks
        const embeddings = await embedTexts(chunks);

        // Create new chunk nodes in neo4j
        const session = getSession();
        try {
          for (let i = 0; i < chunks.length; i++) {
            const chunkId = uuidv4();
            await session.run(
              `
              MATCH (r:Resource {id: $resourceId})
              CREATE (c:Chunk {
                id: $chunkId,
                content: $content,
                embedding: $embedding,
                position: $position,
                resource_id: $resourceId
              })
              CREATE (r)-[:HAS_CHUNK]->(c)
              `,
              {
                resourceId: id,
                chunkId,
                content: chunks[i],
                embedding: embeddings[i],
                position: i,
              },
            );
          }

          // Link chunks with NEXT relationships for ordering
          if (chunks.length > 1) {
            await session.run(
              `
              MATCH (r:Resource {id: $resourceId})-[:HAS_CHUNK]->(c:Chunk)
              WITH c ORDER BY c.position
              WITH collect(c) AS orderedChunks
              UNWIND range(0, size(orderedChunks) - 2) AS i
              WITH orderedChunks[i] AS current, orderedChunks[i + 1] AS next
              CREATE (current)-[:NEXT]->(next)
              `,
              { resourceId: id },
            );
          }
        } finally {
          await session.close();
        }
      }

      const result = updated!;
      const changes: string[] = [];
      if (title) changes.push("title");
      if (content) changes.push("content (re-chunked and re-embedded)");
      if (tags) changes.push("tags");

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Resource updated successfully.`,
              `  ID: ${result.id}`,
              `  Title: ${result.title}`,
              `  Tags: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"}`,
              `  Updated fields: ${changes.join(", ")}`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}
