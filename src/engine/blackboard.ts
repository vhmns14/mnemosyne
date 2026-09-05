import type { Database } from "bun:sqlite";
import type { BlackboardEntry, BlackboardStateType } from "../types.ts";

/**
 * Multi-Agent Epistemic Blackboard Manager
 * Provides shared, versioned state and hypothesis verification between cooperating agents
 */
export class BlackboardManager {
  constructor(private db: Database) {}

  /**
   * Set or update a key in the shared blackboard
   */
  set(
    sessionId: string,
    key: string,
    value: any,
    options: {
      stateType?: BlackboardStateType;
      authorAgentId?: string;
    } = {}
  ): BlackboardEntry {
    const sId = sessionId.trim();
    const k = key.trim();
    const stateType = options.stateType || "verified_fact";
    const author = options.authorAgentId || "main";
    const now = Date.now();
    const valStr = typeof value === "string" ? value : JSON.stringify(value);

    const existing = this.db.query(`
      SELECT * FROM blackboard_entries WHERE session_id = ? AND key = ?
    `).get(sId, k) as any;

    let version = 1;
    if (existing) {
      version = (existing.version || 1) + 1;
      this.db.query(`
        UPDATE blackboard_entries 
        SET value = ?, state_type = ?, author_agent_id = ?, version = ?, updated_at = ?
        WHERE session_id = ? AND key = ?
      `).run(valStr, stateType, author, version, now, sId, k);
    } else {
      this.db.query(`
        INSERT INTO blackboard_entries (session_id, key, value, state_type, author_agent_id, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sId, k, valStr, stateType, author, version, now);
    }

    let parsedVal = value;
    try {
      parsedVal = JSON.parse(valStr);
    } catch {
      // Keep as string
    }

    return {
      session_id: sId,
      key: k,
      value: parsedVal,
      state_type: stateType,
      author_agent_id: author,
      version,
      updated_at: now,
    };
  }

  /**
   * Retrieve a specific key from the session blackboard
   */
  get(sessionId: string, key: string): BlackboardEntry | null {
    const row = this.db.query(`
      SELECT * FROM blackboard_entries WHERE session_id = ? AND key = ?
    `).get(sessionId.trim(), key.trim()) as any;

    if (!row) return null;

    let parsed = row.value;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      // Keep string
    }

    return {
      ...row,
      value: parsed,
    };
  }

  /**
   * List all keys in a session blackboard
   */
  list(sessionId: string, filterType?: BlackboardStateType): BlackboardEntry[] {
    let query = "SELECT * FROM blackboard_entries WHERE session_id = ?";
    const params: any[] = [sessionId.trim()];

    if (filterType) {
      query += " AND state_type = ?";
      params.push(filterType);
    }

    query += " ORDER BY updated_at DESC";

    const rows = this.db.query(query).all(...params) as any[];
    return rows.map((r) => {
      let parsed = r.value;
      try {
        parsed = JSON.parse(r.value);
      } catch {
        // Keep string
      }
      return {
        ...r,
        value: parsed,
      };
    });
  }

  /**
   * Promote a hypothesis to a verified fact, optionally updating value
   */
  verifyFact(
    sessionId: string,
    key: string,
    updatedValueOrAuthor?: any,
    maybeAuthor?: string
  ): BlackboardEntry | null {
    const entry = this.get(sessionId, key);
    if (!entry) return null;

    let finalValue = entry.value;
    let author = "verifier";

    if (maybeAuthor !== undefined) {
      finalValue = updatedValueOrAuthor;
      author = maybeAuthor;
    } else if (typeof updatedValueOrAuthor === "string") {
      author = updatedValueOrAuthor;
    } else if (updatedValueOrAuthor !== undefined) {
      finalValue = updatedValueOrAuthor;
    }

    return this.set(sessionId, key, finalValue, {
      stateType: "verified_fact",
      authorAgentId: author,
    });
  }

  /**
   * Add an operational blocker alert visible to all cooperating agents
   */
  addBlocker(sessionId: string, key: string, blockerDetails: any, authorAgentId: string = "alerter"): BlackboardEntry {
    return this.set(sessionId, key, blockerDetails, {
      stateType: "blocker",
      authorAgentId,
    });
  }

  /**
   * Delete a key
   */
  delete(sessionId: string, key: string): boolean {
    const res = this.db.query("DELETE FROM blackboard_entries WHERE session_id = ? AND key = ?")
      .run(sessionId.trim(), key.trim());
    return res.changes > 0;
  }

  /**
   * Clear an entire session's blackboard
   */
  clear(sessionId: string): number {
    const res = this.db.query("DELETE FROM blackboard_entries WHERE session_id = ?")
      .run(sessionId.trim());
    return res.changes;
  }

  /**
   * Post a competing value for an existing key, triggering dispute detection & arbitration
   */
  contest(
    sessionId: string,
    key: string,
    competingValue: any,
    authorAgentId: string,
    reason: string = "Contradictory claim by peer agent"
  ): import("../types.ts").DisputeArbitrationResult {
    const sId = sessionId.trim();
    const k = key.trim();
    const current = this.get(sId, k);

    if (!current) {
      this.set(sId, k, competingValue, { authorAgentId, stateType: "hypothesis" });
      return {
        key: k,
        session_id: sId,
        is_disputed: false,
        disputing_agents: [authorAgentId],
        competing_values: [{ agent_id: authorAgentId, value: competingValue, version: 1, updated_at: Date.now() }],
        status: "unanimous",
      };
    }

    const competingStr = typeof competingValue === "string" ? competingValue : JSON.stringify(competingValue);
    const currentStr = typeof current.value === "string" ? current.value : JSON.stringify(current.value);

    if (competingStr === currentStr) {
      return {
        key: k,
        session_id: sId,
        is_disputed: false,
        disputing_agents: [current.author_agent_id, authorAgentId],
        competing_values: [
          { agent_id: current.author_agent_id, value: current.value, version: current.version, updated_at: current.updated_at },
        ],
        status: "unanimous",
      };
    }

    const competingList = [
      { agent_id: current.author_agent_id, value: current.value, version: current.version, updated_at: current.updated_at },
      { agent_id: authorAgentId, value: competingValue, version: current.version + 1, updated_at: Date.now() },
    ];

    let winner = competingList[1];
    let arbReason = `Peer agent ${authorAgentId} submitted updated claim (${reason}).`;

    if (current.author_agent_id === "main" || current.author_agent_id === "lead") {
      winner = competingList[0];
      arbReason = `Preserved authority of leading agent (${current.author_agent_id}).`;
    } else {
      this.set(sId, k, competingValue, {
        authorAgentId,
        stateType: "verified_fact",
      });
    }

    return {
      key: k,
      session_id: sId,
      is_disputed: true,
      disputing_agents: [current.author_agent_id, authorAgentId],
      competing_values: competingList,
      arbitrated_winner: {
        agent_id: winner.agent_id,
        value: winner.value,
        reason: arbReason,
      },
      status: "resolved",
    };
  }
}

