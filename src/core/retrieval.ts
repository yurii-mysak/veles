import neo4j from "neo4j-driver";
import { embedText } from "./embeddings.js";
import { getSession } from "./neo4j.js";

export interface SearchOptions {
  query: string;
  tags?: string[];
  collection?: string;
  limit?: number;
  brain?: string;
}

export interface SearchResult {
  resourceId: string;
  title: string;
  content: string;
  score: number;
  tags: string[];
  sourcePath: string | null;
  matchType: "vector" | "fulltext" | "graph";
}

export async function hybridSearch(
  options: SearchOptions,
): Promise<SearchResult[]> {
  const limit = options.limit || 10;
  const session = getSession(options.brain);

  try {
    const results: Map<string, SearchResult> = new Map();

    // 1. Vector search — semantic similarity
    const queryEmbedding = await embedText(options.query);
    const vectorResults = await session.run(
      `
      CALL db.index.vector.queryNodes('chunk_embeddings', $topK, $embedding)
      YIELD node AS chunk, score
      MATCH (r:Resource)-[:HAS_CHUNK]->(chunk)
      OPTIONAL MATCH (r)-[:TAGGED_WITH]->(t:Tag)
      WITH r, score, collect(DISTINCT t.name) AS tags
      ${buildTagFilter(options.tags)}
      ${buildCollectionFilter(options.collection)}
      RETURN r.id AS resourceId, r.title AS title, r.content AS content,
             score, tags, r.source_path AS sourcePath
      ORDER BY score DESC
      LIMIT $limit
      `,
      {
        embedding: queryEmbedding,
        topK: neo4j.int(limit * 2),
        limit: neo4j.int(limit),
      },
    );

    for (const record of vectorResults.records) {
      const id = record.get("resourceId") as string;
      if (!results.has(id)) {
        results.set(id, {
          resourceId: id,
          title: record.get("title") as string,
          content: truncate(record.get("content") as string, 500),
          score: record.get("score") as number,
          tags: record.get("tags") as string[],
          sourcePath: record.get("sourcePath") as string | null,
          matchType: "vector",
        });
      }
    }

    // 2. Full-text search — keyword matching
    const fulltextResults = await session.run(
      `
      CALL db.index.fulltext.queryNodes('resource_content', $query)
      YIELD node AS r, score
      OPTIONAL MATCH (r)-[:TAGGED_WITH]->(t:Tag)
      WITH r, score, collect(DISTINCT t.name) AS tags
      ${buildTagFilter(options.tags)}
      ${buildCollectionFilter(options.collection)}
      RETURN r.id AS resourceId, r.title AS title, r.content AS content,
             score, tags, r.source_path AS sourcePath
      ORDER BY score DESC
      LIMIT $limit
      `,
      { query: options.query, limit: neo4j.int(limit) },
    );

    for (const record of fulltextResults.records) {
      const id = record.get("resourceId") as string;
      if (!results.has(id)) {
        results.set(id, {
          resourceId: id,
          title: record.get("title") as string,
          content: truncate(record.get("content") as string, 500),
          score: (record.get("score") as number) * 0.8,
          tags: record.get("tags") as string[],
          sourcePath: record.get("sourcePath") as string | null,
          matchType: "fulltext",
        });
      }
    }

    // 3. Graph traversal — find related resources via shared tags
    if (results.size > 0) {
      const topIds = [...results.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((r) => r.resourceId);

      const graphResults = await session.run(
        `
        UNWIND $ids AS sourceId
        MATCH (source:Resource {id: sourceId})-[:TAGGED_WITH]->(t:Tag)<-[:TAGGED_WITH]-(related:Resource)
        WHERE related.id <> sourceId AND NOT related.id IN $ids
        OPTIONAL MATCH (related)-[:TAGGED_WITH]->(rt:Tag)
        WITH related, count(DISTINCT t) AS sharedTags, collect(DISTINCT rt.name) AS tags
        RETURN related.id AS resourceId, related.title AS title, related.content AS content,
               toFloat(sharedTags) / 10.0 AS score, tags, related.source_path AS sourcePath
        ORDER BY sharedTags DESC
        LIMIT $limit
        `,
        { ids: topIds, limit: neo4j.int(Math.max(3, limit - results.size)) },
      );

      for (const record of graphResults.records) {
        const id = record.get("resourceId") as string;
        if (!results.has(id)) {
          results.set(id, {
            resourceId: id,
            title: record.get("title") as string,
            content: truncate(record.get("content") as string, 500),
            score: record.get("score") as number,
            tags: record.get("tags") as string[],
            sourcePath: record.get("sourcePath") as string | null,
            matchType: "graph",
          });
        }
      }
    }

    // Merge and rank
    return [...results.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } finally {
    await session.close();
  }
}

function buildTagFilter(tags?: string[]): string {
  if (!tags || tags.length === 0) return "";
  const tagList = tags.map((t) => `"${t.toLowerCase()}"`).join(", ");
  return `WHERE any(tag IN tags WHERE tag IN [${tagList}])`;
}

function buildCollectionFilter(collection?: string): string {
  if (!collection) return "";
  return `
    WITH r, score, tags
    MATCH (r)-[:PART_OF]->(col:Collection {name: "${collection}"})
  `;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
