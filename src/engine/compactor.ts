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

/**
 * Returns optimal token budget profile based on model family.
 */
export function getModelBudgetProfile(modelName?: string): import("../types.ts").ModelBudgetProfile {
  const clean = (modelName || "").toLowerCase().trim();
  if (clean.includes("claude")) {
    return {
      model_family: "claude",
      context_window_tokens: 200_000,
      recommended_memory_budget_tokens: 8_000,
      max_negative_constraints: 25,
      max_failure_lessons: 20,
    };
  }
  if (clean.includes("gpt") || clean.includes("o1") || clean.includes("o3") || clean.includes("openai")) {
    return {
      model_family: "gpt4",
      context_window_tokens: 128_000,
      recommended_memory_budget_tokens: 4_000,
      max_negative_constraints: 20,
      max_failure_lessons: 15,
    };
  }
  if (clean.includes("hermes")) {
    return {
      model_family: "hermes",
      context_window_tokens: 8_192,
      recommended_memory_budget_tokens: 2_000,
      max_negative_constraints: 10,
      max_failure_lessons: 8,
    };
  }
  if (clean.includes("ollama") || clean.includes("qwen") || clean.includes("llama") || clean.includes("local")) {
    return {
      model_family: "ollama",
      context_window_tokens: 8_192,
      recommended_memory_budget_tokens: 1_200,
      max_negative_constraints: 8,
      max_failure_lessons: 5,
    };
  }

  return {
    model_family: "default",
    context_window_tokens: 32_000,
    recommended_memory_budget_tokens: 2_048,
    max_negative_constraints: 15,
    max_failure_lessons: 10,
  };
}

/**
 * Adaptive context compactor: adapts token budget automatically to the target LLM.
 */
export function compactContextAdaptive(
  memories: ScoredMemory[],
  options: { model?: string; maxTokens?: number; persona?: PersonaProfile } = {}
): { formatted: string; budget: TokenBudget; profile: import("../types.ts").ModelBudgetProfile } {
  const profile = getModelBudgetProfile(options.model);
  const budget = options.maxTokens !== undefined ? options.maxTokens : profile.recommended_memory_budget_tokens;
  const result = compactContextWithBudget(memories, budget, options.persona);

  return {
    ...result,
    profile,
  };
}

