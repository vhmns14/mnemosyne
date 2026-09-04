import type { PersonaProfile, ScoredMemory, TokenBudget } from "../types.ts";

/**
 * Approximate token count using OpenAI / LLaMA BPE heuristic (~3.8 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Context Compactor & Knapsack Token Budget Packager
 * Guarantees that prompt injection never exceeds max_tokens while ensuring
 * that critical safety rules and negative constraints are packed first.
 */
export function compactContextWithBudget(
  memories: ScoredMemory[],
  maxTokens: number,
  persona?: PersonaProfile
): { formatted: string; budget: TokenBudget } {
  let estimatedTokens = 0;
  let includedItems = 0;
  let droppedItems = 0;

  const lines: string[] = [];

  // 1. Mandatory Pack: User Persona & Hardware Constraints (P0)
  if (persona) {
    const personaLines: string[] = [];
    personaLines.push(`[USER PROFILE & WORKING CONSTRAINTS]`);
    personaLines.push(`Worldview: ${persona.worldview}`);
    if (persona.hard_constraints.length > 0) {
      personaLines.push(`System Constraints: ${persona.hard_constraints.join("; ")}`);
    }
    personaLines.push(`Preferred Stack: ${JSON.stringify(persona.preferences)}`);

    const personaBlock = personaLines.join("\n");
    const personaTokens = estimateTokens(personaBlock);

    if (estimatedTokens + personaTokens <= maxTokens) {
      lines.push(personaBlock);
      estimatedTokens += personaTokens;
    }
  }

  // Separate tiers
  const negativeRules = memories.filter((m) => m.is_negative_constraint);
  const failureLessons = memories.filter((m) => m.outcome === "failure");
  const facts = memories.filter((m) => !m.is_negative_constraint && m.outcome !== "failure");

  // 2. Critical Pack: Negative Constraints & Anti-patterns (P1)
  const NEG_HEADER = `\n[🚨 CRITICAL NEGATIVE RULES - NEVER VIOLATE]`;
  const negHeaderTokens = estimateTokens(NEG_HEADER);
  let negHeaderAdded = false;
  const packedNegatives: string[] = [];

  for (const r of negativeRules) {
    const text = `⛔ ${r.content}`;
    const tok = estimateTokens(text);
    const needed = !negHeaderAdded ? negHeaderTokens + tok : tok;

    if (estimatedTokens + needed <= maxTokens) {
      if (!negHeaderAdded) {
        estimatedTokens += negHeaderTokens;
        negHeaderAdded = true;
      }
      packedNegatives.push(text);
      estimatedTokens += tok;
      includedItems++;
    } else {
      droppedItems++;
    }
  }

  if (packedNegatives.length > 0) {
    lines.push(NEG_HEADER);
    lines.push(packedNegatives.join(" | "));
  }

  // 3. Warning Pack: Past Failure Lessons (P2)
  const FAIL_HEADER = `\n[⚠️ PAST PITFALLS & FAILURE LESSONS]`;
  const failHeaderTokens = estimateTokens(FAIL_HEADER);
  let failHeaderAdded = false;
  const packedFailures: string[] = [];

  for (const f of failureLessons) {
    const reason = f.failure_reason ? ` (Reason: ${f.failure_reason})` : "";
    const text = `Avoid: ${f.content}${reason}`;
    const tok = estimateTokens(text);
    const needed = !failHeaderAdded ? failHeaderTokens + tok : tok;

    if (estimatedTokens + needed <= maxTokens) {
      if (!failHeaderAdded) {
        estimatedTokens += failHeaderTokens;
        failHeaderAdded = true;
      }
      packedFailures.push(text);
      estimatedTokens += tok;
      includedItems++;
    } else {
      droppedItems++;
    }
  }

  if (packedFailures.length > 0) {
    lines.push(FAIL_HEADER);
    lines.push(packedFailures.join(" | "));
  }

  // 4. Content Pack: Regular Contextual Memories (P3)
  const FACT_HEADER = `\n[ACTIVE CONTEXTUAL RECALL]`;
  const factHeaderTokens = estimateTokens(FACT_HEADER);
  let factHeaderAdded = false;
  const packedFacts: string[] = [];

  for (const m of facts) {
    const sourcePrefix = m.source_session ? `[src:${m.source_session}] ` : "";
    const text = `${sourcePrefix}${m.content}`;
    const tok = estimateTokens(text);
    const needed = !factHeaderAdded ? factHeaderTokens + tok : tok;

    if (estimatedTokens + needed <= maxTokens) {
      if (!factHeaderAdded) {
        estimatedTokens += factHeaderTokens;
        factHeaderAdded = true;
      }
      packedFacts.push(text);
      estimatedTokens += tok;
      includedItems++;
    } else {
      droppedItems++;
    }
  }

  if (packedFacts.length > 0) {
    lines.push(FACT_HEADER);
    lines.push(packedFacts.join(" | "));
  }

  const formatted = lines.join("\n").trim();
  const totalRawChars = memories.map((m) => m.content).join(" ").length;
  const finalTokens = estimateTokens(formatted);
  const compactionRatio = totalRawChars > 0 ? parseFloat((formatted.length / totalRawChars).toFixed(2)) : 1.0;

  return {
    formatted,
    budget: {
      max_tokens: maxTokens,
      estimated_tokens: finalTokens,
      compaction_ratio: compactionRatio,
      included_items: includedItems,
      dropped_items: droppedItems,
    },
  };
}
