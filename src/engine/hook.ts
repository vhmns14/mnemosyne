import { existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { GitHookResult } from "../types.ts";

const HOOK_MARKER_START = "# >>> MNEMOSYNE GIT FIREWALL START >>>";
const HOOK_MARKER_END = "# <<< MNEMOSYNE GIT FIREWALL END <<<";

/**
 * Finds the nearest .git directory by walking up the path.
 */
export function findGitRoot(startDir?: string): string | null {
  let current = resolve(startDir || process.cwd());
  const root = resolve("/");

  while (current !== root) {
    const gitDir = join(current, ".git");
    if (existsSync(gitDir)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Generates the shell script content for the pre-commit hook.
 */
export function generatePreCommitScript(): string {
  return `${HOOK_MARKER_START}
# Strictly enforce Aturan Keras 5 (No database files in Git) and Laptop 16GB Safeguards

# 1. Check for forbidden SQLite database files (*.db, *.db-wal, *.db-shm)
FORBIDDEN_DB_FILES=$(git diff --cached --name-only | grep -E '(\\.db|\\.db-wal|\\.db-shm)$|mnemosyne\\.db' || true)

if [ -n "$FORBIDDEN_DB_FILES" ]; then
  echo ""
  echo "======================================================================"
  echo "❌ [MNEMOSYNE FIREWALL] COMMIT REJECTED: DATABASE FILE DETECTED!"
  echo "======================================================================"
  echo "Aturan Keras 5: File database (*.db, *.db-wal, *.db-shm) TIDAK boleh masuk git!"
  echo ""
  echo "File terlarang yang masuk staged git:"
  echo "$FORBIDDEN_DB_FILES" | sed 's/^/  - /'
  echo ""
  echo "Tindakan perbaikan segera:"
  echo "  1. Unstage file database:"
  echo "     git reset HEAD <nama-file>"
  echo "  2. Pastikan file masuk ke .gitignore:"
  echo "     echo '*.db' >> .gitignore"
  echo "     echo '*.db-wal' >> .gitignore"
  echo "     echo '*.db-shm' >> .gitignore"
  echo "======================================================================"
  echo ""
  exit 1
fi
${HOOK_MARKER_END}
`;
}

/**
 * Installs the pre-commit hook into the target Git repository.
 */
export function installGitHook(targetDir?: string): GitHookResult {
  const repoRoot = findGitRoot(targetDir);
  if (!repoRoot) {
    return {
      success: false,
      hook_path: "",
      message: `No Git repository found in '${targetDir || process.cwd()}' or its parent directories.`,
    };
  }

  const hooksDir = join(repoRoot, ".git", "hooks");
  if (!existsSync(hooksDir)) {
    try {
      mkdirSync(hooksDir, { recursive: true });
    } catch (err: any) {
      return {
        success: false,
        hook_path: hooksDir,
        message: `Failed creating hooks directory: ${err.message}`,
      };
    }
  }

  const hookPath = join(hooksDir, "pre-commit");
  const hookScript = generatePreCommitScript();

  try {
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf-8");
      if (existing.includes(HOOK_MARKER_START)) {
        // Replace existing Mnemosyne section
        const regex = new RegExp(`${HOOK_MARKER_START}[\\s\\S]*?${HOOK_MARKER_END}\\n?`, "g");
        const updated = existing.replace(regex, hookScript);
        writeFileSync(hookPath, updated, "utf-8");
      } else {
        // Append to existing pre-commit hook
        writeFileSync(hookPath, `${existing}\n\n${hookScript}`, "utf-8");
      }
    } else {
      // Create new executable pre-commit script
      writeFileSync(hookPath, `#!/bin/sh\n\n${hookScript}`, "utf-8");
    }

    // Make executable (rwxr-xr-x)
    chmodSync(hookPath, 0o755);

    return {
      success: true,
      hook_path: hookPath,
      message: `Successfully installed Mnemosyne Git pre-commit firewall at ${hookPath}`,
    };
  } catch (err: any) {
    return {
      success: false,
      hook_path: hookPath,
      message: `Failed writing git hook: ${err.message}`,
    };
  }
}

/**
 * Uninstalls the pre-commit hook from the target Git repository.
 */
export function uninstallGitHook(targetDir?: string): GitHookResult {
  const repoRoot = findGitRoot(targetDir);
  if (!repoRoot) {
    return {
      success: false,
      hook_path: "",
      message: `No Git repository found in '${targetDir || process.cwd()}'.`,
    };
  }

  const hookPath = join(repoRoot, ".git", "hooks", "pre-commit");
  if (!existsSync(hookPath)) {
    return {
      success: true,
      hook_path: hookPath,
      message: "No pre-commit hook exists to uninstall.",
    };
  }

  try {
    const content = readFileSync(hookPath, "utf-8");
    if (content.includes(HOOK_MARKER_START)) {
      const regex = new RegExp(`${HOOK_MARKER_START}[\\s\\S]*?${HOOK_MARKER_END}\\n?`, "g");
      const cleaned = content.replace(regex, "").trim();

      if (!cleaned || cleaned === "#!/bin/sh") {
        unlinkSync(hookPath);
      } else {
        writeFileSync(hookPath, cleaned, "utf-8");
      }
    }

    return {
      success: true,
      hook_path: hookPath,
      message: `Successfully uninstalled Mnemosyne Git firewall from ${hookPath}`,
    };
  } catch (err: any) {
    return {
      success: false,
      hook_path: hookPath,
      message: `Failed uninstalling git hook: ${err.message}`,
    };
  }
}
