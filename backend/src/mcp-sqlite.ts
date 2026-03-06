#!/usr/bin/env bun
/**
 * stdio MCP server for the local SQLite database (terminal-agent.db).
 *
 * Provides the following tools:
 *   - list_tables      : List all tables in the database
 *   - describe_table   : Show the schema of a specific table
 *   - query            : Execute a read-only SQL SELECT statement
 *   - execute          : Execute a write SQL statement (INSERT / UPDATE / DELETE)
 *
 * Usage:
 *   bun run src/mcp-sqlite.ts
 *
 * The server communicates over stdin/stdout using the MCP protocol.
 */

import { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const DB_PATH = process.env.SQLITE_DB_PATH || "terminal-agent.db";
const db = new Database(DB_PATH, { readonly: false });

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "terminal-agent-sqlite",
  version: "1.0.0",
});

// -- list_tables -------------------------------------------------------------
server.tool(
  "list_tables",
  "List all tables in the SQLite database",
  {},
  async () => {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    return {
      content: [
        {
          type: "text" as const,
          text: names.length
            ? `Tables:\n${names.join("\n")}`
            : "No tables found.",
        },
      ],
    };
  }
);

// -- describe_table ----------------------------------------------------------
server.tool(
  "describe_table",
  "Show the schema (columns) of a specific table",
  { table: z.string().describe("Name of the table to describe") },
  async ({ table }) => {
    // Validate the table exists first to give a clear error
    const exists = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      )
      .get(table);
    if (!exists) {
      return {
        content: [{ type: "text" as const, text: `Table "${table}" does not exist.` }],
        isError: true,
      };
    }

    // Use a sanitized table name (only allow alphanumeric and underscores).
    // Reject the request if the name contains any other characters to avoid
    // a mismatch between the validated name and the PRAGMA query target.
    const safeName = table.replace(/[^a-zA-Z0-9_]/g, "");
    if (safeName !== table) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid table name "${table}". Only alphanumeric characters and underscores are allowed.`,
          },
        ],
        isError: true,
      };
    }
    const cols = db
      .query(`PRAGMA table_info("${safeName}")`)
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    const lines = cols.map(
      (c) =>
        `  ${c.name} ${c.type}` +
        (c.pk ? " PRIMARY KEY" : "") +
        (c.notnull ? " NOT NULL" : "") +
        (c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : "")
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `CREATE TABLE ${table} (\n${lines.join(",\n")}\n)`,
        },
      ],
    };
  }
);

// -- query -------------------------------------------------------------------
server.tool(
  "query",
  "Execute a read-only SQL SELECT query and return the results as JSON",
  {
    sql: z.string().describe("SQL SELECT statement to execute"),
    params: z
      .array(z.union([z.string(), z.number(), z.null()]))
      .optional()
      .describe("Optional positional parameters for the query"),
  },
  async ({ sql, params }) => {
    // Only allow SELECT statements for safety
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
      return {
        content: [
          {
            type: "text" as const,
            text: 'Only SELECT (or WITH ... SELECT) queries are allowed in the "query" tool. Use the "execute" tool for write operations.',
          },
        ],
        isError: true,
      };
    }

    try {
      const rows = db.query(sql).all(...(params ?? []));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Query error: ${message}` }],
        isError: true,
      };
    }
  }
);

// -- execute -----------------------------------------------------------------
server.tool(
  "execute",
  "Execute a write SQL statement (INSERT, UPDATE, DELETE, etc.) and return the number of rows affected",
  {
    sql: z.string().describe("SQL statement to execute"),
    params: z
      .array(z.union([z.string(), z.number(), z.null()]))
      .optional()
      .describe("Optional positional parameters for the statement"),
  },
  async ({ sql, params }) => {
    // Block SELECT - use the query tool for reads
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith("SELECT")) {
      return {
        content: [
          {
            type: "text" as const,
            text: 'Use the "query" tool for SELECT statements.',
          },
        ],
        isError: true,
      };
    }

    try {
      const stmt = db.prepare(sql);
      const result = stmt.run(...(params ?? []));
      return {
        content: [
          {
            type: "text" as const,
            text: `OK - ${result.changes} row(s) affected. Last insert row id: ${result.lastInsertRowid}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Execute error: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they don't corrupt the stdio MCP stream
  process.stderr.write(`[mcp-sqlite] Connected to database: ${DB_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`[mcp-sqlite] Fatal error: ${err}\n`);
  process.exit(1);
});
