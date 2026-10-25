import { useEffect, useState } from 'react'
import { KeyRound, Save, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { Section, Toggle } from '../components/ui'
import { Header } from './Memory'

export default function SettingsView() {
  const settings = useStore((s) => s.settings)
  const keys = useStore((s) => s.keys)
  const info = useStore((s) => s.info)
  const saveSettings = useStore((s) => s.saveSettings)
  const saveKey = useStore((s) => s.saveKey)
  const deleteKey = useStore((s) => s.deleteKey)
  const toast = useStore((s) => s.toast)

  const [sysPrompt, setSysPrompt] = useState('')
  const [temp, setTemp] = useState(0.7)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) {
      setSysPrompt(settings.chat.systemPrompt)
      setTemp(settings.chat.temperature)
    }
  }, [settings?.chat.systemPrompt, settings?.chat.temperature])

  if (!settings) return null

  return (
    <div className="flex h-full flex-col">
      <Header title="Settings" subtitle={`v${info?.version ?? '?'} · ${info?.userData ?? ''}`} />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {/* general */}
          <Section title="General">
            <Toggle
              checked={settings.general.launchAtLogin}
              onChange={(v) => void saveSettings({ general: { launchAtLogin: v } })}
              label="Launch at Windows login"
            />
          </Section>

          {/* chat */}
          <Section title="Chat defaults">
            <div>
              <div className="label">System prompt</div>
              <textarea
                className="input min-h-[90px] resize-y text-xs"
                value={sysPrompt}
                onChange={(e) => setSysPrompt(e.target.value)}
                onBlur={() => void saveSettings({ chat: { ...settings.chat, systemPrompt: sysPrompt } })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="label">Temperature: {temp.toFixed(1)}</div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full accent-veronica-500"
                  value={temp}
                  onChange={(e) => setTemp(Number(e.target.value))}
                  onMouseUp={() => void saveSettings({ chat: { ...settings.chat, temperature: temp } })}
                />
              </div>
              <div>
                <div className="label">History kept per session</div>
                <input
                  type="number"
                  min={4}
                  max={200}
                  className="input"
                  value={settings.chat.historyLimit}
                  onChange={(e) =>
                    void saveSettings({ chat: { ...settings.chat, historyLimit: Number(e.target.value) || 40 } })
                  }
                />
              </div>
            </div>
          </Section>

          {/* agent */}
          <Section title="Agent harness">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="label">Max tool steps per turn</div>
                <input
                  type="number"
                  min={1}
                  max={16}
                  className="input"
                  value={settings.agent.maxSteps}
                  onChange={(e) =>
                    void saveSettings({ agent: { ...settings.agent, maxSteps: Number(e.target.value) || 8 } })
                  }
                />
              </div>
              <div className="flex items-end">
                <Toggle
                  checked={settings.agent.toolConfirmations}
                  onChange={(v) => void saveSettings({ agent: { ...settings.agent, toolConfirmations: v } })}
                  label="Confirm before mutating tools"
                  hint="kill process · browser actions · send messages"
                />
              </div>
            </div>
            <div className="text-[11px] text-slate-600">
              Tools available: memory search/save, system snapshot/processes/kill (user-owned only), browser
              open/read/act/screenshot/close, task create/list, integration send, TTS. There is deliberately no
              arbitrary shell tool.
            </div>
          </Section>

          {/* browser */}
          <Section title="Browser automation">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="label">Engine</div>
                <select
                  className="input"
                  value={settings.browser.channel}
                  onChange={(e) =>
                    void saveSettings({ browser: { ...settings.browser, channel: e.target.value as 'msedge' | 'chrome' } })
                  }
                >
                  <option value="msedge">Microsoft Edge (preinstalled)</option>
                  <option value="chrome">Google Chrome</option>
                </select>
              </div>
              <div className="flex items-end">
                <Toggle
                  checked={settings.browser.headless}
                  onChange={(v) => void saveSettings({ browser: { ...settings.browser, headless: v } })}
                  label="Headless by default"
                  hint="Uncheck to watch the browser work"
                />
              </div>
            </div>
          </Section>

          {/* providers */}
          <Section title="Providers (BYOK endpoints)">
            <div className="space-y-3">
              {settings.providers.map((p) => (
                <ProviderRow
                  key={p.id}
                  id={p.id}
                  label={p.label}
                  baseUrl={p.baseUrl}
                  models={p.models}
                  onSave={(baseUrl, models) =>
                    void saveSettings({
                      providers: settings.providers.map((x) =>
                        x.id === p.id ? { ...x, baseUrl, models } : x
                      )
                    })
                  }
                />
              ))}
            </div>
          </Section>

          {/* keys */}
          <Section title="API keys & tokens (OS-encrypted, never in settings.json)">
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center gap-2 rounded-lg bg-ink-850 px-3 py-2">
                  <KeyRound size={14} className={k.hasKey ? 'text-mint-400' : 'text-slate-600'} />
                  <span className="w-64 text-xs text-slate-300">{k.label}</span>
                  <span className="flex-1 font-mono text-[11px] text-slate-500">
                    {k.hasKey ? `•••• ${k.hint ?? ''}` : 'not set'}
                  </span>
                  <input
                    className="input !w-64 !py-1 font-mono !text-xs"
                    type="password"
                    placeholder={k.hasKey ? 'replace…' : 'paste value…'}
                    value={keyDrafts[k.id] ?? ''}
                    onChange={(e) => setKeyDrafts({ ...keyDrafts, [k.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (keyDrafts[k.id] ?? '').trim()) {
                        void saveKey(k.id, (keyDrafts[k.id] ?? '').trim()).then(() => {
                          setKeyDrafts({ ...keyDrafts, [k.id]: '' })
                          toast('info', `${k.label} saved`)
                        })
                      }
                    }}
                  />
                  <button
                    className="btn-primary !px-2.5 !py-1.5"
                    disabled={!(keyDrafts[k.id] ?? '').trim()}
                    onClick={() =>
                      void saveKey(k.id, (keyDrafts[k.id] ?? '').trim()).then(() => {
                        setKeyDrafts({ ...keyDrafts, [k.id]: '' })
                        toast('info', `${k.label} saved`)
                      })
                    }
                  >
                    <Save size={13} />
                  </button>
                  <button
                    className="text-slate-600 hover:text-red-400 disabled:opacity-30"
                    disabled={!k.hasKey}
                    title="Remove"
                    onClick={() => void deleteKey(k.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-slate-600">
              Encrypted with Windows DPAPI via Electron safeStorage ({'✓'} available on this PC). Keys never touch
              the renderer or the network except as Authorization headers to the provider you configured.
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function ProviderRow({
  label,
  baseUrl,
  models,
  onSave
}: {
  id: string
  label: string
  baseUrl: string
  models: string[]
  onSave: (baseUrl: string, models: string[]) => void
}) {
  const [url, setUrl] = useState(baseUrl)
  const [modelList, setModelList] = useState(models.join(', '))
  const dirty = url !== baseUrl || modelList !== models.join(', ')
  return (
    <div className="rounded-lg bg-ink-850 p-3">
      <div className="mb-2 text-xs font-semibold text-veronica-300">{label}</div>
      <div className="flex flex-col gap-2">
        <input
          className="input font-mono !text-xs"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
        />
        <div className="flex gap-2">
          <input
            className="input flex-1 font-mono !text-xs"
            value={modelList}
            onChange={(e) => setModelList(e.target.value)}
            placeholder="model-a, model-b"
          />
          <button className="btn-ghost !py-1.5 !text-xs" disabled={!dirty} onClick={() => onSave(url.trim(), modelList.split(',').map((m) => m.trim()).filter(Boolean))}>
            Save endpoint
          </button>
        </div>
      </div>
    </div>
  )
}
