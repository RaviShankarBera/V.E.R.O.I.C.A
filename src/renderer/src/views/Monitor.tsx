import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Search, Skull } from 'lucide-react'
import { bytes, timeAgo } from '../lib/api'
import { useStore } from '../store'
import { Header } from './Memory'
import { Empty } from '../components/ui'

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

export default function MonitorView() {
  const snap = useStore((s) => s.snap)
  const procs = useStore((s) => s.procs)
  const procsFilter = useStore((s) => s.procsFilter)
  const settings = useStore((s) => s.settings)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const loadProcs = useStore((s) => s.loadProcs)
  const setProcsFilter = useStore((s) => s.setProcsFilter)
  const killPid = useStore((s) => s.killPid)

  const [confirmKill, setConfirmKill] = useState<number | null>(null)
  const interval = useRef<number | null>(null)

  useEffect(() => {
    void loadSnapshot()
    void loadProcs()
    interval.current = window.setInterval(
      () => {
        void loadSnapshot()
      },
      Math.max(1500, settings?.monitor.refreshMs ?? 3000)
    )
    return () => {
      if (interval.current) window.clearInterval(interval.current)
    }
  }, [loadSnapshot, loadProcs, settings?.monitor.refreshMs])

  const cpu = snap?.cpu.load ?? 0
  const memPct = snap ? pct(snap.mem.used, snap.mem.total) : 0

  return (
    <div className="flex h-full flex-col">
      <Header title="System Monitor" subtitle="Live hardware telemetry · user-scoped process control" />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-4xl">
          {/* gauges */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Gauge label="CPU" value={`${cpu}%`} pct={cpu} tone={cpu > 85 ? 'err' : cpu > 60 ? 'warn' : 'ok'} sub={`${snap?.cpu.cores ?? 0} cores · ${(snap?.cpu.speed ?? 0) / 1000} GHz`} />
            <Gauge
              label="Memory"
              value={`${memPct}%`}
              pct={memPct}
              tone={memPct > 90 ? 'err' : memPct > 75 ? 'warn' : 'ok'}
              sub={`${bytes(snap?.mem.used ?? 0)} / ${bytes(snap?.mem.total ?? 0)}`}
            />
            <Gauge
              label="Uptime"
              value={fmtUptime(snap?.uptime ?? 0)}
              pct={0}
              tone="ok"
              sub={snap ? `updated ${timeAgo(snap.at)}` : ''}
            />
          </div>

          {/* disks */}
          <div className="mb-4 card">
            <div className="label">Disks</div>
            <div className="space-y-3">
              {snap?.disks.map((d) => {
                const p = pct(d.used, d.size)
                return (
                  <div key={d.fs + d.mount}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-slate-300">
                        {d.mount} <span className="text-slate-600">({d.fs} · {d.type})</span>
                      </span>
                      <span className="text-slate-500">
                        {bytes(d.used)} / {bytes(d.size)} · {p}%
                      </span>
                    </div>
                    <Bar pct={p} tone={p > 90 ? 'err' : p > 75 ? 'warn' : 'ok'} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* processes */}
          <div className="card">
            <div className="mb-3 flex items-center gap-2">
              <div className="label !mb-0 flex-1">Processes ({procs.length})</div>
              <div className="relative">
                <Search size={13} className="absolute top-2.5 left-2.5 text-slate-500" />
                <input
                  className="input !w-44 !py-1.5 !pl-8 text-xs"
                  placeholder="filter…"
                  value={procsFilter}
                  onChange={(e) => setProcsFilter(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void loadProcs()}
                />
              </div>
              <button className="btn-ghost !py-1.5" onClick={() => void loadProcs()}>
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-ink-900 text-left text-slate-500">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">PID</th>
                    <th className="py-1.5 pr-2 font-medium">Name</th>
                    <th className="py-1.5 pr-2 text-right font-medium">CPU%</th>
                    <th className="py-1.5 pr-2 text-right font-medium">RAM</th>
                    <th className="py-1.5 pr-2 font-medium">Started</th>
                    <th className="py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {procs.map((p) => (
                    <tr key={p.pid} className="border-t border-ink-800 hover:bg-ink-850">
                      <td className="py-1.5 pr-2 font-mono text-slate-500">{p.pid}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{p.name}</td>
                      <td className="py-1.5 pr-2 text-right text-slate-400">{p.cpu}</td>
                      <td className="py-1.5 pr-2 text-right text-slate-400">{p.mem} MB</td>
                      <td className="py-1.5 pr-2 text-slate-600">{p.started ?? '—'}</td>
                      <td className="py-1.5 text-right">
                        {confirmKill === p.pid ? (
                          <span className="inline-flex gap-1">
                            <button className="btn-danger !px-2 !py-0.5 !text-[11px]" onClick={() => { void killPid(p.pid); setConfirmKill(null) }}>
                              Kill?
                            </button>
                            <button className="btn-ghost !px-2 !py-0.5 !text-[11px]" onClick={() => setConfirmKill(null)}>
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-red-400"
                            onClick={() => setConfirmKill(p.pid)}
                          >
                            <Skull size={12} /> kill
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {procs.length === 0 && <Empty text="No processes — click refresh." />}
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
              System-critical processes, Veronica itself, and anything not owned by your Windows account are
              protected (owner verified before termination).
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Gauge({
  label,
  value,
  pct,
  tone,
  sub
}: {
  label: string
  value: string
  pct: number
  tone: 'ok' | 'warn' | 'err'
  sub: string
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {pct > 0 && <div className="mt-2"><Bar pct={pct} tone={tone} /></div>}
      <div className="mt-2 text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

function Bar({ pct, tone }: { pct: number; tone: 'ok' | 'warn' | 'err' }) {
  const color = tone === 'err' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-400' : 'bg-mint-400'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
