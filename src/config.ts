import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

export const config = {
  neo4j: {
    uri: process.env.NEO4J_URI || "bolt://localhost:7687",
    username: process.env.NEO4J_USERNAME || "neo4j",
    password: process.env.NEO4J_PASSWORD || "veles_local",
    database: process.env.NEO4J_DATABASE || "neo4j",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "nomic-embed-text",
  },
  embedding: {
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "768", 10),
  },
  chunking: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || "1000", 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "200", 10),
  },
  defaultBrain: process.env.VELES_DEFAULT_BRAIN || "default",
} as const;
