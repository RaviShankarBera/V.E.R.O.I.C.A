import { useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { bytes, timeAgo } from '../lib/api'
import { useStore } from '../store'
import { Empty, Toggle } from '../components/ui'

export default function MemoryView() {
  const memStatus = useStore((s) => s.memStatus)
  const memories = useStore((s) => s.memories)
  const settings = useStore((s) => s.settings)
  const loadMemory = useStore((s) => s.loadMemory)
  const addMemory = useStore((s) => s.addMemory)
  const deleteMemory = useStore((s) => s.deleteMemory)
  const setKillSwitch = useStore((s) => s.setKillSwitch)
  const saveSettings = useStore((s) => s.saveSettings)
  const toast = useStore((s) => s.toast)

  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  const search = async (): Promise<void> => {
    if (!query.trim()) return void loadMemory()
    const { req } = await import('../lib/api')
    const items = await req('memory.search', { query, limit: 50 })
    useStore.setState({ memories: items })
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Local Memory" subtitle="SQLite + FTS5 · stored only on this PC" />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {/* status bar */}
          <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
            <span>
              <b className="text-slate-200">{memStatus?.count ?? 0}</b> memories
            </span>
            <span className="font-mono text-slate-500">{memStatus?.dbPath}</span>
            <span className={memStatus?.killSwitchActive ? 'text-red-400' : 'text-mint-400'}>
              kill switch: {memStatus?.killSwitchActive ? 'ACTIVE (writes blocked)' : 'off'}
            </span>
          </div>

          <div className="card mb-4 space-y-3">
            <Toggle
              checked={settings?.memory.enabled ?? false}
              onChange={(v) => void saveSettings({ memory: { ...(settings?.memory ?? { enabled: true, autoCapture: true }), enabled: v } })}
              label="Memory enabled"
              hint="Allow the agent to search and store facts"
            />
            <Toggle
              checked={settings?.memory.autoCapture ?? false}
              onChange={(v) =>
                void saveSettings({ memory: { ...(settings?.memory ?? { enabled: true, autoCapture: true }), autoCapture: v } })
              }
              label="Auto-capture chat"
              hint="Save each message you send into memory (de-duplicated)"
            />
            <Toggle
              checked={memStatus?.killSwitchActive ?? false}
              onChange={(v) => void setKillSwitch(v)}
              label="Kill switch"
              hint={`Creates/deletes ${memStatus?.killSwitchPath ?? 'KILL_SWITCH'} — when present, all memory writes are refused`}
            />
          </div>

          {/* add */}
          <div className="card mb-4">
            <div className="label">Add a memory</div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="e.g. I prefer concise answers with code blocks"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && text.trim()) {
                    void addMemory(text, tags).then(() => {
                      setText('')
                      setTags('')
                    })
                  }
                }}
              />
              <input
                className="input !w-40"
                placeholder="tags,comma"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <button
                className="btn-primary"
                onClick={() =>
                  void addMemory(text, tags).then(() => {
                    setText('')
                    setTags('')
                  }).catch((e: Error) => toast('error', e.message))
                }
                disabled={!text.trim()}
              >
                <Plus size={14} /> Save
              </button>
            </div>
          </div>

          {/* search */}
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute top-3 left-3 text-slate-500" />
              <input
                className="input !pl-9"
                placeholder="Full-text search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
              />
            </div>
            <button className="btn-ghost" onClick={() => void search()}>
              Search
            </button>
          </div>

          {memories.length === 0 ? (
            <Empty text="No memories yet — add one above, or let the agent save one." />
          ) : (
            <div className="space-y-2">
              {memories.map((m) => (
                <div key={m.id} className="card flex items-start gap-3 !p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200">{m.text}</div>
                    <div className="mt-1 flex gap-2 text-[11px] text-slate-500">
                      <span>#{m.id}</span>
                      <span>{m.source}</span>
                      {m.tags && <span className="text-veronica-400">{m.tags}</span>}
                      <span>{timeAgo(m.createdAt)}</span>
                    </div>
                  </div>
                  <button className="text-slate-600 hover:text-red-400" onClick={() => void deleteMemory(m.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-ink-700 bg-ink-900/50 px-6 py-3.5">
      <div className="text-sm font-semibold text-white">{title}</div>
      {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
    </div>
  )
}
