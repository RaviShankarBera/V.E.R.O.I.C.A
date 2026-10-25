import { useEffect, useState } from 'react'
import { Camera, Eye, Globe, MousePointerClick, X } from 'lucide-react'
import { useStore } from '../store'
import { Header } from './Memory'
import { Empty, Pill } from '../components/ui'

export default function BrowserView() {
  const browser = useStore((s) => s.browser)
  const read = useStore((s) => s.browserRead)
  const shot = useStore((s) => s.browserShot)
  const settings = useStore((s) => s.settings)
  const openBrowser = useStore((s) => s.openBrowser)
  const closeBrowser = useStore((s) => s.closeBrowser)
  const refreshBrowser = useStore((s) => s.refreshBrowser)
  const readBrowser = useStore((s) => s.readBrowser)
  const shotBrowser = useStore((s) => s.shotBrowser)
  const actBrowser = useStore((s) => s.actBrowser)
  const toast = useStore((s) => s.toast)

  const [url, setUrl] = useState('')
  const [headless, setHeadless] = useState(true)
  const [action, setAction] = useState<'click' | 'type' | 'scroll'>('click')
  const [selector, setSelector] = useState('')
  const [text, setText] = useState('')

  useEffect(() => {
    setHeadless(settings?.browser.headless ?? true)
  }, [settings?.browser.headless])

  useEffect(() => {
    void refreshBrowser()
  }, [refreshBrowser])

  const open = (): void => {
    if (!url.trim()) return
    void openBrowser(url.trim(), headless).catch((e: Error) => toast('error', e.message))
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Browser Automation"
        subtitle={`Playwright driving local ${settings?.browser.channel === 'chrome' ? 'Chrome' : 'Edge'} · no downloaded browser`}
      />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* controls */}
          <div className="card">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe size={14} className="absolute top-3 left-3 text-slate-500" />
                <input
                  className="input !pl-9"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && open()}
                />
              </div>
              <label className="flex items-center gap-1.5 px-2 text-xs text-slate-400">
                <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
                headless
              </label>
              <button className="btn-primary" onClick={open}>
                Open
              </button>
              {browser?.running && (
                <button className="btn-danger" onClick={() => void closeBrowser()}>
                  <X size={14} /> Close
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <Pill tone={browser?.running ? 'ok' : 'idle'}>{browser?.running ? 'running' : 'stopped'}</Pill>
              {browser?.url && <span className="truncate font-mono">{browser.url}</span>}
              <div className="flex-1" />
              <button className="btn-ghost !py-1 !text-xs" onClick={() => void readBrowser()}>
                <Eye size={13} /> Read
              </button>
              <button className="btn-ghost !py-1 !text-xs" onClick={() => void shotBrowser()}>
                <Camera size={13} /> Screenshot
              </button>
            </div>
          </div>

          {/* act */}
          {browser?.running && (
            <div className="card">
              <div className="label">Interact</div>
              <div className="flex gap-2">
                <select className="input !w-32" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
                  <option value="click">click</option>
                  <option value="type">type</option>
                  <option value="scroll">scroll</option>
                </select>
                <input
                  className="input flex-1 font-mono !text-xs"
                  placeholder="CSS selector, e.g. button.submit"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                />
                {action === 'type' && (
                  <input
                    className="input flex-1"
                    placeholder="text to type"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                )}
                <button
                  className="btn-ghost"
                  onClick={() =>
                    void actBrowser(action, selector, action === 'type' ? text : undefined).catch((e: Error) =>
                      toast('error', e.message)
                    )
                  }
                  disabled={!selector.trim()}
                >
                  <MousePointerClick size={14} /> Run
                </button>
              </div>
            </div>
          )}

          {/* screenshot */}
          {shot && (
            <div className="card">
              <div className="label">Screenshot</div>
              <img src={shot} alt="page screenshot" className="w-full rounded-lg border border-ink-700" />
            </div>
          )}

          {/* read output */}
          {read && (
            <div className="card">
              <div className="label">
                Page text — {read.title || '(no title)'} · {read.url}
                {read.truncated ? ' · truncated' : ''}
              </div>
              <pre className="max-h-72 overflow-y-auto text-xs whitespace-pre-wrap text-slate-400">{read.text}</pre>
            </div>
          )}

          {!browser?.running && !read && !shot && (
            <Empty text="Open a URL to start — the agent can drive this browser too (browser_open / browser_read / browser_act tools)." />
          )}
        </div>
      </div>
    </div>
  )
}
