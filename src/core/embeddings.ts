import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "../config.js";

let embeddings: OllamaEmbeddings | null = null;

export function getEmbeddings(): OllamaEmbeddings {
  if (!embeddings) {
    embeddings = new OllamaEmbeddings({
      model: config.ollama.model,
      baseUrl: config.ollama.baseUrl,
    });
  }
  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  return getEmbeddings().embedQuery(text);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return getEmbeddings().embedDocuments(texts);
}
