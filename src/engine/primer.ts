import type { Database } from "bun:sqlite";
import type { SessionPrimer } from "../types.ts";
import { scanWorkspaceStaleness } from "./staleness.ts";

/**
 * Generates an authoritative, token-compacted Session Primer markdown briefing
 * for bootstrapping AI agent sessions (Antigravity, RooCode, Claude Code, Cursor).
 */
export function generateSessionPrimer(
  db: Database,
  options: { workspacePath?: string; maxTokens?: number } = {}
): SessionPrimer {
  const now = Date.now();
  const dateStr = new Date(now).toISOString();

  // 1. Hardcoded OS/Hardware Guardrails + Dynamic Negative Constraints
  const hardcodedRules = [
    "Strict 16GB RAM Safeguard: Jangan pernah jalankan proses berat (next/opennext build, parallel workers) secara background (& / nohup). Selalu foreground.",
    "Undangan Digital Build: Dilarang build opennextjs-cloudflare / next build lokal di project undangan-digital. Deploy lewat Cloudflare Workers remote builds.",
    "Git Hygiene: File database (*.db, *.db-wal, *.db-shm) DILARANG KERAS masuk git commit.",
    "Satu task berat dalam satu waktu. Jangan jalankan build paralel.",
  ];

  const dynamicConstraints = db.query(`
    SELECT content FROM memories 
    WHERE is_negative_constraint = 1 AND is_active = 1
    ORDER BY importance = 'critical' DESC, access_count DESC
    LIMIT 10
  `).all() as Array<{ content: string }>;

  const allGuardrails = [
    ...hardcodedRules,
    ...dynamicConstraints.map((d) => d.content),
  ];

  // 2. Active Blackboard Blockers & In-Progress
  const blockers = db.query(`
    SELECT session_id, key, value, author_agent_id, updated_at 
    FROM blackboard_entries 
    WHERE state_type = 'blocker' 
    ORDER BY updated_at DESC 
    LIMIT 5
  `).all() as Array<{ session_id: string; key: string; value: string; author_agent_id: string; updated_at: number }>;

  // 3. Stale Codebase Anchors
  let staleItems: Array<{ memory_id: string; file_path: string; reason: string }> = [];
  try {
    const scan = scanWorkspaceStaleness(db);
    staleItems = scan.stale_items.slice(0, 5);
  } catch {}

  // 4. Proven Trajectories & Reflexion Remediations
  const trajectories = db.query(`
    SELECT goal, fixed_command, failed_command, error_snippet, success_count 
    FROM trajectories 
    ORDER BY success_count DESC, updated_at DESC 
    LIMIT 4
  `).all() as Array<{ goal: string; fixed_command: string; failed_command?: string; error_snippet?: string; success_count: number }>;

  const remediations = db.query(`
    SELECT problem_summary, root_cause, fix_steps, success_count 
    FROM remediations 
    ORDER BY success_count DESC 
    LIMIT 3
  `).all() as Array<{ problem_summary: string; root_cause: string; fix_steps: string; success_count: number }>;

  // Build Markdown
  const lines: string[] = [];
  lines.push("# 🧠 MNEMOSYNE SESSION PRIMER (Active Cognitive Context)");
  lines.push(`> *Generated at:* ${dateStr} | *Hardware Profile:* 16GB RAM Laptop Guard Active\n`);

  lines.push("### 🛑 Critical Negative Constraints & Laptop Guardrails (P0)");
  allGuardrails.forEach((rule, idx) => {
    lines.push(`${idx + 1}. **[GUARDRAIL]** ${rule}`);
  });
  lines.push("");

  if (blockers.length > 0) {
    lines.push("### 🚨 Active Swarm Blockers (Multi-Agent Blackboard)");
    blockers.forEach((b) => {
      let valText = b.value;
      try {
        const parsed = JSON.parse(b.value);
        valText = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      } catch {}
      lines.push(`- ⚠️ **[${b.session_id}]** \`${b.key}\`: ${valText} *(reported by ${b.author_agent_id})*`);
    });
    lines.push("");
  }

  if (staleItems.length > 0) {
    lines.push("### ⚠️ Codebase Staleness Warnings (Code Rot Detected)");
    staleItems.forEach((s) => {
      lines.push(`- 📁 \`${s.file_path}\`: ${s.reason}`);
    });
    lines.push("  *Recommendation:* Re-verify assumptions against the actual codebase files before proceeding.");
    lines.push("");
  }

  if (trajectories.length > 0 || remediations.length > 0) {
    lines.push("### 🛠️ Proven Tool Trajectories & Remediation Playbooks");
    trajectories.forEach((t) => {
      lines.push(`- **Goal:** ${t.goal}`);
      lines.push(`  *Proven Command:* \`${t.fixed_command}\` (${t.success_count}x verified)`);
    });
    remediations.forEach((r) => {
      let steps: string[] = [];
      try {
        steps = JSON.parse(r.fix_steps);
      } catch {
        steps = [r.fix_steps];
      }
      lines.push(`- **Troubleshooting:** ${r.problem_summary} (*Cause:* ${r.root_cause})`);
      lines.push(`  *Fix Steps:* ${steps.map((s) => `\`${s}\``).join(" → ")}`);
    });
    lines.push("");
  }

  lines.push("---");
  lines.push("*(Injected via Mnemosyne Second Memory Engine. Adhere strictly to all negative constraints).*");

  const markdown = lines.join("\n");

  return {
    markdown,
    guardrails_count: allGuardrails.length,
    blockers_count: blockers.length,
    stale_count: staleItems.length,
    trajectories_count: trajectories.length + remediations.length,
    timestamp: now,
  };
}
