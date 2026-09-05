import type { Database } from "bun:sqlite";
import { searchHybrid } from "./hybrid.ts";
import { applyAssociativeResonance, recordCoOccurrence } from "./holographic.ts";
import { computeHippoPageRank } from "./hipporag.ts";
import { rememberMemory, getOrCreatePersona, addEntityAlias, getEntityAliases, consolidateMemories, upsertFact, extractAndUpsert, deleteBySource, deleteFactById, ingestMessageOrFact, getHermesStats, sweepExpiredFacts, evictLowScoreFacts } from "./dialectic.ts";
import { getStandingCard } from "./card.ts";
import { addRemediation, findRemediation, seedWorkspaceRemediations } from "./remediation.ts";
import { synthesizeReflection, getReflections } from "./reflection.ts";
import { auditMemoryHealth, repairMemoryHealth, cryptographicPurge, getMemoryTimeline, recordMemoryEvent } from "./doctor.ts";
import { formatMemories } from "./formatter.ts";
import { compactContextWithBudget } from "./compactor.ts";
import { detectSemanticDrift } from "./drift.ts";
import { clusterMemories } from "./cluster.ts";
import { exportMemoryPack, importMemoryPack } from "./pack.ts";
import { detectWorkspace } from "./workspace.ts";
import { getActiveRules, formatRules, syncRulesToFile, type RuleFormat, type RuleExportResult, type RuleSyncResult } from "./rules_exporter.ts";
import { captureFromGit, captureErrorPlaybook, type GitCaptureResult, type ErrorPlaybookCaptureResult } from "./capture.ts";
import { generateBrainDigest, type BrainDigest } from "./digest.ts";
import { createBackup, listBackups, restoreBackup, type BackupRecord, type BackupResult } from "./backup.ts";
import { installMcpConfig, checkMcpStatus, type McpClientTarget, type McpConfigResult, type McpStatusResult } from "./mcp_config.ts";
import { installSystemService, getSystemServiceStatus, controlSystemService, installDreamerTimer, getDreamerTimerStatus, type ServiceResult, type ServiceStatus } from "./service.ts";
import { installGitHook, uninstallGitHook } from "./hook.ts";
import { generateSessionPrimer } from "./primer.ts";
import { evaluatePreflight } from "./firewall.ts";
import { recordTrajectory, calibrateTool, listTrajectories } from "./trajectory.ts";
import { anchorMemory, checkMemoryStaleness, scanWorkspaceStaleness } from "./staleness.ts";
import { runDreamerPass, runHermesDreamerPass } from "./dreamer.ts";
import { BlackboardManager } from "./blackboard.ts";
import { L1HotCache } from "./cache.ts";
import { exportVault, importVault, syncVault } from "./vault.ts";
import { runLongMemEval } from "./benchmark.ts";
import { detectAndSummarizeCommunities, getCommunitySummaries } from "./community.ts";
import { getContextBlock, setContextBlock, appendContextBlock, listContextBlocks, deleteContextBlock } from "./blocks.ts";
import { randomUUID } from "node:crypto";
import type { 
  RecallOptions, RememberOptions, ScoredMemory, MemoryRecord, PersonaProfile, 
  ConsolidationReport, RemediationPlaybook, ReflectionRecord, 
  DoctorReport, PurgeReceipt, MemoryEvent, TokenBudget,
  DriftAlert, TopicCluster, MemoryPack, WorkspaceContext,
  PreflightVerdict, RecordTrajectoryOptions, CalibratedToolResult,
  TrajectoryRecord, GitAnchorRecord, StalenessReport, StalenessStatus,
  DreamReport, DreamOptions, CacheStats,
  GitHookResult, DreamerTimerResult, SessionPrimer,
  FactInput, UpsertFactResult, StandingCard, DeleteBySourceOptions, DeleteBySourceResult,
  IngestOptions, IngestResult, HermesStats, HermesDreamReport, UnifiedDreamReport,
  VaultExportResult, VaultImportResult, VaultSyncResult,
  LongMemEvalReport, LongMemEvalCase, CommunitySummaryRecord, ContextBlockRecord
} from "../types.ts";


export class MnemosyneEngine {
  private _blackboard: BlackboardManager;
  private l1Cache: L1HotCache;

  constructor(private db: Database) {
    this._blackboard = new BlackboardManager(this.db);
    this.l1Cache = new L1HotCache(64);
    // Seed default remediation playbooks (e.g. agentrouter 401 troubleshooting)
    seedWorkspaceRemediations(this.db);
  }

  /**
   * Recalls memories using hybrid search + holographic associative resonance + HippoRAG Personalized PageRank.
   */
  async recall(options: RecallOptions): Promise<{
    memories: ScoredMemory[];
    formatted: string;
    persona?: PersonaProfile;
    remediations?: RemediationPlaybook[];
    token_budget?: TokenBudget;
  }> {
    // 1. Primary Hybrid Search (Vector + BM25 + Recency + Bi-temporal + Guardrails + Structure Filter)
    const initial = await searchHybrid(this.db, options);

    // 2. Holographic Associative Spreading Activation (2-hop bidirectional)
    let memories = options.enable_resonance !== false
      ? applyAssociativeResonance(this.db, initial, options.limit || 5)
      : initial;

    // 3. Stanford HippoRAG: Personalized PageRank random walk over the graph
    if (options.enable_hipporag !== false && memories.length > 0) {
      memories = computeHippoPageRank(this.db, memories, options.limit || 5);
    }

    // 4. Recency Feedback Loop & Score Clamping (Ebbinghaus Spacing)
    const now = Date.now();
    if (memories.length > 0) {
      const updateStmt = this.db.prepare(`
        UPDATE memories
        SET access_count = access_count + 1, last_accessed_at = ?
        WHERE id = ?
      `);
      for (const m of memories) {
        updateStmt.run(now, m.id);
        m.access_count = (m.access_count || 0) + 1;
        m.last_accessed_at = now;
        m.score = Math.min(1.0, Math.max(0.0, m.score));
      }
    }

    // 5. Record co-occurrence between activated memories
    const recalledIds = memories.map((m) => m.id);
    recordCoOccurrence(this.db, recalledIds);

    // 6. Check if query matches known error symptoms for automated remediation playbooks (Reflexion)
    let matchingRemediations = findRemediation(this.db, options.query);

    // 7. Fetch User Persona if macro resolution is requested
    const persona = options.resolution === "macro"
      ? getOrCreatePersona(this.db, "user")
      : undefined;

    let tokenBudget: TokenBudget | undefined;
    let formatted: string;

    // 8. Context Compaction with Token Budget (Knapsack packing)
    if (options.max_tokens && options.max_tokens > 0) {
      const compacted = compactContextWithBudget(memories, options.max_tokens, persona);
      formatted = compacted.formatted;
      tokenBudget = compacted.budget;
    } else {
      formatted = formatMemories(memories, options.resolution || "meso", persona);
    }

    // If matching remediation playbooks exist, append them prominently to the formatted output
    if (matchingRemediations.length > 0) {
      const remedyText = matchingRemediations
        .map((r) => {
          const steps = r.fix_steps.map((s, idx) => `  ${idx + 1}. \`${s}\``).join("\n");
          return `\n🛠️ **Automated Remediation Playbook [${r.problem_summary}]:**\n*Root Cause:* ${r.root_cause}\n*Prescribed Fix Steps:*\n${steps}`;
        })
        .join("\n\n");

      formatted = `${remedyText}\n\n${formatted}`;
    }

    // Push recalled memories into L1 hot working memory cache
    for (const m of memories) {
      this.l1Cache.set(m.id, m);
    }

    return { memories, formatted, persona, remediations: matchingRemediations, token_budget: tokenBudget };
  }

  /**
   * Ingests a new memory, extracts triples, resolves conflicts, and checks anti-patterns.
   */
  async remember(options: RememberOptions): Promise<string> {
    const id = await rememberMemory(this.db, options);
    try {
      const row = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as any;
      if (row) {
        this.l1Cache.set(id, {
          ...row,
          tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
          is_active: Boolean(row.is_active),
          is_negative_constraint: Boolean(row.is_negative_constraint),
        });
      }
    } catch {}
    return id;
  }

  /**
   * Forgets or marks a memory as inactive (soft delete).
   * Safe matching: exact UUID > exact content > word-boundary matching (length >= 4).
   * Automatically deactivates linked entity triples to maintain graph integrity.
   */
  forget(idOrQuery: string): boolean {
    const trimmed = idOrQuery?.trim();
    if (!trimmed || trimmed.length < 2 || trimmed === "%" || trimmed === "_") {
      return false; // Prevent accidental mass deactivations
    }
    this.l1Cache.delete(trimmed);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const affectedIds: string[] = [];
    const now = Date.now();

    if (isUuid) {
      const res = this.db.prepare(
        `UPDATE memories SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1`
      ).run(now, trimmed);
      if (res.changes > 0) affectedIds.push(trimmed);
    } else {
      // 1. Exact match priority (prevents wiping unrelated memories containing the word)
      const exactMatches = this.db
        .query(`SELECT id FROM memories WHERE is_active = 1 AND LOWER(TRIM(content)) = LOWER(?)`)
        .all(trimmed) as any[];

      if (exactMatches.length > 0) {
        for (const m of exactMatches) affectedIds.push(m.id);
      } else {
        // 2. Strict word-boundary match (requires query length >= 4 to prevent accidental wide sweep)
        if (trimmed.length < 4) {
          return false;
        }
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordRegex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu");

        const candidates = this.db
          .query(`SELECT id, content FROM memories WHERE is_active = 1 AND content LIKE ?`)
          .all(`%${trimmed}%`) as any[];

        for (const c of candidates) {
          if (wordRegex.test(c.content)) {
            affectedIds.push(c.id);
          }
        }
      }

      if (affectedIds.length > 0) {
        const placeholders = affectedIds.map(() => "?").join(",");
        this.db
          .prepare(`UPDATE memories SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`)
          .run(now, ...affectedIds);
      }
    }

    if (affectedIds.length > 0) {
      const placeholders = affectedIds.map(() => "?").join(",");
      this.db
        .prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE memory_id IN (${placeholders})`)
        .run(now, ...affectedIds);
      for (const id of affectedIds) {
        recordMemoryEvent(this.db, id, "MUTATED", "Memory forgotten (marked inactive)", "user");
      }
      return true;
    }

    return false;
  }

  /**
   * Cryptographic Purge (Hard Delete with verifiable SHA-256 evidence receipt).
   */
  purge(idOrQuery: string): PurgeReceipt | null {
    const trimmed = idOrQuery?.trim();
    if (!trimmed || trimmed.length < 2 || trimmed === "%" || trimmed === "_") {
      return null;
    }
    return cryptographicPurge(this.db, trimmed);
  }

  /**
   * Context Doctor: Audits and optionally repairs corrupted memory state.
   */
  doctor(repair: boolean = false): DoctorReport {
    return repair ? repairMemoryHealth(this.db) : auditMemoryHealth(this.db);
  }

  /**
   * Memory Timeline: Returns the immutable event ledger history for a memory or concept.
   */
  timeline(idOrQuery: string): MemoryEvent[] {
    return getMemoryTimeline(this.db, idOrQuery);
  }

  /**
   * Gets the user/agent persona (Honcho Theory of Mind).
   */
  getPersona(entityType: "user" | "agent" = "user"): PersonaProfile {
    return getOrCreatePersona(this.db, entityType);
  }

  /**
   * Adds an entity alias for canonical resolution (Cognee style).
   */
  addAlias(alias: string, canonicalName: string): void {
    addEntityAlias(this.db, alias, canonicalName);
  }

  /**
   * Lists all registered canonical aliases.
   */
  getAliases() {
    return getEntityAliases(this.db);
  }

  /**
   * Consolidates memories, prunes expired temporal facts, and strengthens co-occurrence links (MemGPT style).
   */
  consolidate(): ConsolidationReport {
    return consolidateMemories(this.db);
  }

  /**
   * Adds an automated remediation playbook (Reflexion style).
   */
  addRemedy(playbook: {
    trigger_pattern: string;
    problem_summary: string;
    root_cause: string;
    fix_steps: string[];
    scope?: string;
  }): string {
    return addRemediation(this.db, playbook);
  }

  /**
   * Looks up remediation playbooks for an error or symptom.
   */
  getRemedies(symptomOrError: string): RemediationPlaybook[] {
    return findRemediation(this.db, symptomOrError);
  }

  /**
   * Synthesizes higher-order reflections from multiple memories (Stanford Generative Agents style).
   */
  reflect(topic: string): ReflectionRecord | null {
    return synthesizeReflection(this.db, topic);
  }

  /**
   * Retrieves reflections.
   */
  getReflections(topic?: string): ReflectionRecord[] {
    return getReflections(this.db, topic);
  }

  /**
   * Retrieves the full entity knowledge graph and associative links.
   */
  getGraph(limit: number = 50) {
    const triples = this.db
      .query(`SELECT * FROM entity_triples WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?`)
      .all(limit);

    const links = this.db
      .query(`SELECT * FROM associative_links ORDER BY resonance_weight DESC LIMIT ?`)
      .all(limit);

    return { triples, links };
  }

  /**
   * Semantic Drift Radar: Compares incoming statement against established beliefs.
   */
  async detectDrift(statement: string, threshold?: number): Promise<DriftAlert> {
    return detectSemanticDrift(this.db, statement, threshold);
  }

  /**
   * Exports sanitized memory pack with SHA-256 integrity checksum.
   */
  exportPack(scope: string = "all"): MemoryPack {
    return exportMemoryPack(this.db, scope);
  }

  /**
   * Imports memory pack into database after verifying SHA-256 checksum.
   */
  async importPack(pack: MemoryPack): Promise<{ imported_memories: number; imported_triples: number; imported_aliases: number }> {
    return importMemoryPack(this.db, pack);
  }

  /**
   * Leader Clustering: Groups active memories into thematic semantic topic clusters.
   */
  getClusters(similarityThreshold?: number): TopicCluster[] {
    return clusterMemories(this.db, similarityThreshold);
  }

  /**
   * Detects workspace root and project name from git or working directory.
   */
  getWorkspace(startDir?: string): WorkspaceContext {
    return detectWorkspace(startDir);
  }

  /**
   * Exports active rules & negative guardrails in AGENTS.md, .cursorrules, CLAUDE.md, or system prompt format.
   */
  exportRules(format?: RuleFormat, scope?: string): RuleExportResult & { negativeConstraints: any[]; standardRules: any[] } {
    const { negativeConstraints, standardRules } = getActiveRules(this.db, scope);
    const result = formatRules(negativeConstraints, standardRules, format);
    return { ...result, negativeConstraints, standardRules };
  }

  /**
   * Synchronizes active rules & negative guardrails safely into a target file (e.g. AGENTS.md, .cursorrules).
   */
  syncRules(targetPath: string, format?: RuleFormat, scope?: string): RuleSyncResult {
    return syncRulesToFile(this.db, targetPath, format, scope);
  }

  /**
   * Automatically captures the latest git commit into memory as an architectural decision, rule, or failure lesson.
   */
  async captureGit(options?: { cwd?: string; scope?: string }): Promise<GitCaptureResult> {
    return captureFromGit(this.db, options);
  }

  /**
   * Captures an operational troubleshooting error playbook (Reflexion pattern).
   */
  async captureError(options: {
    triggerPattern: string;
    problemSummary: string;
    rootCause: string;
    fixSteps: string[];
    scope?: string;
  }): Promise<ErrorPlaybookCaptureResult> {
    return captureErrorPlaybook(this.db, options);
  }

  /**
   * Generates a 24h Brain Activity Digest & changelog.
   */
  getDigest(hours: number = 24): BrainDigest {
    return generateBrainDigest(this.db, hours);
  }

  /**
   * Creates an atomic online backup snapshot of the database using VACUUM INTO.
   */
  backup(targetDir?: string): BackupResult {
    return createBackup(this.db, targetDir);
  }

  /**
   * Lists existing backup snapshots.
   */
  listBackups(targetDir?: string): BackupRecord[] {
    return listBackups(targetDir);
  }

  /**
   * Restores a backup snapshot into the active database.
   */
  restore(backupFilePath: string, targetDbPath?: string): { success: boolean; message: string } {
    return restoreBackup(backupFilePath, targetDbPath);
  }

  /**
   * Automatically configures Mnemosyne MCP into OpenCode, Claude Desktop, or Cursor configuration.
   */
  configureMcp(target: McpClientTarget, options?: { customPath?: string; bunPath?: string }): McpConfigResult {
    return installMcpConfig(target, options);
  }

  /**
   * Checks if Mnemosyne MCP is configured in the target client.
   */
  getMcpStatus(target: McpClientTarget, customPath?: string): McpStatusResult {
    return checkMcpStatus(target, customPath);
  }

  /**
   * Installs the systemd user service unit file for automated background running.
   */
  installService(options?: { enableAndStart?: boolean; customServicePath?: string }): ServiceResult {
    return installSystemService(options);
  }

  /**
   * Checks the status of the systemd user service.
   */
  getServiceStatus(customServicePath?: string): ServiceStatus {
    return getSystemServiceStatus(customServicePath);
  }

  /**
   * Controls the systemd user service (start, stop, restart).
   */
  controlService(action: "start" | "stop" | "restart"): { success: boolean; message: string } {
    return controlSystemService(action);
  }

  /**
   * Pre-Flight Agent Firewall & Shell Interceptor:
   * Validates proposed commands against 16GB laptop rules and stored negative constraints.
   */
  async preflight(commandOrAction: string, options?: { contextPath?: string; driftThreshold?: number }): Promise<PreflightVerdict> {
    return evaluatePreflight(this.db, commandOrAction, options);
  }

  /**
   * Records execution trajectories (failed command -> error -> fix -> success).
   */
  recordTrajectory(options: RecordTrajectoryOptions): TrajectoryRecord {
    return recordTrajectory(this.db, options);
  }

  /**
   * Calibrates tool execution by retrieving historical trajectory demonstrations.
   */
  calibrateTool(query: string, options?: { tool_name?: string; limit?: number }): CalibratedToolResult {
    return calibrateTool(this.db, query, options);
  }

  /**
   * Lists historical trajectories.
   */
  listTrajectories(limit?: number): TrajectoryRecord[] {
    return listTrajectories(this.db, limit);
  }

  /**
   * Anchors a memory to a codebase file and Git state.
   */
  anchorMemory(memoryId: string, filePath: string, repoPath?: string): GitAnchorRecord {
    return anchorMemory(this.db, memoryId, filePath, repoPath);
  }

  /**
   * Checks staleness of an anchored memory.
   */
  checkStaleness(memoryId: string): { status: StalenessStatus; reason: string; anchor?: GitAnchorRecord } {
    return checkMemoryStaleness(this.db, memoryId);
  }

  /**
   * Scans all anchored memories across workspace for code staleness.
   */
  scanStaleness(): StalenessReport {
    return scanWorkspaceStaleness(this.db);
  }

  /**
   * Multi-Agent Epistemic Blackboard Manager.
   */
  get blackboard(): BlackboardManager {
    return this._blackboard;
  }

  /**
   * Access to L1 Working Memory Hot Cache.
   */
  get cache(): L1HotCache {
    return this.l1Cache;
  }

  /**
   * Retrieves a single memory by ID, using the L1 hot cache if available.
   */
  getMemory(id: string): MemoryRecord | null {
    const cached = this.l1Cache.get(id);
    if (cached) return cached;

    const row = this.db.query("SELECT * FROM memories WHERE id = ? AND is_active = 1").get(id) as any;
    if (!row) return null;

    const record: MemoryRecord = {
      ...row,
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
      is_active: Boolean(row.is_active),
      is_negative_constraint: Boolean(row.is_negative_constraint),
    };
    this.l1Cache.set(id, record);
    return record;
  }

  /**
   * L1 Working Memory Hot Cache Telemetry.
   */
  getCacheStats(): CacheStats {
    return this.l1Cache.getStats();
  }

  /**
   * Installs the Git pre-commit firewall hook into the repository.
   */
  installGitHook(targetDir?: string): GitHookResult {
    return installGitHook(targetDir);
  }

  /**
   * Uninstalls the Git pre-commit firewall hook from the repository.
   */
  uninstallGitHook(targetDir?: string): GitHookResult {
    return uninstallGitHook(targetDir);
  }

  /**
   * Installs and configures systemd user timer for autonomous background dreamer consolidation.
   */
  installDreamerTimer(options?: { enableAndStart?: boolean; calendarSchedule?: string; decayDays?: number }): DreamerTimerResult {
    return installDreamerTimer(options);
  }

  /**
   * Checks status of systemd dreamer timer.
   */
  getDreamerTimerStatus(): { installed: boolean; active: boolean; statusOutput: string } {
    return getDreamerTimerStatus();
  }

  /**
   * Generates an authoritative, token-compacted Session Primer markdown briefing.
   */
  prime(options?: { workspacePath?: string; maxTokens?: number }): SessionPrimer {
    return generateSessionPrimer(this.db, options);
  }

  /**
   * Fast Path: Standing Facts Card (Honcho-style profile, 0 LLM latency, 0 vector computation).
   */
  getCard(options?: { scope?: string; limit?: number; peer?: string }): StandingCard {
    return getStandingCard(this.db, options);
  }

  /**
   * Upsert a fact with entity + predicate dedup and self-healing contradiction resolution.
   */
  async upsertFact(fact: FactInput): Promise<UpsertFactResult> {
    const res = await upsertFact(this.db, fact);
    return res;
  }

  /**
   * Extract facts from text and upsert them with dedup.
   */
  async extractAndUpsert(text: string, options?: Partial<FactInput>): Promise<UpsertFactResult[]> {
    return extractAndUpsert(this.db, text, options);
  }

  /**
   * Delete / Purge memories and triples by provenance metadata (peer, session, type).
   */
  deleteBySource(options: DeleteBySourceOptions): DeleteBySourceResult {
    const res = deleteBySource(this.db, options);
    this.l1Cache.clear();
    return res;
  }

  /**
   * Hermes Ingestion Protocol (POST /ingest): appends to raw notes and promotes facts.
   */
  async ingest(options: IngestOptions): Promise<IngestResult> {
    const res = await ingestMessageOrFact(this.db, options);
    if (res.memory_id) this.l1Cache.invalidate(res.memory_id);
    return res;
  }

  /**
   * Hermes Single Fact Deletion (DELETE /facts/:id).
   */
  deleteFact(id: string): boolean {
    const res = deleteFactById(this.db, id);
    if (res) this.l1Cache.invalidate(id);
    return res;
  }

  /**
   * Unified Autonomous Dreamer Pass.
   * Integrates Hermes delta reflection (notes -> facts, patterns, card updates)
   * and Hippocampal sleep pass (thematic clustering, Ebbinghaus decay, edge compaction).
   */
  async dream(options?: DreamOptions & {
    session_id?: string;
    batch_size?: number;
    force?: boolean;
    dry_run?: boolean;
    use_llm?: boolean;
    reset_watermark?: boolean;
    from_id?: number;
    rewind?: number;
    pass?: "all" | "delta" | "hippocampal";
  }): Promise<UnifiedDreamReport> {
    const startTime = Date.now();
    const runDelta = !options?.pass || options.pass === "all" || options.pass === "delta";
    const runHippo = !options?.pass || options.pass === "all" || options.pass === "hippocampal";

    let hermesReport: HermesDreamReport = {
      id: randomUUID(),
      session_id: options?.session_id,
      input_delta_count: 0,
      output_json: "{}",
      facts_added: 0,
      facts_reinforced: 0,
      facts_superseded: 0,
      patterns_found: 0,
      timestamp: startTime,
    };

    let hippoReport: DreamReport = {
      timestamp: startTime,
      synthesized_reflections: 0,
      pruned_stale_memories: 0,
      compacted_graph_edges: 0,
      execution_ms: 0,
      details: [],
    };

    if (runDelta) {
      hermesReport = await runHermesDreamerPass(this.db, {
        session_id: options?.session_id,
        batch_size: options?.batch_size,
        force: options?.force,
        dry_run: options?.dry_run,
        use_llm: options?.use_llm,
        reset_watermark: options?.reset_watermark,
        from_id: options?.from_id,
        rewind: options?.rewind,
      });
    }

    if (runHippo) {
      hippoReport = await runDreamerPass(this.db, options);
    }

    const executionMs = Date.now() - startTime;

    return {
      timestamp: startTime,
      input_delta_count: hermesReport.input_delta_count,
      facts_added: hermesReport.facts_added,
      facts_reinforced: hermesReport.facts_reinforced,
      facts_superseded: hermesReport.facts_superseded,
      patterns_found: hermesReport.patterns_found,
      synthesized_reflections: hippoReport.synthesized_reflections,
      pruned_stale_memories: hippoReport.pruned_stale_memories,
      compacted_graph_edges: hippoReport.compacted_graph_edges,
      execution_ms: executionMs,
      hermes: hermesReport,
      hippocampal: hippoReport,
      skipped: hermesReport.skipped,
      skip_reason: hermesReport.skip_reason,
    };
  }

  /**
   * Hermes Background Reflection Dreamer (Honcho-style delta pass only).
   */
  async dreamHermes(options?: {
    session_id?: string;
    batch_size?: number;
    force?: boolean;
    dry_run?: boolean;
    use_llm?: boolean;
    reset_watermark?: boolean;
    from_id?: number;
    rewind?: number;
  }): Promise<HermesDreamReport> {
    return runHermesDreamerPass(this.db, options);
  }

  /**
   * Hermes Observability Metrics & Storage Telemetry (GET /stats).
   */
  getStats(): HermesStats {
    return getHermesStats(this.db);
  }

  /**
   * Sweeps expired records past TTL validity window.
   */
  sweepExpired(): number {
    return sweepExpiredFacts(this.db);
  }

  /**
   * Enforces fact capacity limit by evicting lowest scoring records.
   */
  evictLowScore(maxCapacity?: number): number {
    return evictLowScoreFacts(this.db, maxCapacity);
  }

  // ==========================================
  // Fase 10: Markdown Vault Mirror Methods
  // ==========================================
  exportVault(customDir?: string): VaultExportResult {
    return exportVault(this.db, customDir);
  }

  async importVault(customDir?: string): Promise<VaultImportResult> {
    return importVault(this.db, customDir);
  }

  async syncVault(customDir?: string): Promise<VaultSyncResult> {
    return syncVault(this.db, customDir);
  }

  // ==========================================
  // Fase 11: LongMemEval Benchmark Runner
  // ==========================================
  async runBenchmark(cases?: LongMemEvalCase[]): Promise<LongMemEvalReport> {
    return runLongMemEval(this, cases);
  }

  // ==========================================
  // Fase 12: Community Summaries Methods
  // ==========================================
  detectCommunities(): CommunitySummaryRecord[] {
    return detectAndSummarizeCommunities(this.db);
  }

  getCommunities(limit?: number): CommunitySummaryRecord[] {
    return getCommunitySummaries(this.db, limit);
  }

  // ==========================================
  // Fase 13: Dynamic Working Memory Blocks
  // ==========================================
  getBlock(name: string): ContextBlockRecord | null {
    return getContextBlock(this.db, name);
  }

  setBlock(name: string, content: string, limit?: number): ContextBlockRecord {
    return setContextBlock(this.db, name, content, limit);
  }

  appendBlock(name: string, text: string): ContextBlockRecord {
    return appendContextBlock(this.db, name, text);
  }

  listBlocks(): ContextBlockRecord[] {
    return listContextBlocks(this.db);
  }

  deleteBlock(name: string): boolean {
    return deleteContextBlock(this.db, name);
  }
}



