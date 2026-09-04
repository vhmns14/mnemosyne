import type { ContextResolution, PersonaProfile, ScoredMemory } from "../types.ts";

export function formatMemories(
  memories: ScoredMemory[],
  resolution: ContextResolution = "meso",
  persona?: PersonaProfile
): string {
  // Separate critical negative constraints & failure lessons
  const negativeRules = memories.filter((m) => m.is_negative_constraint);
  const failureLessons = memories.filter((m) => m.outcome === "failure");
  const regularMemories = memories.filter((m) => !m.is_negative_constraint && m.outcome !== "failure");

  if (resolution === "macro") {
    const lines: string[] = [];
    if (persona) {
      lines.push(`[USER PROFILE & WORKING CONSTRAINTS]`);
      lines.push(`Worldview: ${persona.worldview}`);
      if (persona.hard_constraints.length > 0) {
        lines.push(`System Constraints: ${persona.hard_constraints.join("; ")}`);
      }
      lines.push(`Preferred Stack: ${JSON.stringify(persona.preferences)}`);
    }

    if (negativeRules.length > 0) {
      lines.push(`\n[🚨 CRITICAL NEGATIVE RULES - NEVER VIOLATE]`);
      lines.push(negativeRules.map((r) => `⛔ ${r.content}`).join(" | "));
    }

    if (failureLessons.length > 0) {
      lines.push(`\n[⚠️ PAST PITFALLS & FAILURE LESSONS]`);
      lines.push(failureLessons.map((f) => `Avoid: ${f.content}`).join(" | "));
    }

    if (regularMemories.length > 0) {
      lines.push(`\n[ACTIVE CONTEXTUAL RECALL]`);
      lines.push(regularMemories.map((m) => m.content).join(" | "));
    }
    return lines.join("\n");
  }

  if (resolution === "meso") {
    if (memories.length === 0) return "No relevant memories found.";

    const lines: string[] = ["### 🏛️ Recalled Context & Knowledge"];

    // 1. Negative constraints first
    if (negativeRules.length > 0) {
      lines.push("\n**🚨 Critical Negative Constraints (Do Not Violate):**");
      for (const r of negativeRules) {
        lines.push(`- 🚫 **(${r.scope})** ${r.content} *(relevance: ${(r.score * 100).toFixed(0)}%)*`);
      }
    }

    // 2. Past failure lessons
    if (failureLessons.length > 0) {
      lines.push("\n**⚠️ Past Failure Lessons & Pitfalls:**");
      for (const f of failureLessons) {
        const reason = f.failure_reason ? ` (Reason: ${f.failure_reason})` : "";
        lines.push(`- ⚠️ **(${f.scope})** ${f.content}${reason} *(relevance: ${(f.score * 100).toFixed(0)}%)*`);
      }
    }

    // 3. Regular memories
    if (regularMemories.length > 0) {
      if (negativeRules.length > 0 || failureLessons.length > 0) {
        lines.push("\n**💡 Context & Facts:**");
      }
      for (const m of regularMemories) {
        const resonanceTag = m.resonance_boost > 0 ? " ⚡[Resonant]" : "";
        const importanceTag = m.importance === "critical" || m.importance === "high" ? ` [${m.importance.toUpperCase()}]` : "";
        lines.push(`- **(${m.scope})** ${m.content}${importanceTag}${resonanceTag} *(relevance: ${(m.score * 100).toFixed(0)}%)*`);
        
        if (m.connected_entities && m.connected_entities.length > 0) {
          const triples = m.connected_entities
            .map((t) => `(${t.subject}) ──[${t.predicate}]──> (${t.object})`)
            .join(", ");
          lines.push(`  └─ Triples: ${triples}`);
        }
      }
    }

    return lines.join("\n");
  }

  // micro resolution: Deep inspectable format
  if (memories.length === 0) return "No relevant memories found.";

  const output: any[] = memories.map((m) => ({
    id: m.id,
    content: m.content,
    scope: m.scope,
    category: m.category,
    importance: m.importance,
    outcome: m.outcome,
    failure_reason: m.failure_reason,
    is_negative_constraint: m.is_negative_constraint,
    valid_from: m.valid_from ? new Date(m.valid_from).toISOString() : null,
    valid_until: m.valid_until ? new Date(m.valid_until).toISOString() : null,
    score: parseFloat(m.score.toFixed(4)),
    signals: {
      vector: parseFloat(m.vector_score.toFixed(4)),
      bm25: parseFloat(m.bm25_score.toFixed(4)),
      recency: parseFloat(m.recency_score.toFixed(4)),
      resonance: parseFloat(m.resonance_boost.toFixed(4)),
    },
    tags: m.tags,
    triples: m.connected_entities || [],
    created_at: new Date(m.created_at).toISOString(),
    last_accessed_at: new Date(m.last_accessed_at).toISOString(),
  }));

  return JSON.stringify(output, null, 2);
}
