import { useEffect, useState } from 'react'
import { ChevronDown, Play, Plus, Trash2 } from 'lucide-react'
import { timeAgo } from '../lib/api'
import { useStore } from '../store'
import { Empty, Pill } from '../components/ui'
import { Header } from './Memory'

export default function TasksView() {
  const tasks = useStore((s) => s.tasks)
  const taskRuns = useStore((s) => s.taskRuns)
  const settings = useStore((s) => s.settings)
  const loadTasks = useStore((s) => s.loadTasks)
  const createTask = useStore((s) => s.createTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const runTask = useStore((s) => s.runTask)
  const loadRuns = useStore((s) => s.loadRuns)
  const toast = useStore((s) => s.toast)

  const [showForm, setShowForm] = useState(false)
  const [openRuns, setOpenRuns] = useState<number | null>(null)
  const [form, setForm] = useState({
    title: '',
    prompt: '',
    scheduleKind: 'interval',
    schedule: '60'
  })

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const submit = async (): Promise<void> => {
    if (!form.title.trim() || !form.prompt.trim()) return
    if (!settings) return
    try {
      await createTask({
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        scheduleKind: form.scheduleKind,
        schedule: form.schedule.trim(),
        providerId: settings.chat.defaultProviderId,
        model: settings.chat.defaultModel
      })
      setShowForm(false)
      setForm({ title: '', prompt: '', scheduleKind: 'interval', schedule: '60' })
      toast('info', 'Task scheduled')
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  const schedHint =
    form.scheduleKind === 'interval'
      ? 'minutes between runs, e.g. 60'
      : form.scheduleKind === 'cron'
        ? 'cron: 0 9 * * 1-5 (weekdays 09:00)'
        : 'minutes from now until the single run'

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Agentic Tasks"
        subtitle="Prompts Veronica runs unattended — once, on an interval, or on a cron schedule"
      />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <button className="btn-primary mb-4" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} /> New task
          </button>

          {showForm && (
            <div className="card mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label">Title</div>
                  <input
                    className="input"
                    placeholder="Morning briefing"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <div className="label">Schedule</div>
                  <div className="flex gap-2">
                    <select
                      className="input !w-32"
                      value={form.scheduleKind}
                      onChange={(e) => setForm({ ...form, scheduleKind: e.target.value })}
                    >
                      <option value="interval">every N min</option>
                      <option value="cron">cron</option>
                      <option value="once">once</option>
                    </select>
                    <input
                      className="input flex-1"
                      value={form.schedule}
                      onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-600">{schedHint}</div>
                </div>
              </div>
              <div>
                <div className="label">Prompt (what Veronica does each run)</div>
                <textarea
                  className="input min-h-[90px] resize-y"
                  placeholder={'Check my memory for anything tagged "followup" and summarize what still needs doing.'}
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => void submit()}>
                  Schedule
                </button>
              </div>
            </div>
          )}

          {tasks.length === 0 ? (
            <Empty text="No tasks yet. You can also ask the agent: “create a task that … every 30 minutes”." />
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="card !p-3">
                  <div className="flex items-center gap-2">
                    <Pill
                      tone={t.status === 'running' ? 'warn' : t.status === 'error' ? 'err' : t.status === 'done' ? 'idle' : 'ok'}
                    >
                      {t.status}
                    </Pill>
                    <span className="flex-1 text-sm text-slate-200">{t.title}</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {t.scheduleKind === 'cron' ? `cron ${t.schedule}` : t.scheduleKind === 'interval' ? `every ${t.schedule}m` : `once in ${t.schedule}m`}
                    </span>
                    <button className="btn-ghost !px-2 !py-1 !text-xs" title="Run now" onClick={() => void runTask(t.id)}>
                      <Play size={12} />
                    </button>
                    <button
                      className="text-slate-600 hover:text-red-400"
                      title="Delete"
                      onClick={() => void deleteTask(t.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      className="text-slate-500 hover:text-slate-300"
                      title="Runs"
                      onClick={() => {
                        setOpenRuns(openRuns === t.id ? null : t.id)
                        if (openRuns !== t.id) void loadRuns(t.id)
                      }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {t.prompt.slice(0, 140)}
                    {t.prompt.length > 140 ? '…' : ''}
                  </div>
                  {t.lastRunAt && (
                    <div className="mt-1 text-[11px] text-slate-600">
                      last run {timeAgo(t.lastRunAt)}
                      {t.nextRunAt ? ` · next ${timeAgo(t.nextRunAt)}` : ''}
                      {t.status === 'error' ? ` · ${t.lastResult?.slice(0, 100)}` : ''}
                    </div>
                  )}
                  {openRuns === t.id && (
                    <div className="mt-2 space-y-1.5 border-t border-ink-700 pt-2">
                      {(taskRuns[t.id] ?? []).length === 0 ? (
                        <div className="text-[11px] text-slate-600">No runs yet.</div>
                      ) : (
                        (taskRuns[t.id] ?? []).map((r) => (
                          <div key={r.id} className="rounded-lg bg-ink-950 p-2 text-[11px]">
                            <span className={r.status === 'ok' ? 'text-mint-400' : r.status === 'error' ? 'text-red-400' : 'text-amber-400'}>
                              [{r.status}]
                            </span>{' '}
                            <span className="text-slate-500">{timeAgo(r.startedAt)}</span>
                            <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-400">{r.output}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
