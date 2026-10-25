/**
 * Agentic Task runner + scheduler — unattended prompt runs (once / interval /
 * cron) executed through the same harness, persisted with run logs.
 * Original work © 2026 Ravi Shankar Bera.
 */
import { CronExpressionParser } from 'cron-parser'
import type { AgenticTask, AppSettings } from '../../shared/types'
import { emit } from '../bus'
import { runHeadless } from './harness'
import type { MemoryService } from './memory'
import type { KeyStore } from './keys'
import type { ToolCtxBase } from './agent/tools'

export function computeNextRun(kind: string, schedule: string, from: number): number | null {
  try {
    if (kind === 'cron') {
      const it = CronExpressionParser.parse(schedule, { currentDate: new Date(from) })
      return it.next().toDate().getTime()
    }
    if (kind === 'interval') {
      const minutes = Number(schedule)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return from + minutes * 60_000
    }
    if (kind === 'once') {
      const minutes = Number(schedule)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return from + minutes * 60_000
    }
    return null
  } catch {
    return null
  }
}

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null
  private running = new Set<number>()

  constructor(
    private readonly memory: MemoryService,
    private readonly settings: () => AppSettings,
    private readonly keys: KeyStore,
    private readonly ctxBase: ToolCtxBase
  ) {}

  start(intervalMs = 20_000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    const due = this.memory.dueTasks(Date.now())
    for (const task of due) void this.runTask(task)
  }

  async runTask(task: AgenticTask | number): Promise<void> {
    const t = typeof task === 'number' ? this.memory.getTask(task) : task
    if (!t || this.running.has(t.id)) return
    this.running.add(t.id)
    const runId = this.memory.addTaskRun(t.id)
    this.memory.updateTask(t.id, { status: 'running' })
    emit({ type: 'task.update', taskId: t.id })
    try {
      const s = this.settings()
      const output = await runHeadless(
        t.prompt,
        {
          settings: s,
          keys: this.keys,
          providerId: t.providerId || s.chat.defaultProviderId,
          model: t.model || s.chat.defaultModel,
          useTools: true,
          systemPrompt: `${s.chat.systemPrompt}\nYou are running as an unattended scheduled task named "${t.title}". Do your work and answer with a short factual report.`
        },
        this.ctxBase
      )
      this.memory.finishTaskRun(runId, 'ok', output)
      const next =
        t.scheduleKind === 'once'
          ? null
          : computeNextRun(t.scheduleKind, t.schedule, Date.now())
      this.memory.updateTask(t.id, {
        status: t.scheduleKind === 'once' ? 'done' : next === null ? 'error' : 'scheduled',
        lastRunAt: Date.now(),
        lastResult: output,
        nextRunAt: next
      })
    } catch (err) {
      this.memory.finishTaskRun(runId, 'error', (err as Error).message)
      this.memory.updateTask(t.id, {
        status: 'error',
        lastRunAt: Date.now(),
        lastResult: (err as Error).message
      })
    } finally {
      this.running.delete(t.id)
      emit({ type: 'task.update', taskId: t.id })
    }
  }
}
