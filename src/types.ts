/**
 * Core Types for Mnemosyne Memory Engine
 */

export type MemoryScope = "global" | "project" | "session";
export type MemoryCategory = "hardware" | "preference" | "architecture" | "rule" | "fact" | "episodic" | "negative_constraint" | "reflection";
export type MemoryImportance = "low" | "normal" | "high" | "critical";
export type MemoryOutcome = "success" | "failure" | "neutral";
export type MemoryStructureType = "freeform" | "decision_ledger" | "checklist" | "rule_matrix";
export type ContextResolution = "macro" | "meso" | "micro";

export interface MemoryRecord {
  id: string;
  content: string;
  scope: MemoryScope;
  category: MemoryCategory;
  importance: MemoryImportance;
  structure_type: MemoryStructureType;
  tags: string[]; // JSON array in DB
  access_count: number;
  last_accessed_at: number;
  created_at: number;
  updated_at: number;
  superseded_by_id: string | null;
  is_active: boolean;
  
  // Advanced Features from Zep/Graphiti, LangMem, and MemGPT
  valid_from: number;
  valid_until: number | null; // Bi-temporal validity window (Graphiti style)
  outcome: MemoryOutcome; // Retrospective learning from trial & error (LangMem style)
  failure_reason: string | null;
  is_negative_constraint: boolean; // Anti-pattern guardrail (Supermemory style)

  // Provenance & Honcho Thin Self-Healing Architecture
  peer?: string;
  source_session?: string;
  memory_type?: "declarative" | "imperative";
  contradiction_count?: number;
  confidence?: number;
  fingerprint?: string;
  status?: "active" | "superseded" | "expired";
}

export interface MemoryVector {
  memory_id: string;
  vector: Float32Array;
  dimension: number;
}

export interface EntityTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  memory_id: string | null;
  confidence: number;
  is_active: boolean;
  valid_from: number;
  valid_until: number | null;
  created_at: number;
}

export interface EntityAlias {
  alias: string;
  canonical_name: string;
  created_at: number;
}

export interface AssociativeLink {
  source_id: string;
  target_id: string;
  resonance_weight: number; // 0.0 to 1.0
  co_occurrences: number;
  last_linked_at: number;
}

export interface PersonaProfile {
  id: string;
  entity_type: "user" | "agent";
  name: string;
  worldview: string;
  hard_constraints: string[];
  preferences: Record<string, any>;
  working_style: string;
  updated_at: number;
}

export interface ScoredMemory extends MemoryRecord {
  score: number;
  vector_score: number;
  bm25_score: number;
  recency_score: number;
  resonance_boost: number;
  pagerank_score?: number; // HippoRAG Personalized PageRank Centrality
  connected_entities?: EntityTriple[];
}

export interface RecallOptions {
  query: string;
  scope?: MemoryScope | "all";
  limit?: number;
  min_relevance?: number;
  resolution?: ContextResolution;
  structure_type?: MemoryStructureType;
  enable_resonance?: boolean;
  enable_hipporag?: boolean; // Stanford HippoRAG Personalized PageRank random walk
  at_timestamp?: number; // Bi-temporal time travel query
  include_expired?: boolean;
  max_tokens?: number; // Knapsack Context Compactor budget limit
  prefer_bm25?: boolean; // Fast path: BM25/FTS5 first, skip dense vector computation
}

export interface RememberOptions {
  content: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  importance?: MemoryImportance;
  structure_type?: MemoryStructureType;
  tags?: string[];
  supersedes_query?: string;
  entities?: Array<{ subject: string; predicate: string; object: string }>;
  
  // Advanced Extensions
  valid_from?: number;
  valid_until?: number | null;
  outcome?: MemoryOutcome;
  failure_reason?: string | null;
  is_negative_constraint?: boolean;
  actor?: "user" | "agent";

  // Provenance & Honcho Thin Self-Healing Architecture
  peer?: string;
  source_session?: string;
  memory_type?: "declarative" | "imperative";
}

export interface FactInput {
  subject: string;
  predicate: string;
  object: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  peer?: string;
  source_session?: string;
  confidence?: number;
  importance?: MemoryImportance;
  valid_until?: number;
}

export interface UpsertFactResult {
  action: "inserted" | "updated" | "reinforced" | "superseded";
  fact_id: string;
  memory_id: string;
  subject: string;
  predicate: string;
  object: string;
  previous_object?: string;
  contradiction_resolved?: boolean;
}

export interface StandingCard {
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    category: string;
    importance: string;
  }>;
  formatted: string;
  token_count: number;
}

export interface DeleteBySourceOptions {
  source_session?: string;
  peer?: string;
  memory_type?: "declarative" | "imperative";
  category?: MemoryCategory;
}

export interface DeleteBySourceResult {
  memories_deleted: number;
  triples_deleted: number;
  affected_ids: string[];
}

export interface ConsolidationReport {
  pruned_memories: number;
  superseded_cleaned: number;
  links_strengthened: number;
  active_memories_remaining: number;
}

export interface RemediationPlaybook {
  id: string;
  trigger_pattern: string;
  problem_summary: string;
  root_cause: string;
  fix_steps: string[];
  scope: MemoryScope;
  success_count: number;
  created_at: number;
  updated_at: number;
}

export interface ReflectionRecord {
  id: string;
  topic: string;
  abstraction: string;
  source_memory_ids: string[];
  scope: MemoryScope;
  created_at: number;
}

export interface MemoryEvent {
  id: string;
  memory_id: string;
  event_type: "CREATED" | "MUTATED" | "SUPERSEDED" | "PURGED";
  payload: string;
  actor: "user" | "agent";
  timestamp: number;
}

export interface DoctorReport {
  health_score: number;
  total_memories: number;
  active_count: number;
  stale_count: number;
  orphaned_triples: number;
  issues_detected: string[];
  repairs_performed: string[];
}

export interface PurgeReceipt {
  memory_id: string;
  sha256_hash: string;
  purged_at: number;
  evidence: string;
}

/**
 * Token Budget & Compaction Details
 */
export interface TokenBudget {
  max_tokens: number;
  estimated_tokens: number;
  compaction_ratio: number;
  included_items: number;
  dropped_items: number;
}

/**
 * Workspace Context Auto-Scoper
 */
export interface WorkspaceContext {
  root_path: string;
  project_name: string;
  is_git: boolean;
}

/**
 * Semantic Drift Alert
 */
export interface DriftAlert {
  is_drift: boolean;
  divergence_score: number; // 0.0 to 1.0
  conflicting_memory_id?: string;
  explanation?: string;
}

/**
 * Portable Memory Pack (Sanitized sharing format without .db files)
 */
export interface MemoryPack {
  version: "1.0.0";
  exported_at: number;
  scope: string;
  checksum: string;
  memories: Array<Omit<MemoryRecord, "access_count" | "last_accessed_at">>;
  triples: Array<Omit<EntityTriple, "created_at">>;
  aliases: Array<Omit<EntityAlias, "created_at">>;
}

/**
 * Thematic Knowledge Cluster
 */
export interface TopicCluster {
  id: string;
  label: string;
  size: number;
  keywords: string[];
  memory_ids: string[];
}

/**
 * Pre-Flight Agent Firewall & Shell Interceptor
 */
export interface PreflightVerdict {
  allowed: boolean;
  risk_level: "safe" | "warning" | "blocked";
  violation_type?: "hardware_limit" | "database_hygiene" | "negative_constraint" | "custom_rule";
  blocked_reason?: string;
  recommendation?: string;
  matched_rule?: string;
  divergence_score?: number;
}

/**
 * Execution Trajectory & Tool Calibration Memory
 */
export interface TrajectoryRecord {
  id: string;
  goal: string;
  tool_name: string;
  failed_command?: string;
  error_snippet?: string;
  fixed_command: string;
  success_output_snippet?: string;
  scope: string;
  success_count: number;
  created_at: number;
  updated_at: number;
}

export interface RecordTrajectoryOptions {
  goal: string;
  tool_name?: string;
  failed_command?: string;
  error_snippet?: string;
  fixed_command: string;
  success_output_snippet?: string;
  scope?: string;
}

export interface CalibratedToolResult {
  has_match: boolean;
  demonstrations: TrajectoryRecord[];
  recommended_command?: string;
}

/**
 * Git-Anchored Staleness Detection
 */
export type StalenessStatus = "fresh" | "stale" | "unlinked";

export interface GitAnchorRecord {
  memory_id: string;
  repo_path: string;
  file_path: string;
  commit_hash: string;
  file_mtime: number;
  file_hash?: string;
  status: StalenessStatus;
  last_verified_at: number;
}

export interface StalenessReport {
  total_anchored: number;
  fresh_count: number;
  stale_count: number;
  unlinked_count: number;
  stale_items: Array<{
    memory_id: string;
    file_path: string;
    status: StalenessStatus;
    reason: string;
  }>;
}

/**
 * Autonomous Sleep & Dreamer Pass
 */
export interface DreamReport {
  timestamp: number;
  synthesized_reflections: number;
  pruned_stale_memories: number;
  compacted_graph_edges: number;
  execution_ms: number;
  details: string[];
}

export interface DreamOptions {
  decay_days?: number;
  min_cluster_size?: number;
  dry_run?: boolean;
}

/**
 * Multi-Agent Epistemic Blackboard
 */
export type BlackboardStateType = "hypothesis" | "verified_fact" | "in_progress" | "artifact" | "blocker";

export interface BlackboardEntry {
  session_id: string;
  key: string;
  value: any;
  state_type: BlackboardStateType;
  author_agent_id: string;
  version: number;
  updated_at: number;
}

/**
 * L1 Working Memory Hot Cache Telemetry
 */
export interface CacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  hit_ratio: number;
}

/**
 * Git Pre-Commit Hook Management
 */
export interface GitHookResult {
  success: boolean;
  hook_path: string;
  message: string;
}

/**
 * Autonomous Dreamer Timer & Schedule
 */
export interface DreamerTimerResult {
  success: boolean;
  timer_path: string;
  service_path: string;
  message: string;
}

/**
 * Agent Session Primer
 */
export interface SessionPrimer {
  markdown: string;
  guardrails_count: number;
  blockers_count: number;
  stale_count: number;
  trajectories_count: number;
  timestamp: number;
}

/**
 * Semantic Deduplication & Reinforcement
 */
export interface ReinforcementResult {
  reinforced: boolean;
  memory_id: string;
  similarity?: number;
  previous_access_count?: number;
  new_access_count?: number;
}

/**
 * Hermes 3-Layer Storage & Agentic Protocol Types
 */
export interface HermesNote {
  id?: number;
  peer?: string;
  session_id?: string;
  role?: string;
  content: string;
  timestamp?: number;
}

export interface HermesPattern {
  id: string;
  peer: string;
  pattern: string;
  type: "behavior" | "preference" | "workflow";
  confidence: number;
  sources: (string | number)[];
  timestamp: number;
  updated_at: number;
}

export interface HermesDreamContract {
  new_facts?: Array<{
    fact: string;
    type?: "preference" | "attribute" | "event" | "fact";
    confidence?: number;
  }>;
  supersede?: Array<{
    old_fact_id: string | number;
    reason?: string;
  }>;
  patterns?: Array<{
    pattern: string;
    type?: "behavior" | "preference" | "workflow";
    confidence?: number;
    sources?: (string | number)[];
  }>;
  card_updates?: string[];
}

export interface HermesDreamReport {
  id: string;
  session_id?: string;
  input_delta_count: number;
  output_json: string;
  facts_added: number;
  facts_superseded: number;
  patterns_found: number;
  timestamp: number;
}

export interface HermesStats {
  total_memories: number;
  active_facts: number;
  superseded_facts: number;
  notes_count: number;
  patterns_count: number;
  dreams_count: number;
  eviction_count: number;
  db_size_bytes: number;
  db_size_formatted: string;
  free_ram_mb: number;
}

export interface IngestOptions {
  peer?: string;
  session_id?: string;
  role?: string;
  content: string;
  type?: "declarative" | "imperative";
  confidence?: number;
  ttl_ms?: number;
  category?: MemoryCategory;
  is_fact?: boolean;
}

export interface IngestResult {
  stored_in_notes: boolean;
  note_id?: number;
  stored_in_facts: boolean;
  fact_id?: string;
  memory_id?: string;
  fingerprint?: string;
  action: "ingested_note" | "inserted_fact" | "reinforced_fact" | "ignored_noise";
}



