import { MarkdownTextSplitter } from "@langchain/textsplitters";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { embedTexts } from "./embeddings.js";
import { getSession } from "./neo4j.js";

export interface IngestOptions {
  title: string;
  content: string;
  type: "markdown" | "text" | "image";
  sourcePath?: string;
  tags?: string[];
  collection?: string;
  owner?: string;
  brain?: string;
}

export interface IngestResult {
  resourceId: string;
  chunkCount: number;
  tags: string[];
}

const splitter = new MarkdownTextSplitter({
  chunkSize: config.chunking.chunkSize,
  chunkOverlap: config.chunking.chunkOverlap,
});

export async function ingestResource(
  options: IngestOptions,
): Promise<IngestResult> {
  const resourceId = uuidv4();
  const now = new Date().toISOString();

  // Split content into chunks
  const chunks = await splitter.splitText(options.content);

  // Generate embeddings for all chunks
  const embeddings = await embedTexts(chunks);

  const session = getSession(options.brain);
  try {
    // Create Resource node
    await session.run(
      `
      CREATE (r:Resource {
        id: $id,
        title: $title,
        content: $content,
        type: $type,
        source_path: $sourcePath,
        owner: $owner,
        brain: $brain,
        created_at: $now,
        updated_at: $now
      })
      `,
      {
        id: resourceId,
        title: options.title,
        content: options.content,
        type: options.type,
        sourcePath: options.sourcePath || null,
        owner: options.owner || "default",
        brain: options.brain || config.defaultBrain,
        now,
      },
    );

    // Create Chunk nodes with embeddings and NEXT chain
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
          resourceId,
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
        { resourceId },
      );
    }

    // Create/link tags
    const tags = options.tags || [];
    for (const tagName of tags) {
      await session.run(
        `
        MERGE (t:Tag {name: $tagName})
        ON CREATE SET t.id = $tagId, t.created_at = $now
        WITH t
        MATCH (r:Resource {id: $resourceId})
        CREATE (r)-[:TAGGED_WITH]->(t)
        `,
        { tagName: tagName.toLowerCase(), tagId: uuidv4(), now, resourceId },
      );
    }

    // Link to collection if specified
    if (options.collection) {
      await session.run(
        `
        MERGE (col:Collection {name: $collectionName})
        ON CREATE SET col.id = $colId, col.description = ''
        WITH col
        MATCH (r:Resource {id: $resourceId})
        CREATE (r)-[:PART_OF]->(col)
        `,
        {
          collectionName: options.collection,
          colId: uuidv4(),
          resourceId,
        },
      );
    }

    return {
      resourceId,
      chunkCount: chunks.length,
      tags,
    };
  } finally {
    await session.close();
  }
}

export async function ingestFile(
  filePath: string,
  content: string,
  options: { tags?: string[]; collection?: string; owner?: string; brain?: string },
): Promise<IngestResult> {
  const fileName = filePath.split("/").pop() || filePath;
  const ext = fileName.split(".").pop()?.toLowerCase();

  let type: "markdown" | "text" | "image" = "text";
  if (ext === "md" || ext === "mdx") type = "markdown";
  else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || ""))
    type = "image";

  return ingestResource({
    title: fileName,
    content,
    type,
    sourcePath: filePath,
    tags: options.tags,
    collection: options.collection,
    owner: options.owner,
    brain: options.brain,
  });
}
