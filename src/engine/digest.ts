import type { Database } from "bun:sqlite";

export interface BrainDigest {
  timeframe_hours: number;
  generated_at: number;
  stats: {
    total_events: number;
    created: number;
    updated: number;
    forgotten: number;
    purged: number;
    superseded: number;
  };
  new_guardrails: string[];
  new_rules_and_facts: string[];
  superseded_items: string[];
  recent_playbooks: string[];
  markdown_report: string;
}

/**
 * Generates a human-readable digest and structured changelog of memory activity over the last N hours.
 */
export function generateBrainDigest(db: Database, hours: number = 24): BrainDigest {
  const cutoff = Date.now() - hours * 3600 * 1000;

  // 1. Query events from ledger
  const events = db
    .query(`SELECT event_type, count(*) as count FROM memory_events WHERE timestamp >= ? GROUP BY event_type`)
    .all(cutoff) as { event_type: string; count: number }[];

  const stats = {
    total_events: 0,
    created: 0,
    updated: 0,
    forgotten: 0,
    purged: 0,
    superseded: 0,
  };

  for (const e of events) {
    stats.total_events += e.count;
    const type = e.event_type.toUpperCase();
    if (type === "CREATED") stats.created = e.count;
    else if (type === "MUTATED") stats.updated = e.count;
    else if (type === "PURGED") stats.purged = e.count;
    else if (type === "SUPERSEDED") stats.superseded = e.count;
  }

  // 2. Fetch new negative constraints
  const newGuardrails = db
    .query(`
      SELECT content FROM memories 
      WHERE created_at >= ? AND is_active = 1 AND is_negative_constraint = 1
      ORDER BY created_at DESC LIMIT 10
    `)
    .all(cutoff) as { content: string }[];

  // 3. Fetch new general rules and facts
  const newRulesAndFacts = db
    .query(`
      SELECT content, category FROM memories 
      WHERE created_at >= ? AND is_active = 1 AND is_negative_constraint = 0
      ORDER BY created_at DESC LIMIT 15
    `)
    .all(cutoff) as { content: string; category: string }[];

  // 4. Fetch superseded / resolved conflict events
  const supersededEvents = db
    .query(`
      SELECT payload FROM memory_events 
      WHERE timestamp >= ? AND event_type = 'SUPERSEDED'
      ORDER BY timestamp DESC LIMIT 10
    `)
    .all(cutoff) as { payload: string }[];

  // 5. Fetch recently added remediation playbooks
  const playbooks = db
    .query(`
      SELECT problem_summary, trigger_pattern FROM remediations 
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT 5
    `)
    .all(cutoff) as { problem_summary: string; trigger_pattern: string }[];

  const guardrailList = newGuardrails.map((g) => g.content);
  const rulesList = newRulesAndFacts.map((r) => `[${r.category.toUpperCase()}] ${r.content}`);
  const supersededList = supersededEvents.map((s) => s.payload || "Contradictory memory superseded");
  const playbookList = playbooks.map((p) => `${p.problem_summary} (matches: "${p.trigger_pattern}")`);

  // Build clean Markdown report
  const lines: string[] = [
    `# 🧠 Mnemosyne Brain Digest (${hours}h)`,
    `*Generated:* ${new Date().toLocaleString()}`,
    "",
    "## 📊 Activity Overview",
    `- Total Ledger Events: **${stats.total_events}**`,
    `- Newly Created Memories: **${stats.created}**`,
    `- Updated / Reinforced: **${stats.updated}**`,
    `- Superseded (Conflict Invalidation): **${stats.superseded}**`,
    `- Forgotten / Purged: **${stats.forgotten + stats.purged}**`,
    "",
  ];

  if (guardrailList.length > 0) {
    lines.push("## 🚫 Critical Guardrails Absorbed");
    for (const g of guardrailList) {
      lines.push(`- ⚠️ ${g}`);
    }
    lines.push("");
  }

  if (playbookList.length > 0) {
    lines.push("## 🛠️ New Remediation Playbooks");
    for (const p of playbookList) {
      lines.push(`- 🔧 ${p}`);
    }
    lines.push("");
  }

  if (supersededList.length > 0) {
    lines.push("## ⚡ Contradictions & Superseded Beliefs");
    for (const s of supersededList) {
      lines.push(`- 🔄 ${s}`);
    }
    lines.push("");
  }

  if (rulesList.length > 0) {
    lines.push("## 💡 Newly Learned Rules & Knowledge");
    for (const r of rulesList.slice(0, 10)) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  if (stats.total_events === 0) {
    lines.push("*(No memory modifications recorded in this timeframe)*\n");
  }

  const markdown_report = lines.join("\n");

  return {
    timeframe_hours: hours,
    generated_at: Date.now(),
    stats,
    new_guardrails: guardrailList,
    new_rules_and_facts: rulesList,
    superseded_items: supersededList,
    recent_playbooks: playbookList,
    markdown_report,
  };
}
