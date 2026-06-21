// BOSS 搜索页筛选区 DOM 探测
// 把筛选区里所有可见的标签 / 链接 / 按钮 / 下拉抓回结构化数据,
// 写到 userData/filters-probe.json,后续根据这个写实际的"应用筛选"联动。
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Frame, Page } from 'patchright'
import { allZhipinPages, currentPage } from './browser'
import { log } from './logger'
import { sleep } from './human'

export type ProbeNode = {
  tag: string
  text: string
  cls: string
  role?: string
  href?: string
  isActive?: boolean
  childCount?: number
}

export type ProbeRegion = {
  selector: string // 抓这个区域时用的 selector
  found: boolean
  outerSnippet?: string // 前 800 字符 outerHTML 截断
  children: ProbeNode[]
}

export type FilterProbeResult = {
  url: string
  topLevelGroups: ProbeRegion[] // 顶部条件 chip 区
  sidebarGroups: ProbeRegion[] // 侧栏分组
  inferredFilterContainers: string[] // 用启发式找的可能 container selector 列表
  iframeName?: string
  ts: number
}

async function getActiveFrame(page: Page): Promise<Frame> {
  const url = page.url()
  const wantName = /web\/chat\/search/.test(url)
    ? 'searchFrame'
    : /web\/chat\/recommend/.test(url)
      ? 'recommendFrame'
      : null
  if (wantName) {
    for (let i = 0; i < 8; i++) {
      const f = page.frames().find((fr) => fr.name() === wantName && !fr.isDetached())
      if (f) return f
      await sleep(300)
    }
  }
  return page.mainFrame()
}

// 旧 PROBE_SCRIPT 留作参考(未使用);新版用 DUMP_SCRIPT 抓全量
// @ts-expect-error: kept for reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PROBE_SCRIPT = `() => {
  function describe(el) {
    const cls = (el.className || '').toString().slice(0, 120)
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50)
    const role = el.getAttribute('role') || ''
    const out = { tag: el.tagName.toLowerCase(), text, cls, childCount: el.children.length }
    if (role) out.role = role
    if (el.tagName === 'A') out.href = el.getAttribute('href') || ''
    if (/active|selected|on|chosen/i.test(cls)) out.isActive = true
    return out
  }
  function regionFor(selector) {
    const el = document.querySelector(selector)
    if (!el) return { selector, found: false, children: [] }
    const children = Array.from(el.querySelectorAll('a, button, [class*="select"], [class*="dropdown"], [class*="filter"]'))
      .filter(c => {
        const t = (c.textContent || '').trim()
        return t.length > 0 && t.length < 30
      })
      .slice(0, 50)
      .map(describe)
    return {
      selector,
      found: true,
      outerSnippet: (el.outerHTML || '').slice(0, 800),
      children
    }
  }
  // 候选 selector(BOSS 历史/常见)
  const topSels = [
    '.filter-condition-wrap',
    '.filter-condition',
    '.condition-wrap',
    '.search-condition-wrap',
    '.filter-select-conditions',
    '.filter-row'
  ]
  const sideSels = [
    '.filter-sidebar',
    '.sub-filter',
    '.filter-side',
    '.options-pane',
    '.search-filter',
    '.options-wrap'
  ]
  // 启发式:找包含 "学历/经验/院校/年龄/薪资" 文本的容器
  const KEY_WORDS = ['学历','经验','院校','年龄','薪资','工作经验','期望薪资','学校','行业','公司规模','活跃度','刷新','求职状态']
  const containers = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let n
  while ((n = walker.nextNode())) {
    const txt = (n.textContent || '').slice(0, 100)
    const hit = KEY_WORDS.filter(w => txt.includes(w))
    if (hit.length >= 3 && n.children.length >= 2 && n.children.length < 80) {
      const sel = n.tagName.toLowerCase() + (n.id ? '#'+n.id : '') + (n.className ? '.'+String(n.className).split(/\\s+/).slice(0,2).join('.') : '')
      containers.set(sel, (containers.get(sel) || 0) + hit.length)
    }
  }
  const inferred = Array.from(containers.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(x=>x[0])
  return {
    url: location.href,
    topLevelGroups: topSels.map(regionFor),
    sidebarGroups: sideSels.map(regionFor),
    inferredFilterContainers: inferred,
    ts: Date.now()
  }
}`

const DUMP_SCRIPT = `(() => {
  // 1) 全量 outerHTML(用于离线分析)
  const html = document.documentElement.outerHTML
  // 2) 抓所有含关键词的元素片段
  const KW = ['学历','工作经验','经验','院校','学校','年龄','期望薪资','薪资','行业','公司规模','活跃度','刷新','求职状态','在线','到岗','筛选','更多筛选','工作性质','英语','技能']
  const hits = []
  const all = document.body.querySelectorAll('*')
  for (let i = 0; i < all.length && hits.length < 200; i++) {
    const el = all[i]
    if (!(el instanceof HTMLElement)) continue
    if (el.children.length > 30) continue
    const t = (el.textContent || '').trim()
    if (t.length === 0 || t.length > 80) continue
    if (!KW.some(k => t.includes(k))) continue
    // 跳过纯文本节点(无 class、无 click handler)
    if (!el.className && el.tagName !== 'BUTTON' && el.tagName !== 'A') continue
    const cls = String(el.className || '').slice(0, 80)
    const tag = el.tagName.toLowerCase()
    // 父链 selector(往上 3 层)
    let parents = []
    let p = el.parentElement
    for (let d = 0; d < 3 && p; d++) {
      parents.push(p.tagName.toLowerCase() + (p.className ? '.'+String(p.className).split(/\\s+/).slice(0,2).join('.') : ''))
      p = p.parentElement
    }
    hits.push({ tag, cls, text: t.slice(0, 60), parents: parents.reverse().join(' > '), childCount: el.children.length })
  }
  // 3) 顶部 className 频次
  const freq = new Map()
  for (const el of Array.from(all)) {
    if (!(el instanceof HTMLElement)) continue
    const cs = String(el.className || '').split(/\\s+/).filter(Boolean)
    for (const c of cs) freq.set(c, (freq.get(c) || 0) + 1)
  }
  const topCls = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 60).map(([n,c])=>({name: n, count: c}))
  return {
    url: location.href,
    htmlSize: html.length,
    html, // 全文
    hits,
    topCls
  }
})()`

export async function probeBossFilters(): Promise<{
  url: string
  savedTo: string
  savedHtml: string
  hitCount: number
  htmlSize: number
  trace: string[]
}> {
  const trace: string[] = []
  const t = (s: string) => {
    trace.push(`${new Date().toLocaleTimeString()} ${s}`)
    log.info(`[probe] ${s}`)
  }
  const userData = app.getPath('userData')
  const jsonFile = path.join(userData, 'filters-probe.json')
  const htmlFile = path.join(userData, 'filters-probe.html')

  async function writeFinal(payload: Record<string, unknown>): Promise<void> {
    try {
      await writeFile(
        jsonFile,
        JSON.stringify({ ts: Date.now(), trace, ...payload }, null, 2),
        'utf8'
      )
    } catch (e) {
      log.warn(`写 json 失败:${(e as Error).message}`)
    }
  }

  t(`进入 probeBossFilters,userData=${userData}`)
  // 先把所有 zhipin tab 都列出来,各 evaluate body 长度
  const all = allZhipinPages()
  t(`共 ${all.length} 个 zhipin tab:`)
  type TabInfo = { url: string; bodyLen: number; title: string }
  const tabInfos: TabInfo[] = []
  for (const p of all) {
    let bodyLen = 0
    let title = ''
    try {
      bodyLen = (await p.evaluate('document.body ? document.body.innerHTML.length : 0')) as number
    } catch {
      bodyLen = -1
    }
    try {
      title = await p.title()
    } catch {
      title = '?'
    }
    const info: TabInfo = { url: p.url(), bodyLen, title }
    tabInfos.push(info)
    t(`  · "${title}" url=${p.url()} bodyLen=${bodyLen}`)
  }
  // 挑 body 最大的 page(最大说明渲染最完整)
  let page: Page | null = null
  let maxLen = -1
  for (let i = 0; i < all.length; i++) {
    if (tabInfos[i].bodyLen > maxLen) {
      maxLen = tabInfos[i].bodyLen
      page = all[i]
    }
  }
  if (!page) page = currentPage()
  if (!page) {
    t('currentPage() 返回 null;Chromium 未启动或页面被关')
    await writeFinal({ stage: 'no_page', tabs: tabInfos })
    return { url: '', savedTo: jsonFile, savedHtml: '', hitCount: 0, htmlSize: 0, trace }
  }
  t(`选中 page url=${page.url()},isClosed=${page.isClosed()}`)

  let frame: Frame
  try {
    frame = await getActiveFrame(page)
    t(`active frame name="${frame.name() || '(main)'}" url=${frame.url()}`)
  } catch (e) {
    t(`getActiveFrame 抛错:${(e as Error).message}`)
    await writeFinal({ stage: 'no_frame', error: (e as Error).message })
    return { url: page.url(), savedTo: jsonFile, savedHtml: '', hitCount: 0, htmlSize: 0, trace }
  }

  type Dump = {
    url: string
    htmlSize: number
    html: string
    hits: unknown[]
    topCls: unknown[]
  }
  let dump: Dump | null = null
  try {
    dump = (await frame.evaluate(DUMP_SCRIPT)) as Dump | null
    t(`evaluate 完成 htmlSize=${dump?.htmlSize}`)
  } catch (e) {
    t(`evaluate 抛错:${(e as Error).message}`)
    await writeFinal({
      stage: 'evaluate_failed',
      error: (e as Error).message,
      pageUrl: page.url(),
      frameName: frame.name(),
      frameUrl: frame.url()
    })
    return { url: page.url(), savedTo: jsonFile, savedHtml: '', hitCount: 0, htmlSize: 0, trace }
  }

  if (!dump) {
    t('dump null')
    await writeFinal({ stage: 'dump_null' })
    return { url: page.url(), savedTo: jsonFile, savedHtml: '', hitCount: 0, htmlSize: 0, trace }
  }

  await writeFile(
    jsonFile,
    JSON.stringify(
      {
        ts: Date.now(),
        trace,
        stage: 'ok',
        url: dump.url,
        iframeName: frame.name() || null,
        htmlSize: dump.htmlSize,
        hits: dump.hits,
        topCls: dump.topCls
      },
      null,
      2
    ),
    'utf8'
  )
  await writeFile(htmlFile, dump.html, 'utf8')
  t(`成功写盘 ${jsonFile} + ${htmlFile}`)

  return {
    url: dump.url,
    savedTo: jsonFile,
    savedHtml: htmlFile,
    hitCount: (dump.hits as unknown[]).length,
    htmlSize: dump.htmlSize,
    trace
  }
}

export function probeFilePath(): string {
  return path.join(app.getPath('userData'), 'filters-probe.json')
}
