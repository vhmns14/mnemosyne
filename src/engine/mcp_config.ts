import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";

export type McpClientTarget = "opencode" | "claude" | "cursor";

export interface McpConfigResult {
  success: boolean;
  target: McpClientTarget;
  configPath: string;
  alreadyConfigured: boolean;
  message: string;
}

export interface McpStatusResult {
  target: McpClientTarget;
  configPath: string;
  exists: boolean;
  isConfigured: boolean;
  command?: string;
  args?: string[];
}

/**
 * Resolves the absolute path to the mnemosyne mcp.ts entrypoint.
 */
export function getMcpScriptPath(): string {
  return resolve(import.meta.dir, "..", "mcp.ts");
}

/**
 * Resolves the default configuration path for a supported MCP client.
 */
export function resolveClientConfigPath(target: McpClientTarget, customDir?: string): string {
  const base = customDir ? resolve(customDir) : homedir();

  switch (target) {
    case "opencode":
      return join(base, ".config", "opencode", "opencode.json");
    case "claude": {
      const standard = join(base, ".config", "Claude", "claude_desktop_config.json");
      const alt = join(base, ".claude", "claude_desktop_config.json");
      return existsSync(standard) ? standard : (existsSync(alt) ? alt : standard);
    }
    case "cursor":
      return join(process.cwd(), ".cursor", "mcp.json");
    default:
      throw new Error(`Unsupported MCP target: ${target}`);
  }
}

/**
 * Reads existing JSON or creates a clean base structure.
 */
function readOrCreateConfigJson(filePath: string): any {
  if (existsSync(filePath)) {
    try {
      const text = readFileSync(filePath, "utf-8").trim();
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Installs or updates Mnemosyne's entry in the target client's MCP configuration.
 */
export function installMcpConfig(
  target: McpClientTarget,
  options: { customPath?: string; bunPath?: string } = {}
): McpConfigResult {
  const configPath = options.customPath || resolveClientConfigPath(target);
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const mcpScript = getMcpScriptPath();
  const bunCmd = options.bunPath || "bun";

  const config = readOrCreateConfigJson(configPath);
  const alreadyConfigured = Boolean(config.mcp?.mnemosyne || config.mcpServers?.mnemosyne);

  if (target === "opencode") {
    if (!config.mcp || typeof config.mcp !== "object") {
      config.mcp = {};
    }
    config.mcp.mnemosyne = {
      type: "local",
      command: [bunCmd, "run", mcpScript],
      enabled: true,
    };
  }

  // Also support standard mcpServers format for Claude/Cursor/Universal clients
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  config.mcpServers.mnemosyne = {
    command: bunCmd,
    args: ["run", mcpScript],
  };

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return {
      success: true,
      target,
      configPath,
      alreadyConfigured,
      message: `Successfully configured Mnemosyne MCP in ${configPath}`,
    };
  } catch (err: any) {
    return {
      success: false,
      target,
      configPath,
      alreadyConfigured,
      message: `Failed writing MCP config: ${err.message}`,
    };
  }
}

/**
 * Checks the status of Mnemosyne in the target client's MCP configuration.
 */
export function checkMcpStatus(target: McpClientTarget, customPath?: string): McpStatusResult {
  const configPath = customPath || resolveClientConfigPath(target);
  if (!existsSync(configPath)) {
    return {
      target,
      configPath,
      exists: false,
      isConfigured: false,
    };
  }

  try {
    const text = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(text);
    const entry = parsed.mcp?.mnemosyne || parsed.mcpServers?.mnemosyne;

    return {
      target,
      configPath,
      exists: true,
      isConfigured: Boolean(entry),
      command: Array.isArray(entry?.command) ? entry.command[0] : entry?.command,
      args: Array.isArray(entry?.command) ? entry.command.slice(1) : entry?.args,
    };
  } catch {
    return {
      target,
      configPath,
      exists: true,
      isConfigured: false,
    };
  }
}
