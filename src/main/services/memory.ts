/**
 * Local SQLite memory — sessions, transcripts, long-term memories (FTS5),
 * agentic tasks and run logs. All data stays on this PC.
 * Includes the kill-switch file: if it exists, memory writes are refused.
 * Original work © 2026 Ravi Shankar Bera.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { AgenticTask, ChatMessage, ChatSession, MemoryItem, TaskRun } from '../../shared/types'

export class MemoryService {
  readonly db: Database.Database
  readonly dbPath: string
  readonly killSwitchPath: string
  private ftsOk = true

  constructor(dir: string) {
    this.dbPath = path.join(dir, 'veronica.db')
    this.killSwitchPath = path.join(dir, 'KILL_SWITCH')
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tools TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_kind TEXT NOT NULL,
        schedule TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        last_run_at INTEGER,
        last_result TEXT,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT ''
      );
    `)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          text, tags, content='memories', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.id, old.text, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.id, old.text, old.tags);
          INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
        END;
      `)
    } catch {
      this.ftsOk = false
    }
  }

  get killSwitchActive(): boolean {
    return fs.existsSync(this.killSwitchPath)
  }

  setKillSwitch(active: boolean): void {
    if (active) fs.writeFileSync(this.killSwitchPath, `disabled ${new Date().toISOString()}\n`)
    else if (fs.existsSync(this.killSwitchPath)) fs.unlinkSync(this.killSwitchPath)
  }

  /* ------------------------------ memories ----------------------------- */

  addMemory(text: string, tags = '', source = 'manual'): MemoryItem | null {
    const clean = text.trim()
    if (!clean || this.killSwitchActive) return null
    // de-duplicate exact text
    const dup = this.db
      .prepare('SELECT id FROM memories WHERE text = ?')
      .get(clean) as { id: number } | undefined
    if (dup) return this.getMemory(dup.id)
    const info = this.db
      .prepare('INSERT INTO memories (text, tags, source, created_at) VALUES (?, ?, ?, ?)')
      .run(clean, tags, source, Date.now())
    return this.getMemory(Number(info.lastInsertRowid))
  }

  getMemory(id: number): MemoryItem | null {
    const row = this.db
      .prepare('SELECT id, text, tags, source, created_at FROM memories WHERE id = ?')
      .get(id) as
      | { id: number; text: string; tags: string; source: string; created_at: number }
      | undefined
    return row ? { id: row.id, text: row.text, tags: row.tags, source: row.source, createdAt: row.created_at } : null
  }

  searchMemories(query: string, limit = 8): MemoryItem[] {
    const q = query.trim()
    if (!q) return this.listMemories(limit)
    const base = 'SELECT id, text, tags, source, created_at FROM memories'
    const map = (row: unknown): MemoryItem => {
      const r = row as { id: number; text: string; tags: string; source: string; created_at: number }
      return { id: r.id, text: r.text, tags: r.tags, source: r.source, createdAt: r.created_at }
    }
    if (this.ftsOk) {
      try {
        const match = q
          .split(/\s+/)
          .map((t) => `"${t.replace(/"/g, '""')}"`)
          .join(' ')
        const rows = this.db
          .prepare(
            `${base} WHERE id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?) ORDER BY created_at DESC LIMIT ?`
          )
          .all(match, limit)
        if (rows.length > 0) return rows.map(map)
      } catch {
        this.ftsOk = false
      }
    }
    const rows = this.db
      .prepare(`${base} WHERE text LIKE ? ORDER BY created_at DESC LIMIT ?`)
      .all(`%${q}%`, limit)
    return rows.map(map)
  }

  listMemories(limit = 100): MemoryItem[] {
    const rows = this.db
      .prepare('SELECT id, text, tags, source, created_at FROM memories ORDER BY created_at DESC LIMIT ?')
      .all(limit)
    return rows.map(
      (r) =>
        ({
          id: (r as { id: number }).id,
          text: (r as { text: string }).text,
          tags: (r as { tags: string }).tags,
          source: (r as { source: string }).source,
          createdAt: (r as { created_at: number }).created_at
        }) satisfies MemoryItem
    )
  }

  deleteMemory(id: number): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  deleteTask(id: number): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  memoryCount(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM memories').get() as { c: number }).c
  }

  /* ------------------------------- sessions ---------------------------- */

  createSession(title?: string): ChatSession {
    const now = Date.now()
    const info = this.db
      .prepare('INSERT INTO sessions (title, created_at, updated_at) VALUES (?, ?, ?)')
      .run(title?.trim() || 'New chat', now, now)
    return {
      id: Number(info.lastInsertRowid),
      title: title?.trim() || 'New chat',
      createdAt: now,
      updatedAt: now
    }
  }

  listSessions(limit = 50): ChatSession[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?'
      )
      .all(limit) as Array<{ id: number; title: string; created_at: number; updated_at: number }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }

  renameSession(id: number, title: string): void {
    this.db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
  }

  touchSession(id: number): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  }

  deleteSession(id: number): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  addMessage(
    sessionId: number,
    role: ChatMessage['role'],
    content: string,
    tools?: unknown
  ): number {
    const info = this.db
      .prepare('INSERT INTO messages (session_id, role, content, tools, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, role, content, tools ? JSON.stringify(tools) : null, Date.now())
    this.touchSession(sessionId)
    return Number(info.lastInsertRowid)
  }

  history(sessionId: number, limit: number): ChatMessage[] {
    const rows = this.db
      .prepare(
        'SELECT id, session_id, role, content, tools, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, limit) as Array<{
      id: number
      session_id: number
      role: ChatMessage['role']
      content: string
      tools: string | null
      created_at: number
    }>
    return rows
      .reverse()
      .map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role,
        content: r.content,
        tools: r.tools,
        createdAt: r.created_at
      }))
  }

  /* -------------------------------- tasks ------------------------------ */

  createTask(t: {
    title: string
    prompt: string
    scheduleKind: string
    schedule: string
    providerId: string
    model: string
    nextRunAt: number | null
  }): AgenticTask {
    const info = this.db
      .prepare(
        `INSERT INTO tasks (title, prompt, schedule_kind, schedule, status, provider_id, model, next_run_at, created_at)
         VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`
      )
      .run(t.title, t.prompt, t.scheduleKind, t.schedule, t.providerId, t.model, t.nextRunAt, Date.now())
    return this.getTask(Number(info.lastInsertRowid))!
  }

  updateTask(id: number, patch: Partial<AgenticTask>): AgenticTask | null {
    const allowed: Array<keyof AgenticTask> = [
      'title',
      'prompt',
      'scheduleKind',
      'schedule',
      'status',
      'providerId',
      'model',
      'lastRunAt',
      'lastResult',
      'nextRunAt'
    ]
    const sets: string[] = []
    const values: unknown[] = []
    for (const key of allowed) {
      if (key in patch) {
        sets.push(`${snake(key)} = ?`)
        values.push(patch[key])
      }
    }
    if (sets.length > 0) {
      values.push(id)
      this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    }
    return this.getTask(id)
  }

  getTask(id: number): AgenticTask | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    return row ? mapTask(row) : null
  }

  listTasks(): AgenticTask[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
    return rows.map(mapTask)
  }

  dueTasks(now: number): AgenticTask[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'scheduled' AND next_run_at IS NOT NULL AND next_run_at <= ?")
      .all(now)
    return rows.map(mapTask)
  }

  addTaskRun(taskId: number): number {
    const info = this.db
      .prepare("INSERT INTO task_runs (task_id, started_at, status, output) VALUES (?, ?, 'running', '')")
      .run(taskId, Date.now())
    return Number(info.lastInsertRowid)
  }

  finishTaskRun(runId: number, status: 'ok' | 'error', output: string): void {
    this.db
      .prepare('UPDATE task_runs SET finished_at = ?, status = ?, output = ? WHERE id = ?')
      .run(Date.now(), status, output.slice(0, 20000), runId)
  }

  taskRuns(taskId: number, limit = 20): TaskRun[] {
    const rows = this.db
      .prepare(
        'SELECT id, task_id, started_at, finished_at, status, output FROM task_runs WHERE task_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(taskId, limit) as Array<{
      id: number
      task_id: number
      started_at: number
      finished_at: number | null
      status: TaskRun['status']
      output: string
    }>
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      output: r.output
    }))
  }

  close(): void {
    this.db.close()
  }
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTask(row: any): AgenticTask {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind,
    schedule: row.schedule,
    status: row.status,
    providerId: row.provider_id,
    model: row.model,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at
  }
}
