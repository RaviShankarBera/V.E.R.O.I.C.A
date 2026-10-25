/** Small shared UI primitives. Original work © 2026 Ravi Shankar Bera. */
import type { ReactNode } from 'react'

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-veronica-500' : 'bg-ink-700'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-bold tracking-[0.15em] text-veronica-400">{title.toUpperCase()}</h3>
      <div className="card space-y-3">{children}</div>
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-slate-600">{text}</div>
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'idle'; children: ReactNode }) {
  const map = {
    ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    err: 'bg-red-500/15 text-red-300 ring-red-500/30',
    idle: 'bg-slate-500/15 text-slate-400 ring-slate-500/30'
  } as const
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${map[tone]}`}>
      {children}
    </span>
  )
}
