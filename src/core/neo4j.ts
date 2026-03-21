import neo4j, { Driver, Session } from "neo4j-driver";
import { config } from "../config.js";

// Multi-brain support: each brain gets its own Neo4j driver
const drivers: Map<string, Driver> = new Map();

export interface BrainConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

function getBrainConfig(brain?: string): BrainConfig {
  const brainName = brain || config.defaultBrain;

  // Check for brain-specific env vars: VELES_BRAIN_<NAME>_URI, etc.
  const envPrefix = `VELES_BRAIN_${brainName.toUpperCase().replace(/-/g, "_")}`;
  const brainUri = process.env[`${envPrefix}_URI`];

  if (brainUri) {
    return {
      uri: brainUri,
      username: process.env[`${envPrefix}_USERNAME`] || config.neo4j.username,
      password: process.env[`${envPrefix}_PASSWORD`] || config.neo4j.password,
      database: process.env[`${envPrefix}_DATABASE`] || config.neo4j.database,
    };
  }

  // Fall back to default config
  return {
    uri: config.neo4j.uri,
    username: config.neo4j.username,
    password: config.neo4j.password,
    database: config.neo4j.database,
  };
}

export function getDriver(brain?: string): Driver {
  const brainName = brain || config.defaultBrain;
  let d = drivers.get(brainName);
  if (!d) {
    const cfg = getBrainConfig(brainName);
    d = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.username, cfg.password));
    drivers.set(brainName, d);
  }
  return d;
}

export function getSession(brain?: string): Session {
  const brainName = brain || config.defaultBrain;
  const cfg = getBrainConfig(brainName);
  return getDriver(brainName).session({ database: cfg.database });
}

export async function closeDriver(brain?: string): Promise<void> {
  if (brain) {
    const d = drivers.get(brain);
    if (d) {
      await d.close();
      drivers.delete(brain);
    }
  } else {
    // Close all drivers
    for (const [name, d] of drivers) {
      await d.close();
      drivers.delete(name);
    }
  }
}

export async function verifyConnectivity(brain?: string): Promise<void> {
  const d = getDriver(brain);
  await d.verifyConnectivity();
}

export function listBrains(): string[] {
  // Scan env vars for brain configs
  const brains = new Set<string>([config.defaultBrain]);
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^VELES_BRAIN_([A-Z0-9_]+)_URI$/);
    if (match) {
      brains.add(match[1].toLowerCase().replace(/_/g, "-"));
    }
  }
  return [...brains];
}

export async function initializeIndexes(brain?: string): Promise<void> {
  const session = getSession(brain);
  try {
    // Vector index on Chunk embeddings
    await session.run(`
      CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
      FOR (c:Chunk) ON (c.embedding)
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: ${config.embedding.dimensions},
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);

    // Full-text index on Resource content
    await session.run(`
      CREATE FULLTEXT INDEX resource_content IF NOT EXISTS
      FOR (r:Resource) ON EACH [r.title, r.content]
    `);

    // Full-text index on Chunk content
    await session.run(`
      CREATE FULLTEXT INDEX chunk_content IF NOT EXISTS
      FOR (c:Chunk) ON EACH [c.content]
    `);

    // Unique constraint on Tag name
    await session.run(`
      CREATE CONSTRAINT tag_name_unique IF NOT EXISTS
      FOR (t:Tag) REQUIRE t.name IS UNIQUE
    `);

    // Unique constraint on Resource id
    await session.run(`
      CREATE CONSTRAINT resource_id_unique IF NOT EXISTS
      FOR (r:Resource) REQUIRE r.id IS UNIQUE
    `);

    // Index on Resource.owner for future multi-user
    await session.run(`
      CREATE INDEX resource_owner IF NOT EXISTS
      FOR (r:Resource) ON (r.owner)
    `);

    // Unique constraint on Collection name
    await session.run(`
      CREATE CONSTRAINT collection_name_unique IF NOT EXISTS
      FOR (c:Collection) REQUIRE c.name IS UNIQUE
    `);
  } finally {
    await session.close();
  }
}
