/**
 * System monitor — CPU/RAM/disk snapshots, process listing and a guarded
 * kill that only ever touches processes owned by the signed-in user
 * (owner verified via Win32_Process.GetOwner; fail-closed).
 * Original work © 2026 Ravi Shankar Bera.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import si from 'systeminformation'
import type { MonitorSnapshot, ProcessInfo } from '../../shared/types'

const execFileP = promisify(execFile)

const CRITICAL = new Set([
  'system',
  'registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
  'fontdrvhost.exe'
])

let cache: { at: number; value: MonitorSnapshot } | null = null

export async function snapshot(refreshMs = 2500): Promise<MonitorSnapshot> {
  if (cache && Date.now() - cache.at < Math.min(refreshMs, 2500)) return cache.value
  const [load, mem, disks] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()])
  const value: MonitorSnapshot = {
    cpu: {
      load: Math.round(load.currentLoad * 10) / 10,
      cores: os.cpus().length,
      speed: os.cpus()[0]?.speed ?? 0
    },
    mem: {
      total: mem.total,
      used: mem.total - mem.free,
      free: mem.free,
      swapUsed: mem.swaptotal > 0 ? mem.swaptotal - mem.swapfree : 0
    },
    disks: disks
      .filter((d) => d.size > 0)
      .map((d) => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        mount: d.mount
      })),
    uptime: os.uptime(),
    procs: 0,
    at: Date.now()
  }
  cache = { at: Date.now(), value }
  return value
}

export async function listProcesses(filter?: string): Promise<ProcessInfo[]> {
  const { list } = await si.processes()
  const own = process.pid
  const q = filter?.trim().toLowerCase()
  let rows = list
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round((p.cpu ?? 0) * 10) / 10,
      mem: Math.round(p.mem ?? 0), // systeminformation reports MB
      started: p.started,
      user: (p as { user?: string }).user
    }))
    .filter((p) => {
      const name = p.name.toLowerCase()
      const isSelf = p.pid === own || name.includes('veronica')
      const isCritical = p.pid <= 8 || CRITICAL.has(name)
      return !(isSelf || isCritical)
    })
  if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q))
  rows.sort((a, b) => b.cpu - a.cpu)
  return rows.slice(0, 120).map((p) => ({ ...p, protected: false }))
}

async function ownerOf(pid: number): Promise<string | null> {
  const script =
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
    `if (-not $p) { Write-Output 'GONE'; exit 0 }; ` +
    `$o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue; ` +
    `if ($o) { Write-Output ($o.Domain + '\\' + $o.User) } else { Write-Output 'SYSTEM' }`
  try {
    const { stdout } = await execFileP(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 6000, windowsHide: true }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function killProcess(pid: number): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isInteger(pid) || pid <= 8) return { ok: false, reason: 'Refused: system-critical PID.' }
  if (pid === process.pid) return { ok: false, reason: 'Refused: refusing to kill Veronica itself.' }
  const name = (process as unknown as { name?: string }).name
  void name

  const owner = await ownerOf(pid)
  if (owner === null) return { ok: false, reason: 'Refused: could not verify process owner (fail-closed).' }
  if (owner === 'GONE') return { ok: false, reason: 'Process already exited.' }

  const domainUser = owner.includes('\\') ? owner.split('\\').pop()! : owner
  const me = os.userInfo().username
  const systemish = owner === 'SYSTEM' || owner.includes('NT AUTHORITY')
  if (systemish || domainUser.toLowerCase() !== me.toLowerCase()) {
    return { ok: false, reason: `Refused: process belongs to ${owner}, not ${me}.` }
  }

  try {
    process.kill(pid, 'SIGTERM')
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `kill failed: ${(err as Error).message}` }
  }
}
