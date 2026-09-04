import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { RemediationPlaybook } from "../types.ts";

/**
 * Remediation & Self-Healing Engine (inspired by Reflexion & SRE Playbooks)
 * Enables AI agents to look up exact diagnosed root causes and fix steps
 * when encountering error messages or system failures.
 */

export function addRemediation(
  db: Database,
  playbook: {
    trigger_pattern: string;
    problem_summary: string;
    root_cause: string;
    fix_steps: string[];
    scope?: string;
  }
): string {
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO remediations (
      id, trigger_pattern, problem_summary, root_cause, fix_steps, scope, success_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    playbook.trigger_pattern.trim(),
    playbook.problem_summary.trim(),
    playbook.root_cause.trim(),
    JSON.stringify(playbook.fix_steps),
    playbook.scope || "global",
    now,
    now
  );

  return id;
}

export function findRemediation(
  db: Database,
  symptomOrError: string
): RemediationPlaybook[] {
  const normalized = symptomOrError.toLowerCase().trim();
  if (!normalized) return [];

  const all = db.query("SELECT * FROM remediations ORDER BY success_count DESC").all() as any[];
  const matches: RemediationPlaybook[] = [];

  for (const row of all) {
    const pattern = row.trigger_pattern.toLowerCase();
    let isMatch = false;

    // Direct substring match or regex match
    if (
      normalized.includes(pattern) ||
      (normalized.length >= 4 && pattern.includes(normalized))
    ) {
      isMatch = true;
    } else {
      try {
        const rx = new RegExp(pattern, "i");
        if (rx.test(normalized)) {
          isMatch = true;
        }
      } catch {
        // ignore regex compilation failure
      }
    }

    if (isMatch) {
      let fixSteps: string[] = [];
      try {
        fixSteps = JSON.parse(row.fix_steps || "[]");
      } catch {
        fixSteps = [];
      }

      matches.push({
        id: row.id,
        trigger_pattern: row.trigger_pattern,
        problem_summary: row.problem_summary,
        root_cause: row.root_cause,
        fix_steps: fixSteps,
        scope: row.scope,
        success_count: row.success_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  }

  return matches;
}

export function recordRemediationSuccess(db: Database, id: string): void {
  db.prepare(`UPDATE remediations SET success_count = success_count + 1 WHERE id = ?`).run(id);
}

/**
 * Seeds default workspace remediations (e.g. agentrouter 401 troubleshooting from AGENTS.md)
 */
export function seedWorkspaceRemediations(db: Database): void {
  const existing = db.query("SELECT COUNT(*) as count FROM remediations").get() as any;
  if (existing && existing.count > 0) return;

  // 1. Agentrouter 401 Unauthorized Troubleshooting from user's AGENTS.md
  addRemediation(db, {
    trigger_pattern: "401 unauthorized",
    problem_summary: "opencode / agentrouter error: 401 unauthorized client detected / UNAUTHENTICATED",
    root_cause: "Proses proxy lama yang basi (stale) masih berjalan di port 8787 meskipun agentrouter-proxy.mjs sudah diubah.",
    fix_steps: [
      "curl -s -m 5 -o /dev/null -w '%{http_code}\\n' http://localhost:8787/v1/models",
      "pkill -f agentrouter-proxy.mjs",
      "export XDG_RUNTIME_DIR=/run/user/$(id -u)",
      "systemctl --user restart agentrouter-proxy",
      "systemctl --user status agentrouter-proxy --no-pager",
    ],
    scope: "global",
  });

  // 2. RAM 16GB Build Crash / Hang
  addRemediation(db, {
    trigger_pattern: "hang|out of memory|ram 16gb|killed",
    problem_summary: "Laptop hang atau proses build di-kill oleh OS akibat kehabisan RAM",
    root_cause: "Menjalankan proses build berat (Next.js / opennext / wrangler) secara paralel atau di background.",
    fix_steps: [
      "Hentikan semua background build: killall -9 node bun 2>/dev/null",
      "Untuk project undangan-digital: Deploy lewat Cloudflare Workers Builds (push ke GitHub, jangan build lokal)",
      "Pastikan satu command = satu waktu, selalu foreground",
    ],
    scope: "global",
  });
}
