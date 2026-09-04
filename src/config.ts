import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// Resolve default database directory ~/.mnemosyne/
const defaultDir = join(homedir(), ".mnemosyne");
if (!existsSync(defaultDir)) {
  try {
    mkdirSync(defaultDir, { recursive: true });
  } catch {
    // fallback to local directory if homedir is read-only
  }
}

export const CONFIG = {
  // Storage
  DB_PATH: process.env.MNEMO_DB_PATH || join(defaultDir, "memory.db"),
  
  // Embedding Options: "local" (built-in zero-dependency 384-d) | "albatross" | "ollama" | "openai"
  EMBEDDING_PROVIDER: process.env.MNEMO_EMBEDDING_PROVIDER || "local",
  ALBATROSS_URL: process.env.ALBATROSS_URL || "http://localhost:8787/v1/embeddings",
  ALBATROSS_API_KEY: process.env.ALBATROSS_API_KEY || "",
  OLLAMA_HOST: process.env.OLLAMA_HOST || "http://localhost:11434",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "nomic-embed-text",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  
  // REST API Daemon
  PORT: parseInt(process.env.MNEMO_PORT || "8788", 10),
  HOST: process.env.MNEMO_HOST || "127.0.0.1",

  // Retrieval Scoring Weights (Honcho + Holographic balance)
  WEIGHTS: {
    VECTOR: 0.45,
    BM25: 0.25,
    RECENCY: 0.15,
    RESONANCE: 0.15,
  },

  // Half-life in days for Ebbinghaus recency decay
  RECENCY_HALF_LIFE_DAYS: 14,

  // Spreading activation resonance threshold
  RESONANCE_DECAY_RATE: 0.6,
  MAX_HOPS: 2,
};
