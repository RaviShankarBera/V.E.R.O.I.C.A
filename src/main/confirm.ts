/**
 * Confirmation broker — pairs agent.confirm events with renderer responses.
 * Mutating tools block until the user approves in the UI (90s timeout = deny).
 * Original work © 2026 Ravi Shankar Bera.
 */
import { randomUUID } from 'node:crypto'
import { emit } from './bus'

interface Pending {
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

export class ConfirmBroker {
  private readonly pending = new Map<string, Pending>()

  request(tool: string, args: unknown, summary: string): Promise<boolean> {
    return new Promise((resolve) => {
      const confirmId = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(confirmId)
        resolve(false)
      }, 90_000)
      this.pending.set(confirmId, { resolve, timer })
      emit({ type: 'agent.confirm', confirmId, tool, args, summary })
    })
  }

  respond(confirmId: string, approved: boolean): void {
    const p = this.pending.get(confirmId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(confirmId)
    p.resolve(approved)
  }

  cancelAll(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve(false)
      this.pending.delete(id)
    }
  }
}
