import { getSession } from "../core/neo4j.js";

export interface Chunk {
  id: string;
  content: string;
  position: number;
  resourceId: string;
}

export async function getChunksForResource(
  resourceId: string,
  brain?: string,
): Promise<Chunk[]> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $resourceId})-[:HAS_CHUNK]->(c:Chunk)
      RETURN c
      ORDER BY c.position
      `,
      { resourceId },
    );

    return result.records.map((record) => {
      const c = record.get("c").properties;
      return {
        id: c.id,
        content: c.content,
        position: typeof c.position === "number" ? c.position : c.position.toNumber(),
        resourceId: c.resource_id,
      };
    });
  } finally {
    await session.close();
  }
}

export async function deleteChunksForResource(
  resourceId: string,
  brain?: string,
): Promise<number> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (r:Resource {id: $resourceId})-[:HAS_CHUNK]->(c:Chunk)
      DETACH DELETE c
      RETURN count(c) AS deleted
      `,
      { resourceId },
    );
    const deleted = result.records[0]?.get("deleted");
    return typeof deleted === "number" ? deleted : deleted.toNumber();
  } finally {
    await session.close();
  }
}
