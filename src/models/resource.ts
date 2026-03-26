import neo4j from "neo4j-driver";
import { getSession } from "../core/neo4j.js";

export interface Resource {
  id: string;
  title: string;
  content: string;
  type: string;
  sourcePath: string | null;
  owner: string;
  brain: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  collections: string[];
}

export async function getResource(
  idOrTitle: string,
  brain?: string,
): Promise<Resource | null> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (r:Resource)
      WHERE r.id = $idOrTitle OR r.title = $idOrTitle
      OPTIONAL MATCH (r)-[:TAGGED_WITH]->(t:Tag)
      OPTIONAL MATCH (r)-[:PART_OF]->(col:Collection)
      RETURN r, collect(DISTINCT t.name) AS tags, collect(DISTINCT col.name) AS collections
      LIMIT 1
      `,
      { idOrTitle },
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    const r = record.get("r").properties;
    return mapResource(r, record.get("tags") as string[], record.get("collections") as string[]);
  } finally {
    await session.close();
  }
}

export interface ListOptions {
  tags?: string[];
  collection?: string;
  type?: string;
  sort?: "created" | "updated" | "title";
  limit?: number;
  offset?: number;
  brain?: string;
}

export async function listResources(
  options: ListOptions = {},
): Promise<Resource[]> {
  const session = getSession(options.brain);
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const sort = options.sort || "updated";

  const sortField =
    sort === "title"
      ? "r.title"
      : sort === "created"
        ? "r.created_at"
        : "r.updated_at";

  try {
    let matchClause = "MATCH (r:Resource)";
    const conditions: string[] = [];

    if (options.type) {
      conditions.push("r.type = $type");
    }

    if (options.collection) {
      matchClause += "\nMATCH (r)-[:PART_OF]->(col:Collection {name: $collection})";
    }

    if (options.tags && options.tags.length > 0) {
      matchClause += "\nMATCH (r)-[:TAGGED_WITH]->(filterTag:Tag)";
      conditions.push(
        "filterTag.name IN $tags",
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await session.run(
      `
      ${matchClause}
      ${whereClause}
      OPTIONAL MATCH (r)-[:TAGGED_WITH]->(t:Tag)
      OPTIONAL MATCH (r)-[:PART_OF]->(c:Collection)
      WITH r, collect(DISTINCT t.name) AS tags, collect(DISTINCT c.name) AS collections
      RETURN r, tags, collections
      ORDER BY ${sortField} DESC
      SKIP $offset
      LIMIT $limit
      `,
      {
        tags: options.tags?.map((t) => t.toLowerCase()),
        collection: options.collection,
        type: options.type,
        offset: neo4j.int(offset),
        limit: neo4j.int(limit),
      },
    );

    return result.records.map((record) => {
      const r = record.get("r").properties;
      return mapResource(r, record.get("tags") as string[], record.get("collections") as string[]);
    });
  } finally {
    await session.close();
  }
}

export async function updateResource(
  id: string,
  updates: { title?: string; content?: string; tags?: string[] },
  brain?: string,
): Promise<Resource | null> {
  const session = getSession(brain);
  try {
    const setClauses: string[] = ["r.updated_at = $now"];
    if (updates.title) setClauses.push("r.title = $title");
    if (updates.content) setClauses.push("r.content = $content");

    await session.run(
      `
      MATCH (r:Resource {id: $id})
      SET ${setClauses.join(", ")}
      `,
      {
        id,
        title: updates.title,
        content: updates.content,
        now: new Date().toISOString(),
      },
    );

    // Update tags if provided
    if (updates.tags) {
      await session.run(
        `
        MATCH (r:Resource {id: $id})-[rel:TAGGED_WITH]->()
        DELETE rel
        `,
        { id },
      );

      for (const tagName of updates.tags) {
        await session.run(
          `
          MATCH (r:Resource {id: $id})
          MERGE (t:Tag {name: $tagName})
          ON CREATE SET t.id = randomUUID(), t.created_at = datetime().epochMillis
          CREATE (r)-[:TAGGED_WITH]->(t)
          `,
          { id, tagName: tagName.toLowerCase() },
        );
      }
    }

    return getResource(id, brain);
  } finally {
    await session.close();
  }
}

export async function removeResource(id: string, brain?: string): Promise<boolean> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $id})
      OPTIONAL MATCH (r)-[:HAS_CHUNK]->(c:Chunk)
      DETACH DELETE r, c
      RETURN count(r) AS deleted
      `,
      { id },
    );
    const deleted = result.records[0]?.get("deleted");
    return deleted && (typeof deleted === "number" ? deleted > 0 : deleted.toNumber() > 0);
  } finally {
    await session.close();
  }
}

function mapResource(r: Record<string, unknown>, tags: string[], collections: string[]): Resource {
  return {
    id: r.id as string,
    title: r.title as string,
    content: r.content as string,
    type: r.type as string,
    sourcePath: r.source_path as string | null,
    owner: r.owner as string,
    brain: (r.brain as string) || "default",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    tags,
    collections,
  };
}
