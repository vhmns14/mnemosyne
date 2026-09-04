import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { CONFIG } from "../config.ts";

export interface ServiceResult {
  success: boolean;
  servicePath: string;
  message: string;
}

export interface ServiceStatus {
  installed: boolean;
  servicePath: string;
  active: boolean;
  statusOutput: string;
}

/**
 * Returns the default systemd user service unit path.
 */
export function getServiceFilePath(): string {
  return join(homedir(), ".config", "systemd", "user", "mnemosyne.service");
}

/**
 * Generates the contents of the systemd user service unit file.
 */
export function generateServiceUnit(options: {
  workingDir?: string;
  bunPath?: string;
  serverScriptPath?: string;
  port?: number;
} = {}): string {
  const workingDir = options.workingDir || resolve(import.meta.dir, "../..");
  const serverScript = options.serverScriptPath || resolve(import.meta.dir, "../server.ts");
  const bunPath = options.bunPath || process.execPath || "bun";
  const port = options.port || CONFIG.PORT || 8788;

  return `[Unit]
Description=Mnemosyne Second Memory REST Daemon & Web Dashboard
Documentation=https://github.com/vhmns14/mnemosyne
After=network.target

[Service]
Type=simple
WorkingDirectory=${workingDir}
ExecStart=${bunPath} run ${serverScript}
Restart=always
RestartSec=5
KillMode=process
Environment=NODE_ENV=production
Environment=MNEMO_PORT=${port}
Environment=MNEMO_HOST=127.0.0.1

[Install]
WantedBy=default.target
`;
}

/**
 * Installs the mnemosyne.service file into ~/.config/systemd/user/ and optionally starts it.
 */
export function installSystemService(options: {
  enableAndStart?: boolean;
  customServicePath?: string;
} = {}): ServiceResult {
  const servicePath = options.customServicePath || getServiceFilePath();
  const dir = dirname(servicePath);

  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      return { success: false, servicePath, message: `Failed creating directory: ${err.message}` };
    }
  }

  const unitContent = generateServiceUnit();

  try {
    writeFileSync(servicePath, unitContent, "utf-8");

    // Attempt systemctl daemon-reload
    try {
      Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    } catch {
      // Non-critical if systemctl isn't available
    }

    if (options.enableAndStart) {
      try {
        Bun.spawnSync(["systemctl", "--user", "enable", "--now", "mnemosyne.service"]);
      } catch {
        // Non-critical
      }
    }

    return {
      success: true,
      servicePath,
      message: `Successfully installed Mnemosyne systemd service unit to ${servicePath}`,
    };
  } catch (err: any) {
    return { success: false, servicePath, message: `Failed writing service unit: ${err.message}` };
  }
}

/**
 * Checks systemd user status of mnemosyne service.
 */
export function getSystemServiceStatus(customServicePath?: string): ServiceStatus {
  const servicePath = customServicePath || getServiceFilePath();
  const installed = existsSync(servicePath);

  if (!installed) {
    return {
      installed: false,
      servicePath,
      active: false,
      statusOutput: "Service unit is not installed.",
    };
  }

  try {
    const proc = Bun.spawnSync(["systemctl", "--user", "status", "mnemosyne.service", "--no-pager"]);
    const output = proc.stdout.toString() || proc.stderr.toString();
    const active = output.includes("Active: active (running)");

    return {
      installed: true,
      servicePath,
      active,
      statusOutput: output.trim(),
    };
  } catch (err: any) {
    return {
      installed: true,
      servicePath,
      active: false,
      statusOutput: `systemctl status query failed: ${err.message}`,
    };
  }
}

/**
 * Controls systemd user service actions (start, stop, restart).
 */
export function controlSystemService(action: "start" | "stop" | "restart"): { success: boolean; message: string } {
  try {
    const proc = Bun.spawnSync(["systemctl", "--user", action, "mnemosyne.service"]);
    if (proc.exitCode === 0) {
      return { success: true, message: `systemctl --user ${action} mnemosyne.service executed successfully.` };
    } else {
      return { success: false, message: `Command returned exit code ${proc.exitCode}: ${proc.stderr.toString()}` };
    }
  } catch (err: any) {
    return { success: false, message: `Control action failed: ${err.message}` };
  }
}

/**
 * Returns paths for dreamer timer and service units.
 */
export function getDreamerPaths(): { timerPath: string; servicePath: string } {
  const dir = join(homedir(), ".config", "systemd", "user");
  return {
    timerPath: join(dir, "mnemosyne-dreamer.timer"),
    servicePath: join(dir, "mnemosyne-dreamer.service"),
  };
}

/**
 * Generates the dreamer oneshot service unit.
 */
export function generateDreamerServiceUnit(options: {
  workingDir?: string;
  bunPath?: string;
  cliScriptPath?: string;
  decayDays?: number;
} = {}): string {
  const workingDir = options.workingDir || resolve(import.meta.dir, "../..");
  const cliScript = options.cliScriptPath || resolve(import.meta.dir, "../cli.ts");
  const bunPath = options.bunPath || process.execPath || "bun";
  const decayDays = options.decayDays || 30;

  return `[Unit]
Description=Mnemosyne Autonomous Hippocampal Sleep & Dreamer Oneshot
Documentation=https://github.com/vhmns14/mnemosyne
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${workingDir}
ExecStart=${bunPath} run ${cliScript} dream --decay-days ${decayDays}
Environment=NODE_ENV=production
`;
}

/**
 * Generates the dreamer timer unit.
 */
export function generateDreamerTimerUnit(options: {
  calendarSchedule?: string;
} = {}): string {
  const schedule = options.calendarSchedule || "*-*-* 03:00:00";

  return `[Unit]
Description=Mnemosyne Autonomous Hippocampal Sleep & Dreamer Timer
Documentation=https://github.com/vhmns14/mnemosyne

[Timer]
OnCalendar=${schedule}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

/**
 * Installs and optionally enables the dreamer timer.
 */
export function installDreamerTimer(options: {
  enableAndStart?: boolean;
  calendarSchedule?: string;
  decayDays?: number;
} = {}): { success: boolean; timer_path: string; service_path: string; message: string } {
  const { timerPath, servicePath } = getDreamerPaths();
  const dir = dirname(timerPath);

  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      return { success: false, timer_path: timerPath, service_path: servicePath, message: `Failed creating directory: ${err.message}` };
    }
  }

  try {
    writeFileSync(servicePath, generateDreamerServiceUnit({ decayDays: options.decayDays }), "utf-8");
    writeFileSync(timerPath, generateDreamerTimerUnit({ calendarSchedule: options.calendarSchedule }), "utf-8");

    try {
      Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    } catch {}

    if (options.enableAndStart) {
      try {
        Bun.spawnSync(["systemctl", "--user", "enable", "--now", "mnemosyne-dreamer.timer"]);
      } catch {}
    }

    return {
      success: true,
      timer_path: timerPath,
      service_path: servicePath,
      message: `Successfully installed Mnemosyne Dreamer timer & service (${timerPath})`,
    };
  } catch (err: any) {
    return {
      success: false,
      timer_path: timerPath,
      service_path: servicePath,
      message: `Failed writing dreamer unit files: ${err.message}`,
    };
  }
}

/**
 * Checks systemd status of dreamer timer.
 */
export function getDreamerTimerStatus(): { installed: boolean; active: boolean; statusOutput: string } {
  const { timerPath } = getDreamerPaths();
  if (!existsSync(timerPath)) {
    return { installed: false, active: false, statusOutput: "Dreamer timer unit not installed." };
  }

  try {
    const proc = Bun.spawnSync(["systemctl", "--user", "status", "mnemosyne-dreamer.timer", "--no-pager"]);
    const output = proc.stdout.toString() || proc.stderr.toString();
    const active = output.includes("Active: active (waiting)") || output.includes("Active: active (running)");
    return { installed: true, active, statusOutput: output.trim() };
  } catch (err: any) {
    return { installed: true, active: false, statusOutput: `Query failed: ${err.message}` };
  }
}

