import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { RefreshCw, Send } from 'lucide-react'
import { useStore } from '../store'
import { Empty, Pill, Toggle } from '../components/ui'
import { Header } from './Memory'
import type { IntegrationId } from '@shared/types'

const HINTS: Record<IntegrationId, { setup: string; whoami: string }> = {
  telegram: {
    setup: 'Create a bot with @BotFather → copy the token → add it in Settings → Keys as “Telegram bot token”.',
    whoami: 'Message the bot /whoami to discover your chat id, then add it below.'
  },
  slack: {
    setup: 'Create a Slack app with Socket Mode enabled → add app token (xapp-) and bot token (xoxb-) in Settings → Keys.',
    whoami: 'DM the bot directly, or add a channel id (C…) below.'
  },
  whatsapp: {
    setup: 'No token needed — pair by scanning the QR with WhatsApp (Linked Devices). Data stays on this PC.',
    whoami: 'Message the linked account /whoami from your phone to discover your JID, then add it below.'
  }
}

export default function IntegrationsView() {
  const status = useStore((s) => s.integStatus)
  const config = useStore((s) => s.integConfig)
  const load = useStore((s) => s.loadIntegrations)
  const apply = useStore((s) => s.applyIntegration)
  const send = useStore((s) => s.sendIntegration)
  const toast = useStore((s) => s.toast)

  const [allowedDraft, setAllowedDraft] = useState<Record<string, string>>({})
  const [testText, setTestText] = useState<Record<string, string>>({})
  const [qrImg, setQrImg] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const waStatus = status.find((s) => s.id === 'whatsapp')
  useEffect(() => {
    let live = true
    if (waStatus?.state === 'qr' && waStatus.qr) {
      void QRCode.toDataURL(waStatus.qr, { width: 260, margin: 1 })
        .then((url) => live && setQrImg(url))
        .catch(() => live && setQrImg(null))
    } else if (waStatus?.state !== 'qr') {
      setQrImg(null)
    }
    return () => {
      live = false
    }
  }, [waStatus?.state, waStatus?.qr])

  const tone = (state: string): 'ok' | 'warn' | 'err' | 'idle' =>
    state === 'connected' ? 'ok' : state === 'error' || state === 'unauthorized' ? 'err' : state === 'qr' || state === 'starting' ? 'warn' : 'idle'

  return (
    <div className="flex h-full flex-col">
      <Header title="Messaging Channels" subtitle="Telegram · Slack · WhatsApp — inbound messages run through the agent" />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {config.length === 0 && <Empty text="Loading…" />}
          {config.map((cfg) => {
            const st = status.find((s) => s.id === cfg.id)
            const hint = HINTS[cfg.id]
            const draftAllowed = allowedDraft[cfg.id] ?? cfg.allowed.join(', ')
            return (
              <div key={cfg.id} className="card">
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-sm font-semibold text-white">{st?.label ?? cfg.id}</span>
                  <Pill tone={tone(st?.state ?? 'idle')}>{st?.state ?? 'disabled'}</Pill>
                  <span className="text-[11px] text-slate-600">
                    {st?.stats.received ?? 0} received · {st?.stats.replied ?? 0} replied
                  </span>
                  <div className="flex-1" />
                  <button className="btn-ghost !py-1 !text-xs" onClick={() => void load()}>
                    <RefreshCw size={12} />
                  </button>
                </div>

                {st?.detail && st.state !== 'connected' && (
                  <div className="mb-2 text-xs text-amber-400/90">{st.detail}</div>
                )}

                <div className="mb-3 text-xs text-slate-500">{hint.setup}</div>

                {cfg.id === 'whatsapp' && qrImg && (
                  <div className="mb-3 flex flex-col items-center gap-2 rounded-xl bg-white/95 p-3">
                    <img src={qrImg} alt="WhatsApp pairing QR" width={260} height={260} />
                    <span className="text-xs text-slate-700">WhatsApp → Linked Devices → Link a Device</span>
                  </div>
                )}

                <div className="space-y-3">
                  <Toggle
                    checked={cfg.enabled}
                    onChange={(v) => void apply(cfg.id, v, cfg.respondToAll, cfg.allowed)}
                    label={cfg.enabled ? 'Enabled' : 'Disabled'}
                    hint={cfg.enabled ? 'Listening for inbound messages' : 'Turn on to start listening'}
                  />
                  <Toggle
                    checked={cfg.respondToAll}
                    onChange={(v) => void apply(cfg.id, cfg.enabled, v, cfg.allowed)}
                    label="Respond to everyone"
                    hint="Off = only allowlisted ids (strongly recommended)"
                  />
                  <div>
                    <div className="label">Allowed ids (comma separated)</div>
                    <div className="flex gap-2">
                      <input
                        className="input flex-1 font-mono !text-xs"
                        placeholder={cfg.id === 'slack' ? 'C0123…, D0456…' : 'id1, id2'}
                        value={draftAllowed}
                        onChange={(e) => setAllowedDraft({ ...allowedDraft, [cfg.id]: e.target.value })}
                      />
                      <button
                        className="btn-ghost"
                        onClick={() =>
                          void apply(
                            cfg.id,
                            cfg.enabled,
                            cfg.respondToAll,
                            draftAllowed.split(',').map((x) => x.trim()).filter(Boolean)
                          ).catch((e: Error) => toast('error', e.message))
                        }
                      >
                        Save
                      </button>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-600">{hint.whoami}</div>
                  </div>

                  {cfg.keyHints.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {cfg.keyHints.map((k) => (
                        <Pill key={k.id} tone={k.hasKey ? 'ok' : 'err'}>
                          {k.label}: {k.hasKey ? `set ${k.hint ?? ''}` : 'missing — add in Settings → Keys'}
                        </Pill>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2 border-t border-ink-700 pt-3">
                    <input
                      className="input flex-1 !py-1.5 !text-xs"
                      placeholder={cfg.enabled ? 'send a test message…' : 'enable the integration first'}
                      value={testText[cfg.id] ?? ''}
                      onChange={(e) => setTestText({ ...testText, [cfg.id]: e.target.value })}
                      disabled={!cfg.enabled}
                    />
                    <button
                      className="btn-ghost !py-1.5 !text-xs"
                      disabled={!cfg.enabled || !(testText[cfg.id] ?? '').trim()}
                      onClick={() =>
                        void send(cfg.id, '', (testText[cfg.id] ?? '').trim())
                          .then(() => {
                            toast('info', `${cfg.id}: sent`)
                            setTestText({ ...testText, [cfg.id]: '' })
                          })
                          .catch((e: Error) => toast('error', e.message))
                      }
                    >
                      <Send size={12} /> Send
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
