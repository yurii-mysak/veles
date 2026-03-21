import { v4 as uuidv4 } from "uuid";
import { getSession } from "../core/neo4j.js";

export interface Tag {
  id: string;
  name: string;
  category: string | null;
  createdAt: string;
  resourceCount: number;
  parent: string | null;
}

export async function createTag(
  name: string,
  options?: { category?: string; parent?: string },
  brain?: string,
): Promise<Tag> {
  const session = getSession(brain);
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    await session.run(
      `
      MERGE (t:Tag {name: $name})
      ON CREATE SET t.id = $id, t.category = $category, t.created_at = $now
      `,
      {
        name: name.toLowerCase(),
        id,
        category: options?.category || null,
        now,
      },
    );

    if (options?.parent) {
      await session.run(
        `
        MATCH (child:Tag {name: $childName})
        MATCH (parent:Tag {name: $parentName})
        MERGE (child)-[:CHILD_OF]->(parent)
        `,
        {
          childName: name.toLowerCase(),
          parentName: options.parent.toLowerCase(),
        },
      );
    }

    return {
      id,
      name: name.toLowerCase(),
      category: options?.category || null,
      createdAt: now,
      resourceCount: 0,
      parent: options?.parent || null,
    };
  } finally {
    await session.close();
  }
}

export async function listTags(brain?: string): Promise<Tag[]> {
  const session = getSession(brain);
  try {
    const result = await session.run(`
      MATCH (t:Tag)
      OPTIONAL MATCH (r:Resource)-[:TAGGED_WITH]->(t)
      OPTIONAL MATCH (t)-[:CHILD_OF]->(parent:Tag)
      RETURN t, count(DISTINCT r) AS resourceCount, parent.name AS parentName
      ORDER BY resourceCount DESC
    `);

    return result.records.map((record) => {
      const t = record.get("t").properties;
      const count = record.get("resourceCount");
      return {
        id: t.id,
        name: t.name,
        category: t.category || null,
        createdAt: t.created_at,
        resourceCount: typeof count === "number" ? count : count.toNumber(),
        parent: record.get("parentName") as string | null,
      };
    });
  } finally {
    await session.close();
  }
}

export async function renameTag(
  oldName: string,
  newName: string,
  brain?: string,
): Promise<boolean> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (t:Tag {name: $oldName})
      SET t.name = $newName
      RETURN t
      `,
      { oldName: oldName.toLowerCase(), newName: newName.toLowerCase() },
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}

export async function deleteTag(name: string, brain?: string): Promise<boolean> {
  const session = getSession(brain);
  try {
    const result = await session.run(
      `
      MATCH (t:Tag {name: $name})
      DETACH DELETE t
      RETURN count(t) AS deleted
      `,
      { name: name.toLowerCase() },
    );
    const deleted = result.records[0]?.get("deleted");
    return deleted && (typeof deleted === "number" ? deleted > 0 : deleted.toNumber() > 0);
  } finally {
    await session.close();
  }
}

export async function setTagParent(
  childName: string,
  parentName: string | null,
  brain?: string,
): Promise<boolean> {
  const session = getSession(brain);
  try {
    // Remove existing parent relationship
    await session.run(
      `
      MATCH (child:Tag {name: $childName})-[rel:CHILD_OF]->()
      DELETE rel
      `,
      { childName: childName.toLowerCase() },
    );

    if (parentName) {
      await session.run(
        `
        MATCH (child:Tag {name: $childName})
        MATCH (parent:Tag {name: $parentName})
        CREATE (child)-[:CHILD_OF]->(parent)
        `,
        {
          childName: childName.toLowerCase(),
          parentName: parentName.toLowerCase(),
        },
      );
    }

    return true;
  } finally {
    await session.close();
  }
}
