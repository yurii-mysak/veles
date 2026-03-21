import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";

describe("config", () => {
  it("has default Neo4j config", () => {
    expect(config.neo4j.uri).toBe("bolt://localhost:7687");
    expect(config.neo4j.username).toBe("neo4j");
    expect(config.neo4j.database).toBe("neo4j");
  });

  it("has default Ollama config", () => {
    expect(config.ollama.baseUrl).toBe("http://localhost:11434");
    expect(config.ollama.model).toBe("nomic-embed-text");
  });

  it("has default embedding dimensions", () => {
    expect(config.embedding.dimensions).toBe(768);
  });

  it("has default chunking config", () => {
    expect(config.chunking.chunkSize).toBe(1000);
    expect(config.chunking.chunkOverlap).toBe(200);
  });

  it("has default brain", () => {
    expect(config.defaultBrain).toBe("default");
  });
});
