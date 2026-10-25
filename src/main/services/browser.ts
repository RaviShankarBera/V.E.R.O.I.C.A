/**
 * Browser automation (Playwright, driving the locally-installed Edge/Chrome —
 * no browser binary downloads). Provides read/click/type/screenshot to the
 * agent harness and the Browser view.
 * Original work © 2026 Ravi Shankar Bera.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { BrowserReadResult, BrowserState } from '../../shared/types'

export class BrowserService {
  private browser: Browser | null = null
  private page: Page | null = null
  private headless = true
  private lastAction = ''
  private readonly shotDir: string

  constructor(userDataDir: string) {
    this.shotDir = path.join(userDataDir, 'shots')
    fs.mkdirSync(this.shotDir, { recursive: true })
  }

  state(): BrowserState {
    return {
      running: !!this.page,
      url: this.page?.url() ?? null,
      title: null,
      headless: this.headless,
      lastAction: this.lastAction || undefined
    }
  }

  async open(url: string, headless: boolean, channel: 'msedge' | 'chrome'): Promise<BrowserState> {
    const target = normalizeUrl(url)
    if (!this.browser) {
      this.browser = await chromium.launch({ channel, headless })
    }
    // Re-launch when headless mode toggles (playwright bakes it into launch).
    if (this.headless !== headless) {
      await this.close()
      this.browser = await chromium.launch({ channel, headless })
    }
    this.headless = headless
    this.page = this.page ?? (await this.browser.newPage())
    await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
    this.lastAction = `open ${target}`
    const state = this.state()
    state.title = await this.page.title().catch(() => '')
    return state
  }

  async close(): Promise<BrowserState> {
    try {
      await this.browser?.close()
    } catch {
      /* already gone */
    }
    this.browser = null
    this.page = null
    this.lastAction = 'close'
    return this.state()
  }

  private need(): Page {
    if (!this.page) throw new Error('Browser is not running — open a URL first.')
    return this.page
  }

  async read(): Promise<BrowserReadResult> {
    const page = this.need()
    const title = await page.title().catch(() => '')
    const text = await page
      .evaluate(() => document.body?.innerText ?? '')
      .catch(() => '')
    this.lastAction = 'read'
    const limit = 12000
    return { url: page.url(), title, text: text.slice(0, limit), truncated: text.length > limit }
  }

  async screenshot(): Promise<{ dataUrl: string; path: string }> {
    const page = this.need()
    const file = path.join(this.shotDir, `shot-${Date.now()}.png`)
    const buf = await page.screenshot({ path: file, fullPage: false })
    this.lastAction = 'screenshot'
    return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, path: file }
  }

  async act(
    action: 'click' | 'type' | 'scroll',
    selector: string,
    text?: string
  ): Promise<{ ok: boolean; detail: string }> {
    const page = this.need()
    if (!selector.trim()) return { ok: false, detail: 'selector required' }
    switch (action) {
      case 'click':
        await page.click(selector, { timeout: 8000 })
        this.lastAction = `click ${selector}`
        return { ok: true, detail: `clicked ${selector}` }
      case 'type':
        await page.fill(selector, text ?? '', { timeout: 8000 })
        this.lastAction = `type ${selector}`
        return { ok: true, detail: `typed into ${selector}` }
      case 'scroll':
        await page.evaluate((s) => {
          const el = document.querySelector(s)
          if (el) el.scrollIntoView({ block: 'center' })
          else window.scrollBy(0, 600)
        }, selector || 'body')
        this.lastAction = `scroll ${selector}`
        return { ok: true, detail: 'scrolled' }
      default:
        return { ok: false, detail: `unknown action ${action}` }
    }
  }
}

function normalizeUrl(url: string): string {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) throw new Error('Only http(s) URLs are allowed.')
  return `https://${u}`
}
