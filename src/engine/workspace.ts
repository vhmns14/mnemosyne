import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { WorkspaceContext } from "../types.ts";

/**
 * Detects workspace context and active project name from the current directory
 * or closest parent git repository.
 */
export function detectWorkspace(startDir: string = process.cwd()): WorkspaceContext {
  let curr = startDir;
  let isGit = false;

  while (curr && curr !== "/" && curr !== ".") {
    if (existsSync(join(curr, ".git"))) {
      isGit = true;
      return {
        root_path: curr,
        project_name: basename(curr),
        is_git: true,
      };
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  // Fallback to basename of the start directory
  return {
    root_path: startDir,
    project_name: basename(startDir),
    is_git: isGit,
  };
}
