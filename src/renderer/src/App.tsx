import { useEffect } from 'react'
import {
  Activity,
  Brain,
  ListChecks,
  Globe,
  MessageSquare,
  Mic,
  Plug,
  Settings as SettingsIcon,
  ShieldAlert,
  X
} from 'lucide-react'
import { onEvent } from './lib/api'
import { useStore, type View } from './store'
import ChatView from './views/Chat'
import MemoryView from './views/Memory'
import MonitorView from './views/Monitor'
import BrowserView from './views/Browser'
import TasksView from './views/Tasks'
import IntegrationsView from './views/Integrations'
import VoiceView from './views/Voice'
import SettingsView from './views/Settings'

const NAV: Array<{ id: View; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'monitor', label: 'System', icon: Activity },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'integrations', label: 'Channels', icon: Plug },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App() {
  const view = useStore((s) => s.view)
  const ready = useStore((s) => s.ready)
  const info = useStore((s) => s.info)
  const confirm = useStore((s) => s.confirm)
  const toasts = useStore((s) => s.toasts)
  const setView = useStore((s) => s.setView)
  const init = useStore((s) => s.init)
  const handleEvent = useStore((s) => s.handleEvent)
  const respondConfirm = useStore((s) => s.respondConfirm)
  const dropToast = useStore((s) => s.dropToast)

  useEffect(() => {
    void init()
    const off = onEvent(handleEvent)
    return off
  }, [init, handleEvent])

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className="flex w-[210px] shrink-0 flex-col border-r border-ink-700 bg-ink-900">
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-veronica-500 to-cyan-500 font-bold text-white">
            V
          </div>
          <div>
            <div className="text-sm font-bold tracking-widest text-white">VERONICA</div>
            <div className="text-[10px] tracking-[0.25em] text-slate-500">A I</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2.5 py-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition ${
                view === id
                  ? 'bg-veronica-500/15 text-veronica-300 ring-1 ring-veronica-500/40'
                  : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200'
              }`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-slate-600">
          © Ravi Shankar Bera
          <div className="mt-0.5">v{info?.version ?? '…'}</div>
        </div>
      </aside>

      {/* content */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-ink-950">
        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="pulse-soft text-sm tracking-[0.3em] text-veronica-400">LOADING VERONICA…</div>
          </div>
        ) : (
          <>
            {view === 'chat' && <ChatView />}
            {view === 'memory' && <MemoryView />}
            {view === 'monitor' && <MonitorView />}
            {view === 'browser' && <BrowserView />}
            {view === 'tasks' && <TasksView />}
            {view === 'integrations' && <IntegrationsView />}
            {view === 'voice' && <VoiceView />}
            {view === 'settings' && <SettingsView />}
          </>
        )}

        {/* confirmation modal (agent mutating tools) */}
        {confirm && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-[520px] max-w-[90%] rounded-2xl border border-amber-500/40 bg-ink-900 p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 text-amber-400">
                <ShieldAlert size={18} />
                <span className="text-sm font-semibold tracking-wide">CONFIRMATION REQUIRED</span>
              </div>
              <div className="text-slate-200">{confirm.summary}</div>
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-ink-950 p-3 text-xs text-slate-500">
                {confirm.tool}
                {'\n'}
                {JSON.stringify(confirm.args, null, 2)}
              </pre>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => void respondConfirm(false)}>
                  Deny
                </button>
                <button className="btn-primary" onClick={() => void respondConfirm(true)}>
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* toasts */}
        <div className="pointer-events-none absolute right-4 bottom-4 z-50 flex w-[340px] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-xl ${
                t.level === 'error'
                  ? 'border-red-700/60 bg-red-950/90 text-red-200'
                  : 'border-veronica-500/40 bg-ink-850/95 text-slate-200'
              }`}
            >
              <span className="flex-1">{t.text}</span>
              <button className="opacity-60 hover:opacity-100" onClick={() => dropToast(t.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
