import type { Database } from "bun:sqlite";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { DreamReport, DreamOptions, HermesDreamReport, HermesDreamContract } from "../types.ts";
import { CONFIG } from "../config.ts";
import { clusterMemories } from "./cluster.ts";
import { extractTriples, upsertFact } from "./dialectic.ts";

/**
 * Autonomous Hippocampal Sleep & Dreamer Consolidation Pass
 */
export async function runDreamerPass(
  db: Database,
  options: DreamOptions = {}
): Promise<DreamReport> {
  const startTime = Date.now();
  const decayDays = options.decay_days || (options as any).prune_threshold_days || (options as any).pruneThresholdDays || 14;
  const minClusterSize = options.min_cluster_size || 2;
  const dryRun = options.dry_run || (options as any).dryRun || false;
  const cutoffTime = startTime - decayDays * 24 * 60 * 60 * 1000;

  const details: string[] = [];
  let synthesizedReflections = 0;
  let prunedStaleMemories = 0;
  let compactedGraphEdges = 0;

  // ==========================================
  // Phase 1: Thematic Synthesis & Abstraction
  // ==========================================
  try {
    const clusters = clusterMemories(db, 0.50);
    for (const cl of clusters) {
      if (cl.size >= minClusterSize) {
        // Check if reflection for this topic already exists
        const existing = db.query(`
          SELECT id FROM reflections WHERE topic = ?
        `).get(cl.label);

        if (!existing) {
          const abstraction = `Thematic Synthesis (${cl.label}): Encompasses ${cl.size} related cognitive assertions regarding [${cl.keywords.join(", ")}].`;
          if (!dryRun) {
            db.query(`
              INSERT INTO reflections (id, topic, abstraction, source_memory_ids, scope, created_at)
              VALUES (?, ?, ?, ?, 'global', ?)
            `).run(randomUUID(), cl.label, abstraction, JSON.stringify(cl.memory_ids), startTime);
          }
          synthesizedReflections++;
          details.push(`Synthesized abstraction for cluster: "${cl.label}" (${cl.size} memories)`);
        }
      }
    }
  } catch (err: any) {
    details.push(`Phase 1 Synthesis warning: ${err.message}`);
  }

  // ==========================================
  // Phase 2: Ebbinghaus Decay & Pruning
  // ==========================================
  try {
    // Only prune low importance or transient facts with low access count, NEVER negative constraints
    const decayCandidates = db.query(`
      SELECT id, content, created_at, access_count 
      FROM memories
      WHERE is_active = 1
        AND is_negative_constraint = 0
        AND importance = 'low'
        AND access_count <= 1
        AND created_at < ?
    `).all(cutoffTime) as Array<{ id: string; content: string; created_at: number; access_count: number }>;

    for (const mem of decayCandidates) {
      if (!dryRun) {
        db.query(`
          UPDATE memories 
          SET is_active = 0, updated_at = ? 
          WHERE id = ?
        `).run(startTime, mem.id);

        db.query(`
          INSERT INTO memory_events (id, memory_id, event_type, payload, actor, timestamp)
          VALUES (?, ?, 'PURGED', ?, 'dreamer', ?)
        `).run(
          randomUUID(),
          mem.id,
          JSON.stringify({ reason: "Ebbinghaus natural decay (>14d, access_count <= 1)" }),
          startTime
        );
      }
      prunedStaleMemories++;
    }
    if (decayCandidates.length > 0) {
      details.push(`Decayed ${decayCandidates.length} transient unaccessed memories past ${decayDays}d half-life.`);
    }
  } catch (err: any) {
    details.push(`Phase 2 Pruning warning: ${err.message}`);
  }

  // ==========================================
  // Phase 3: Graph Edge Compaction & Orphan Cleanup
  // ==========================================
  try {
    const orphanedTriples = db.query(`
      SELECT t.id 
      FROM entity_triples t
      JOIN memories m ON t.memory_id = m.id
      WHERE t.is_active = 1 AND m.is_active = 0
    `).all() as Array<{ id: string }>;

    for (const t of orphanedTriples) {
      if (!dryRun) {
        db.query("UPDATE entity_triples SET is_active = 0 WHERE id = ?").run(t.id);
      }
      compactedGraphEdges++;
    }
    if (orphanedTriples.length > 0) {
      details.push(`Compacted ${orphanedTriples.length} orphaned entity triples from inactive memories.`);
    }
  } catch (err: any) {
    details.push(`Phase 3 Compaction warning: ${err.message}`);
  }

  const executionMs = Date.now() - startTime;
  details.push(`Dreamer pass completed in ${executionMs}ms.`);

  return {
    timestamp: startTime,
    synthesized_reflections: synthesizedReflections,
    pruned_stale_memories: prunedStaleMemories,
    compacted_graph_edges: compactedGraphEdges,
    execution_ms: executionMs,
    details,
  };
}

/**
 * Optional LLM synthesis pass (Honcho-style pattern synthesis).
 * Calls OpenAI-compatible endpoint (9router, Ollama, OpenAI) to generate rich pattern contract.
 * Automatically falls back to null on failure, timeout, or parse error.
 */
export async function callLlmSynthesis(
  deltaNotes: Array<{ id: number; peer: string; content: string }>,
  existingFacts: string[],
  customOptions?: { url?: string; apiKey?: string; model?: string }
): Promise<HermesDreamContract | null> {
  const url = customOptions?.url || CONFIG.LLM_URL;
  const apiKey = customOptions?.apiKey || CONFIG.LLM_API_KEY;
  const model = customOptions?.model || CONFIG.LLM_MODEL;

  const prompt = `Review the chronological conversation delta notes and synthesize durable long-term memories.

Current Standing Facts:
${existingFacts.length > 0 ? existingFacts.slice(0, 15).map((f) => "- " + f).join("\n") : "(none)"}

New Delta Notes:
${deltaNotes.map((n) => `[Note #${n.id}] (${n.peer}): ${n.content}`).join("\n")}

Respond ONLY with valid JSON conforming to this schema (no markdown, no backticks, no comments):
{
  "new_facts": [
    { "fact": "subject predicate object", "type": "preference" | "attribute" | "fact", "confidence": 0.9 }
  ],
  "supersede": [
    { "old_fact_id": "string", "reason": "string" }
  ],
  "patterns": [
    { "pattern": "concise workflow or habit pattern", "type": "behavior" | "preference" | "workflow", "confidence": 0.85, "sources": [1] }
  ],
  "card_updates": [
    "short standing fact"
  ]
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a concise long-term memory synthesis engine. Respond only with raw JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const contract = JSON.parse(cleaned) as HermesDreamContract;
    return contract;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Hermes Background Dreamer (Honcho-style reflection over message deltas)
 */
export async function runHermesDreamerPass(
  db: Database,
  options: {
    session_id?: string;
    batch_size?: number;
    force?: boolean;
    dry_run?: boolean;
    use_llm?: boolean;
    reset_watermark?: boolean;
    from_id?: number;
    rewind?: number;
  } = {}
): Promise<HermesDreamReport> {
  const freeRamMb = os.freemem() / (1024 * 1024);
  const now = Date.now();
  const ramSafeguardThresholdMb = 150;

  // Safeguard: skip if free RAM < 150MB unless force is true
  if (freeRamMb < ramSafeguardThresholdMb && !options.force) {
    const reason = `Free RAM (${Math.round(freeRamMb)}MB) is below safeguard (${ramSafeguardThresholdMb}MB). Pass --force to run anyway.`;
    const report: HermesDreamReport = {
      id: randomUUID(),
      session_id: options.session_id,
      input_delta_count: 0,
      output_json: JSON.stringify({ skipped: true, reason }),
      facts_added: 0,
      facts_reinforced: 0,
      facts_superseded: 0,
      patterns_found: 0,
      timestamp: now,
      skipped: true,
      skip_reason: reason,
    };
    return report;
  }

  // 1. Watermark: read last_dreamed_message_id
  const watermarkRow = db.query(`SELECT value FROM meta WHERE key = 'last_dreamed_message_id'`).get() as any;
  let lastId = watermarkRow ? parseInt(watermarkRow.value, 10) : 0;

  if (options.reset_watermark || (options.force && options.use_llm)) {
    lastId = 0;
  } else if (options.from_id !== undefined) {
    lastId = options.from_id;
  } else if (options.rewind !== undefined) {
    lastId = Math.max(0, lastId - options.rewind);
  }
  const batchSize = options.batch_size || 100;

  // 2. Fetch delta notes since watermark
  let deltaSql = `SELECT * FROM notes WHERE id > ?`;
  const params: any[] = [lastId];
  if (options.session_id) {
    deltaSql += ` AND (session_id = ? OR session_id IS NULL)`;
    params.push(options.session_id);
  }
  deltaSql += ` ORDER BY id ASC LIMIT ?`;
  params.push(batchSize);

  const deltaNotes = db.query(deltaSql).all(...params) as Array<{
    id: number;
    peer: string;
    session_id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;

  if (deltaNotes.length === 0) {
    return {
      id: randomUUID(),
      session_id: options.session_id,
      input_delta_count: 0,
      output_json: JSON.stringify({ message: "No new delta notes to process" }),
      facts_added: 0,
      facts_reinforced: 0,
      facts_superseded: 0,
      patterns_found: 0,
      timestamp: now,
    };
  }

  let factsAdded = 0;
  let factsReinforced = 0;
  let factsSuperseded = 0;
  let patternsFound = 0;

  const newFactsOutput: Array<{ fact: string; type: "preference" | "attribute" | "event" | "fact"; confidence: number }> = [];
  const supersededOutput: Array<{ old_fact_id: string | number; reason: string }> = [];
  const patternsOutput: Array<{ pattern: string; type: "behavior" | "preference" | "workflow"; confidence: number; sources: (string | number)[] }> = [];
  const cardUpdates: string[] = [];

  // 3. Try LLM Synthesis if enabled
  const shouldTryLlm = options.use_llm !== false && (CONFIG.LLM_ENABLED || options.use_llm === true);
  let llmContract: HermesDreamContract | null = null;

  if (shouldTryLlm) {
    try {
      const existingRows = db.query("SELECT content FROM memories WHERE is_active = 1 LIMIT 15").all() as any[];
      const existingFacts = existingRows.map((r) => r.content);
      llmContract = await callLlmSynthesis(deltaNotes, existingFacts);
    } catch {
      llmContract = null;
    }
  }

  // Path A: If LLM produced a valid contract, apply it
  if (llmContract && (llmContract.new_facts?.length || llmContract.patterns?.length)) {
    if (Array.isArray(llmContract.new_facts)) {
      for (const item of llmContract.new_facts) {
        if (!options.dry_run && item.fact) {
          const triples = extractTriples(item.fact);
          for (const t of triples) {
            const upsertRes = await upsertFact(db, {
              subject: t.subject,
              predicate: t.predicate,
              raw_predicate: t.raw_predicate,
              object: t.object,
              content: item.fact,
              confidence: item.confidence ?? 0.95,
              source_session: options.session_id,
            });
            if (upsertRes.action === "inserted") factsAdded++;
            else if (upsertRes.action === "reinforced") factsReinforced++;
            else if (upsertRes.action === "superseded") factsSuperseded++;
          }
        } else if (item.fact) {
          factsAdded++;
        }
        newFactsOutput.push({
          fact: item.fact,
          type: item.type || "fact",
          confidence: item.confidence ?? 0.95,
        });
      }
    }

    if (Array.isArray(llmContract.patterns)) {
      for (const p of llmContract.patterns) {
        if (!options.dry_run && p.pattern) {
          const patId = randomUUID();
          db.query(`
            INSERT INTO patterns (id, peer, pattern, type, confidence, sources, timestamp, updated_at)
            VALUES (?, 'hermes', ?, ?, ?, ?, ?, ?)
          `).run(patId, p.pattern, p.type || "preference", p.confidence ?? 0.85, JSON.stringify(p.sources || []), now, now);
        }
        patternsFound++;
        patternsOutput.push(p);
      }
    }

    if (Array.isArray(llmContract.card_updates)) {
      cardUpdates.push(...llmContract.card_updates);
    }

    if (Array.isArray(llmContract.supersede)) {
      for (const s of llmContract.supersede) {
        supersededOutput.push({ old_fact_id: s.old_fact_id, reason: s.reason || "Superseded by LLM synthesis" });
      }
    }
  } else {
    // Path B: Fast Offline Heuristic Synthesis (0 MB extra RAM fallback)
    for (const note of deltaNotes) {
      const triples = extractTriples(note.content);
      for (const t of triples) {
        const factText = `${t.subject} ${(t.raw_predicate || t.predicate).toLowerCase()} ${t.object}`;
        if (!options.dry_run) {
          const upsertRes = await upsertFact(db, {
            subject: t.subject,
            predicate: t.predicate,
            raw_predicate: t.raw_predicate,
            object: t.object,
            content: note.content,
            peer: note.peer,
            source_session: note.session_id,
            confidence: 0.90, // High confidence reflection fact
          });

          if (upsertRes.action === "inserted") {
            factsAdded++;
            newFactsOutput.push({ fact: factText, type: "attribute", confidence: 0.90 });
            cardUpdates.push(`${t.subject} ${t.predicate} ${t.object}`);
          } else if (upsertRes.action === "reinforced") {
            factsReinforced++;
          } else if (upsertRes.action === "superseded") {
            factsSuperseded++;
            supersededOutput.push({ old_fact_id: upsertRes.fact_id, reason: "Opposite polarity conflict healed by recency" });
          }
        } else {
          factsAdded++;
          newFactsOutput.push({ fact: factText, type: "attribute", confidence: 0.90 });
        }
      }

      // Pattern recognition: detect habitual patterns ("selalu", "prefer", "biasanya", "workflow")
      if (/\b(selalu|always|prefer|suka menggunakan|biasanya|kebiasaan)\b/i.test(note.content)) {
        const patId = randomUUID();
        const patternText = note.content.trim();
        const sources = [note.id];
        const confidence = 0.85;

        if (!options.dry_run) {
          db.query(`
            INSERT INTO patterns (id, peer, pattern, type, confidence, sources, timestamp, updated_at)
            VALUES (?, ?, ?, 'preference', ?, ?, ?, ?)
          `).run(patId, note.peer, patternText, confidence, JSON.stringify(sources), now, now);
        }
        patternsFound++;
        patternsOutput.push({ pattern: patternText, type: "preference", confidence, sources });
      }
    }
  }

  // Update watermark to the highest processed note ID
  const maxId = deltaNotes[deltaNotes.length - 1].id;
  if (!options.dry_run) {
    db.query(`
      INSERT OR REPLACE INTO meta (key, value, updated_at)
      VALUES ('last_dreamed_message_id', ?, ?)
    `).run(maxId.toString(), now);
  }

  const dreamContract: HermesDreamContract = {
    new_facts: newFactsOutput,
    supersede: supersededOutput,
    patterns: patternsOutput,
    card_updates: cardUpdates,
  };

  const dreamId = randomUUID();
  const outputJson = JSON.stringify(dreamContract);

  if (!options.dry_run) {
    db.query(`
      INSERT INTO dreams (id, session_id, input_delta_count, output_json, facts_added, facts_superseded, patterns_found, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dreamId, options.session_id || null, deltaNotes.length, outputJson, factsAdded, factsSuperseded, patternsFound, now);
  }

  return {
    id: dreamId,
    session_id: options.session_id,
    input_delta_count: deltaNotes.length,
    output_json: outputJson,
    facts_added: factsAdded,
    facts_reinforced: factsReinforced,
    facts_superseded: factsSuperseded,
    patterns_found: patternsFound,
    timestamp: now,
  };
}

