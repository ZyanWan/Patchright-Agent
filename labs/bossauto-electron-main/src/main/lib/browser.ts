// 浏览器接入:启动【真实 Chrome】带 9222 调试端口 + 持久 profile,再用 Playwright
// connectOverCDP 附加。这是验证过的方案:
// - 附加真实 Chrome → 同站 iframe(都是 zhipin.com)不被 site isolation 隔离,同进程,
//   addInitScript/hook 能在详情 c-resume iframe 的 canvas 绘制前装上
// - 真实 Chrome 自己的 profile 持久化登录,不受 App-Bound Encryption 影响,登录态不丢
// - 点击走 CDP 真实鼠标事件(isTrusted=true),BOSS 不拦
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium, type Browser, type BrowserContext, type Page } from 'patchright'
import { log } from './logger'
import { paths } from './paths'

const BOSS_SEARCH = 'https://www.zhipin.com/web/chat/search'

const CDP_PORT = 9222
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe'
]

// canvas hook 源码:通过主 page 的 CDP Page.addScriptToEvaluateOnNewDocument 注入。
// 在每个新 document(含同进程 c-resume)创建最早期执行,赶在 canvas 绘制前 hook 住 fillText。
const CANVAS_HOOK_SOURCE = `(function(){
  if (window.__bsaHooked) return;
  window.__bsaHooked = true;
  window.__captured = [];
  window.__canvasStats = {fillText:0, strokeText:0, off:0, transferOffscreen:0, createWorker:0, webgl:0, getCtx2d:0};
  function hp(p, k){
    if (!p || p.__h) return; p.__h = 1;
    ['fillText','strokeText'].forEach(function(m){
      var o = p[m]; if(!o) return;
      p[m] = function(t, x, y){
        try { window.__canvasStats[k||m]++; window.__captured.push({t:String(t), x:x, y:y, fs:String(this.fillStyle).slice(0,30)}); } catch(e){}
        return o.apply(this, arguments);
      };
    });
  }
  try { hp(CanvasRenderingContext2D.prototype); } catch(e){}
  try { if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') hp(OffscreenCanvasRenderingContext2D.prototype, 'off'); } catch(e){}
  // 诊断画法(绘制前 hook,准确):transferControlToOffscreen / Worker / getContext 类型
  try {
    var hc = HTMLCanvasElement.prototype;
    if (hc.transferControlToOffscreen){ var ot=hc.transferControlToOffscreen; hc.transferControlToOffscreen=function(){try{window.__canvasStats.transferOffscreen++;}catch(e){}return ot.apply(this,arguments);}; }
    var ogc = hc.getContext;
    hc.getContext = function(type){ try{ if(String(type).indexOf('webgl')>=0)window.__canvasStats.webgl++; else if(String(type).indexOf('2d')>=0)window.__canvasStats.getCtx2d++; }catch(e){} return ogc.apply(this,arguments); };
    if (window.Worker){ var OW=window.Worker; var NW=function(u,o){try{window.__canvasStats.createWorker++; if(!window.__workerUrls)window.__workerUrls=[]; window.__workerUrls.push(String(u).slice(0,80));}catch(e){} return new OW(u,o);}; NW.prototype=OW.prototype; window.Worker=NW; }
  } catch(e){}
})()`

type State = {
  browser: Browser | null
  context: BrowserContext | null
  page: Page | null
}

const state: State = { browser: null, context: null, page: null }

export function isLaunched(): boolean {
  return state.context !== null && state.page !== null && !state.page.isClosed()
}

export function allZhipinPages(): Page[] {
  if (!state.context) return []
  return state.context.pages().filter((p) => !p.isClosed() && /zhipin\.com/.test(p.url()))
}

export function currentPage(): Page | null {
  if (state.context) {
    const all = state.context.pages().filter((p) => !p.isClosed())
    const zhipin = all.filter((p) => /zhipin\.com/.test(p.url()))
    if (zhipin.length > 0) {
      // 优先搜索页(用户在搜索页操作),其次推荐页,再其次任意 chat
      const search = zhipin.find((p) => /web\/chat\/search/.test(p.url()))
      const recommend = zhipin.find((p) => /web\/chat\/recommend/.test(p.url()))
      const chat = zhipin.find((p) => /web\/chat\//.test(p.url()))
      const pick = search || recommend || chat || zhipin[zhipin.length - 1]
      if (pick !== state.page) {
        log.info(`[browser]切换活跃 page → ${pick.url()}`)
        state.page = pick
      }
      return pick
    }
  }
  if (!state.page || state.page.isClosed()) return null
  return state.page
}

function findChrome(): string | null {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p
  return null
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    s.setTimeout(700)
    s.on('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => resolve(false))
    s.on('timeout', () => {
      s.destroy()
      resolve(false)
    })
  })
}

async function waitPort(port: number, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export async function launchBrowser(): Promise<void> {
  if (isLaunched()) {
    log.info('Chrome 已附加,跳过启动')
    return
  }
  const profileDir = paths.chromeProfile()
  await mkdir(profileDir, { recursive: true })

  // 1) 若 9222 没开,spawn 真实 Chrome
  if (!(await portOpen(CDP_PORT))) {
    const chromeExe = findChrome()
    if (!chromeExe) {
      throw new Error('未找到 Google Chrome,请先安装 Chrome')
    }
    log.info(`启动真实 Chrome(CDP 附加):${chromeExe}`)
    const child = spawn(
      chromeExe,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        // 不再禁用 site isolation:让 c-resume 详情 iframe 保持独立 target,
        // 这样能对它单独用 CDP addScriptToEvaluateOnNewDocument(canvas 绘制前注入 hook)
        BOSS_SEARCH // 只开一个 tab:搜索页
      ],
      { detached: true, stdio: 'ignore' }
    )
    child.unref()
    if (!(await waitPort(CDP_PORT))) {
      throw new Error('Chrome 9222 端口未就绪(可能启动失败)')
    }
  } else {
    log.info('检测到 9222 已开,直接附加现有 Chrome')
  }

  // 2) connectOverCDP 附加
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  // 找/建 zhipin 页。已有 BOSS 页面时只附加不改地址,避免打断用户停留的推荐/搜索页面。
  const pages = context.pages()
  let page = pages.find((p) => /zhipin\.com/.test(p.url()))
  if (!page) {
    page = pages.length > 0 ? pages[0] : await context.newPage()
    log.info(`导航到 BOSS 搜索页:${BOSS_SEARCH}`)
    await page.goto(BOSS_SEARCH, { waitUntil: 'domcontentloaded' }).catch((e) => {
      log.warn(`导航失败:${(e as Error).message}`)
    })
  } else {
    log.info(`保留已有 BOSS 页面:${page.url()}`)
  }

  state.browser = browser
  state.context = context
  state.page = page

  // 对主 page 的 CDP session 注入 canvas hook:Page.addScriptToEvaluateOnNewDocument
  // 在每个新 document(含同进程的 c-resume 详情 iframe)创建最早期、canvas 绘制前注入主世界 hook
  try {
    const client = await context.newCDPSession(page)
    await client.send('Page.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: CANVAS_HOOK_SOURCE })
    log.info('[canvas]CDP addScriptToEvaluateOnNewDocument 已注入(覆盖 c-resume 新文档)')
  } catch (e) {
    log.warn(`[canvas]CDP 注入失败:${(e as Error).message}`)
  }

  context.on('close', () => {
    log.warn('Chrome context 已关闭(CDP 断开)')
    state.context = null
    state.page = null
  })
  browser.on('disconnected', () => {
    log.warn('CDP 连接已断开')
    state.browser = null
    state.context = null
    state.page = null
  })

  log.info('已附加真实 Chrome(canvas hook 由 runner 注入)')
}

// 自动在搜索页填关键词搜索(不依赖用户手动搜)。搜索框可能在 main 或 searchFrame。
export async function autoSearch(keyword: string, pageArg?: Page | null): Promise<boolean> {
  const page = pageArg ?? currentPage()
  if (!page) return false
  // 不再按"同关键词"全局跳过:换页/换 tab 后即便同词也要在当前页重新搜,避免在错误列表上操作
  const targets: Array<Page | import('patchright').Frame> = [page]
  const sf = page.frames().find((f) => f.name() === 'searchFrame')
  if (sf) targets.push(sf)
  const selectors = [
    'input[placeholder*="搜索"]',
    'input[placeholder*="职位"]',
    'input[placeholder*="关键"]',
    'input[placeholder*="牛人"]',
    '.search-input input',
    '.nav-search input',
    '.search-wrap input',
    'input.ipt',
    'input[type="text"]'
  ]
  for (const ctx of targets) {
    for (const sel of selectors) {
      try {
        const inp = ctx.locator(sel).first()
        if ((await inp.count().catch(() => 0)) === 0) continue
        if (!(await inp.isVisible().catch(() => false))) continue
        await inp.click({ timeout: 1500 }).catch(() => {})
        await inp.fill('').catch(() => {})
        await inp.fill(keyword).catch(() => {})
        await inp.press('Enter')
        log.info(
          `[autoSearch]已搜"${keyword}" (${ctx === page ? 'main' : 'searchFrame'} / ${sel})`
        )
        return true
      } catch {
        // 试下一个
      }
    }
  }
  log.warn('[autoSearch]未找到搜索框,dump 输入框诊断')
  for (const ctx of targets) {
    const inputs = await (ctx as Page)
      .evaluate(() => {
        return Array.from(document.querySelectorAll('input'))
          .slice(0, 10)
          .map((i) => `[ph="${i.placeholder}" cls="${(i.className || '').slice(0, 30)}"]`)
          .join(' ')
      })
      .catch(() => '')
    if (inputs) log.info(`[autoSearch诊断]${ctx === page ? 'main' : 'searchFrame'} inputs: ${inputs}`)
  }
  return false
}

export async function closeBrowser(): Promise<void> {
  // 只断开 CDP 连接,不强杀 Chrome(让真实 Chrome 持久保留登录态)
  if (state.browser) {
    log.info('断开 CDP(Chrome 保持运行,登录态保留)')
    await state.browser.close().catch(() => {})
  }
  state.browser = null
  state.context = null
  state.page = null
}

export async function getStatus() {
  const page = currentPage()
  if (!isLaunched() || !page) {
    return { launched: false, url: '', loggedIn: false, cardCount: 0 }
  }
  const url = page.url()
  const loggedIn = /zhipin\.com\/web\/(chat|geek)/.test(url) && !/\/web\/user/.test(url)
  // 遍历所有 frame(含 OOPIF)用 Playwright frame API 数卡,不靠 contentDocument
  let cardCount = 0
  try {
    for (const f of page.frames()) {
      const n = (await f
        .evaluate(() => {
          const sels = ['li.geek-info-card', 'div.candidate-card-wrap', 'li.card-item', '.geek-item', '.candidate-card']
          for (const s of sels) {
            const c = document.querySelectorAll(s).length
            if (c > 0) return c
          }
          return 0
        })
        .catch(() => 0)) as number
      cardCount += n
    }
  } catch {
    // 切页中
  }
  return { launched: true, url, loggedIn, cardCount }
}
