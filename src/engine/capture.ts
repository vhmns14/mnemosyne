import type { Database } from "bun:sqlite";
import { rememberMemory } from "./dialectic.ts";
import { addRemediation } from "./remediation.ts";
import { detectWorkspace } from "./workspace.ts";
import type { MemoryCategory, MemoryImportance, MemoryOutcome } from "../types.ts";

export interface GitCaptureResult {
  captured: boolean;
  commitHash?: string;
  subject?: string;
  category?: MemoryCategory;
  memoryId?: string;
  message?: string;
}

export interface ErrorPlaybookCaptureResult {
  playbookId: string;
  memoryId: string;
}

/**
 * Auto-captures the latest git commit into Mnemosyne's memory.
 * Categorizes fixes, architectural changes, and rules from commit messages.
 */
export async function captureFromGit(
  db: Database,
  options: { cwd?: string; scope?: string } = {}
): Promise<GitCaptureResult> {
  const ws = detectWorkspace(options.cwd || process.cwd());
  if (!ws.is_git) {
    return {
      captured: false,
      message: "Current working directory is not inside a Git repository.",
    };
  }

  try {
    const proc = Bun.spawnSync(
      ["git", "log", "-1", "--pretty=format:%H%x1f%an%x1f%s%x1f%b"],
      { cwd: ws.root_path }
    );

    if (proc.exitCode !== 0) {
      return {
        captured: false,
        message: "No commits found or git log failed.",
      };
    }

    const output = proc.stdout.toString().trim();
    if (!output) {
      return { captured: false, message: "Empty git log output." };
    }

    const [hash, author, subject, body] = output.split("\x1f");
    const fullCommitMsg = `${subject}\n\n${body || ""}`.trim();
    const shortHash = hash.substring(0, 8);

    // Prevent duplicate capture of the same commit
    const existing = db
      .query(`SELECT id FROM memories WHERE is_active = 1 AND content LIKE ?`)
      .get(`%[git:${shortHash}]%`) as any;

    if (existing) {
      return {
        captured: false,
        commitHash: hash,
        subject,
        message: `Commit ${shortHash} has already been captured into memory.`,
      };
    }

    // Heuristic categorization based on conventional commits
    const lowerSubject = subject.toLowerCase();
    let category: MemoryCategory = "fact";
    let importance: MemoryImportance = "normal";
    let outcome: MemoryOutcome = "neutral";
    let isNegative = false;
    let failureReason: string | undefined;

    if (lowerSubject.startsWith("fix") || lowerSubject.includes("bugfix") || lowerSubject.includes("hotfix")) {
      category = "episodic";
      importance = "high";
      outcome = "success";
      failureReason = `Resolved issue: ${subject}`;
    } else if (lowerSubject.startsWith("perf") || lowerSubject.includes("optimize")) {
      category = "rule";
      importance = "high";
    } else if (lowerSubject.startsWith("refactor") || lowerSubject.startsWith("arch")) {
      category = "architecture";
      importance = "normal";
    } else if (lowerSubject.includes("forbid") || lowerSubject.includes("prevent") || lowerSubject.includes("never")) {
      category = "negative_constraint";
      isNegative = true;
      importance = "critical";
    }

    const content = `[git:${shortHash}] ${subject}${body ? ` - ${body.trim()}` : ""}`;
    const scope = (options.scope as any) || "project";

    const memoryId = await rememberMemory(db, {
      content,
      category,
      importance,
      scope,
      tags: ["git", ws.project_name, shortHash],
      outcome,
      failure_reason: failureReason,
      is_negative_constraint: isNegative,
    });

    return {
      captured: true,
      commitHash: hash,
      subject,
      category,
      memoryId,
      message: `Successfully captured commit ${shortHash} (${category}) into project memory.`,
    };
  } catch (err: any) {
    return {
      captured: false,
      message: `Git capture error: ${err.message}`,
    };
  }
}

/**
 * Captures an operational troubleshooting playbook (Reflexion pattern).
 * Records both a structured Reflexion playbook and an associative memory record.
 */
export async function captureErrorPlaybook(
  db: Database,
  options: {
    triggerPattern: string;
    problemSummary: string;
    rootCause: string;
    fixSteps: string[];
    scope?: string;
  }
): Promise<ErrorPlaybookCaptureResult> {
  const playbookId = addRemediation(db, {
    trigger_pattern: options.triggerPattern,
    problem_summary: options.problemSummary,
    root_cause: options.rootCause,
    fix_steps: options.fixSteps,
    scope: options.scope || "global",
  });

  const memoryContent = `[Playbook] Fix for "${options.problemSummary}" (Trigger: "${options.triggerPattern}"). Root cause: ${options.rootCause}. Fix: ${options.fixSteps.join(" -> ")}`;

  const memoryId = await rememberMemory(db, {
    content: memoryContent,
    category: "rule",
    importance: "high",
    scope: (options.scope as any) || "global",
    tags: ["playbook", "reflexion", "troubleshooting"],
    outcome: "success",
  });

  return { playbookId, memoryId };
}
