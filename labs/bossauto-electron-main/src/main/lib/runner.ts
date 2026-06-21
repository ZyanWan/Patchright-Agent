// 主循环:扫卡 → 列表硬刷 → 逐个开详情 → DOM 直读 → LLM 软判定 → 标 seen → (可选)收藏/打招呼 → 关闭 → loadmore
// 状态机 mode: idle | running | paused | stopping
// settings.dryRun 默认 true,LLM 判收藏的候选也不点 BOSS 写按钮,只写 seen_log。
import { clipboard } from 'electron'
import type { Frame, Page } from 'patchright'
import { allZhipinPages, autoSearch } from './browser'
import { log } from './logger'
import { humanPause, sleep } from './human'
import { cardKey, companyQuickScreen, judge, titleQuickScreen } from './judge'
import { hasSeenCandidate, markSeen, seenSize } from './seen-log'
import { companyGate, hasLlmKey, llmModelName, softJudge, titleGate } from './llm'
import { collectCurrent, greetCurrent } from './actions'
import { nextBatchNo, pushBatchSummary, type BatchItem } from './chat'
import { ensureBossFilters } from './boss-filter-guard'
import { readCriteriaData } from './criteria'
import { getSettings } from './settings'
import { getProjectFilters } from './filters'

import type { CriteriaData, RunMode, RunPlanTask, RunStats } from '../../shared/ipc'
export type { RunMode, RunStats }

const state = {
  mode: 'idle' as RunMode,
  scanned: 0,
  flushed: 0,
  checked: 0,
  collected: 0,
  rejected: 0,
  errors: 0,
  lastNote: ''
}

export async function getRunStats(): Promise<RunStats> {
  return {
    mode: state.mode,
    scanned: state.scanned,
    flushed: state.flushed,
    checked: state.checked,
    collected: state.collected,
    rejected: state.rejected,
    errors: state.errors,
    seenSize: await seenSize().catch(() => 0),
    llmReady: hasLlmKey(),
    llmModel: llmModelName(),
    lastNote: state.lastNote,
    planSummary: await planSummary().catch(() => '')
  }
}

// 给界面如实展示当前 YAML 运行计划与真实安全状态,消除"界面开关与实际执行脱节"的误解。
async function planSummary(): Promise<string> {
  const plan = (await readCriteriaData()).run_plan
  if (!plan) return ''
  const settings = getSettings()
  const dry = settings.dryRun || plan.dry_run
  const tasks = (plan.tasks || []).filter((t) => t.enabled)
  const taskDesc = tasks
    .map((t) => `${t.page === 'recommend' ? '推荐' : '搜索'}/${t.action}×${t.limit}`)
    .join(', ')
  return `${dry ? '模拟(不点击)' : '真做模式'} | 批${plan.batch_size} | 按当前所在页执行对应任务 | 配置:${taskDesc || '无'}`
}

export function startRun(): void {
  if (state.mode === 'running' || state.mode === 'paused') {
    log.info('主循环已在跑,忽略 start')
    return
  }
  state.mode = 'running'
  state.scanned = 0
  state.flushed = 0
  state.checked = 0
  state.collected = 0
  state.rejected = 0
  state.errors = 0
  state.lastNote = '开始'
  log.info('主循环启动')
  // 后台 fire-and-forget;不 await
  void mainLoop().catch((e) => {
    log.error(`主循环异常退出:${(e as Error).message}`)
    state.mode = 'idle'
  })
}

export function pauseRun(): void {
  if (state.mode === 'running') {
    state.mode = 'paused'
    log.info('主循环已暂停')
  } else if (state.mode === 'paused') {
    state.mode = 'running'
    log.info('主循环已恢复')
  }
}

export function stopRun(): void {
  if (state.mode === 'idle') return
  state.mode = 'stopping'
  log.info('主循环收到停止请求')
}

// 等暂停结束,或停止退出。返回 true 表示要中止
async function gateForPause(): Promise<boolean> {
  while (state.mode === 'paused') {
    await sleep(400)
  }
  return state.mode === 'stopping'
}

// 拿可操作的 frame:搜索页用 searchFrame,推荐页用 recommendFrame
async function getListFrame(page: Page): Promise<Frame> {
  const url = page.url()
  const wantName = /web\/chat\/search/.test(url)
    ? 'searchFrame'
    : /web\/chat\/recommend/.test(url)
      ? 'recommendFrame'
      : null
  if (wantName) {
    for (let i = 0; i < 10; i++) {
      const f = page.frames().find((fr) => fr.name() === wantName && !fr.isDetached())
      if (f) return f
      await sleep(300)
    }
    throw new Error(`${wantName} 未就绪`)
  }
  return page.mainFrame()
}

type CardInfo = {
  idx: number
  index: number
  name: string
  text: string
  companyText: string
  titleText: string
  eduText: string
  key: string
  stableId: string
  contacted: boolean
}

// 扫卡:推荐/最新 tab 用 div.candidate-card-wrap(父 li 可能无 class);搜索页用 li.geek-info-card
// 关键:同时抓每张卡的稳定 ID(data-geek/data-jid/data-geekid),用于后续点击定位,
// 避免用易错位的 idx
async function scanCards(frame: Frame): Promise<CardInfo[]> {
  const raw = await frame.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      (el?.textContent || '').replace(/\s+/g, ' ').trim()
    const sels = [
      'li.geek-info-card', // 搜索页(优先,搜索页可能同时存在 wrap,避免被覆盖)
      'div.candidate-card-wrap', // 推荐/最新/精选 tab(父 li 无 class)
      'li.card-item div.candidate-card-wrap', // 推荐页旧路径
      'li.card-item', // 兜底
      '.geek-item',
      '.candidate-card'
    ]
    // 过滤隐藏模板/0尺寸元素,避免命中非真实卡(如 ssr 模板、隐藏的详情区残留)
    const visible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect()
      return r.width > 50 && r.height > 50
    }
    let nodes: Element[] = []
    for (const s of sels) {
      const ns = Array.from(document.querySelectorAll(s)).filter(visible)
      if (ns.length > 0) {
        nodes = ns
        break
      }
    }
    function getStableId(c: Element): string {
      // 推荐页:候选人级 data-geek/data-geekid(可能在内部或父 li 上)。
      // 搜索页:卡片没有候选人级 id,只有列表项链接上的 data-lid(...lookupsearchgeek.N)能区分人。
      // 绝不能用 data-jid——那是职位 id,整列表同一个,会让所有人定位到同一张卡(永远点开第一个,
      // 其余因姓名核对不上被判存疑),正是"搜索页打开的简历跟人不一致"的根因。
      const candidates = [
        c.querySelector('[data-geek]')?.getAttribute('data-geek'),
        c.querySelector('[data-geekid]')?.getAttribute('data-geekid'),
        c.getAttribute('data-geek'),
        c.getAttribute('data-geekid'),
        c.closest('[data-geek]')?.getAttribute('data-geek'),
        c.closest('[data-geekid]')?.getAttribute('data-geekid'),
        c.querySelector('[data-lid]')?.getAttribute('data-lid'),
        c.getAttribute('data-lid')
      ]
      for (const v of candidates) if (v) return v
      return ''
    }
    function timelineText(c: Element, kind: 'work' | 'edu'): string {
      const selectors =
        kind === 'work'
          ? [
              '.timeline-wrap.work-exps .timeline-item',
              '.work-exps .timeline-item',
              '.col-3 .timeline-wrap:not(.edu-exps) .timeline-item'
            ]
          : ['.timeline-wrap.edu-exps .timeline-item', '.edu-exps .timeline-item']
      const lines: string[] = []
      for (const sel of selectors) {
        c.querySelectorAll(sel).forEach((node) => {
          const t = text(node)
          if (t) lines.push(t)
        })
        if (lines.length > 0) break
      }
      return lines.join('；')
    }
    function nameText(c: Element): string {
      const nameEl =
        c.querySelector('.name-label') ||
        c.querySelector('span.name') ||
        c.querySelector('.geek-name') ||
        c.querySelector('.row.name-wrap') ||
        c.querySelector('[class*="name"]')
      const value = text(nameEl)
      if (value) return value
      const all = text(c)
      const m = /^(?:面议|\d+-\d+K)?\s*([^\s]+(?:\s+[A-Za-z][A-Za-z .]+)?)\s*(?:刚刚活跃|今日活跃|本周活跃|本月活跃|\d+日内活跃|\d+周内活跃|\d+月内活跃|近半年活跃|\d+岁)/.exec(all)
      return m?.[1] || ''
    }
    function expectText(c: Element): string {
      const row = Array.from(c.querySelectorAll('.row, .expect, [class*="expect"]')).find((node) =>
        text(node).includes('期望')
      )
      return text(row)
    }
    function companyOnlyText(work: string): string {
      // 取每段工作经历里第一个"非日期"词作为公司名。
      // 旧写法用年份正则替换,认不出 "2024.03" 这种带月份的日期,会把日期当公司名喂给公司关。
      // 日期类 token:以 19xx/20xx 年份开头,且整体只由数字+日期分隔符+年月日至今现 组成。
      // 覆盖 2024 / 2024.03 / 2024.03.01 / 2021-2024 / 2020至2023 / 2021.03-2024.06 等所有常见格式。
      const isDate = (t: string) =>
        (/^(?:19|20)\d{2}/.test(t) && /^[\d.\-/~年月日至今现在]+$/.test(t)) ||
        t === '至今' ||
        t === '现在' ||
        t === '目前' ||
        /^[-–—~、]$/.test(t)
      return work
        .split(/[；;]/)
        .map((line) => {
          const tokens = line.trim().split(/\s+/)
          let k = 0
          while (k < tokens.length && isDate(tokens[k])) k++
          return tokens[k] || ''
        })
        .filter(Boolean)
        .join('；')
    }
    // 只取岗位名:每段去开头日期 + 公司名(第一个非日期 token),剩余再去日期 = 职位名;给职位关键词硬筛用,避免公司名/日期被当黑名单命中。
    function titleOnlyText(work: string): string {
      const isDate = (t: string): boolean =>
        (/^(?:19|20)\d{2}/.test(t) && /^[\d.\-/~年月日至今现在]+$/.test(t)) ||
        t === '至今' ||
        t === '现在' ||
        t === '目前' ||
        /^[-–—~、]$/.test(t)
      return work
        .split(/[；;]/)
        .map((line) => {
          const tokens = line.trim().split(/\s+/).filter(Boolean)
          let k = 0
          while (k < tokens.length && isDate(tokens[k])) k++
          k++ // 跳过公司名(第一个非日期 token)
          return tokens.slice(k).filter((t) => !isDate(t)).join(' ')
        })
        .filter(Boolean)
        .join('；')
    }
    return nodes.map((c, i) => {
      const fullText = text(c)
      const work = timelineText(c, 'work')
      const edu = timelineText(c, 'edu')
      const expected = expectText(c)
      return {
        idx: i,
        index: i + 1,
        name: nameText(c),
        text: fullText,
        companyText: companyOnlyText(work) || work || fullText,
        // 岗位名:期望职位 + 各段工作经历去公司去日期后的职位名,给职位关键词硬筛用;抽不到→留空→不硬刷、交 LLM
        titleText: [expected, titleOnlyText(work)].filter(Boolean).join('；'),
        eduText: edu,
        stableId: getStableId(c),
        contacted: /已沟通|沟通记录|继续沟通|已打招呼|已联系|已交换|聊过/.test(fullText)
      }
    })
  })
  const enriched = raw.map((c) => ({
    ...c,
    key: cardKey(c.name, [c.eduText, c.text].filter(Boolean).join(' '))
  }))
  // 过滤无 stableId 的卡:后续 openCardByStableId 已 fail-stop,提前剔除避免白跑 LLM
  const valid = enriched.filter((c) => c.stableId)
  const dropped = enriched.length - valid.length
  if (dropped > 0) log.warn(`scanCards 丢弃 ${dropped} 张无 stableId 卡`)
  return valid
}

// 按稳定 ID 定位卡片并点击。stableId 空或失效都直接 fail,不冒险按 idx 兜底
// (idx 在点开-关闭后会错位,而且不同 selector 集合的 nth 容易跟扫描错位)
async function openCardByStableId(
  page: Page,
  frame: Frame,
  stableId: string,
  _fallbackIdx: number
): Promise<boolean> {
  // 先关掉可能浮着的旧详情
  await dismissOverlays(page, frame)
  if (!stableId) {
    log.warn('卡片无 stableId,跳过开详情')
    return false
  }

  let card = frame.locator(
    `[data-geek="${stableId}"]:visible, [data-geekid="${stableId}"]:visible, [data-lid="${stableId}"]:visible`
  )
  const cnt = await card.count().catch(() => 0)
  if (cnt === 0) {
    log.warn(`卡片 stableId 失效(列表可能已刷新):${stableId}`)
    return false
  } else if (cnt > 1) {
    card = card.first()
  }

  // 记录点击前的"详情区文本长度",以增长量判断是否打开
  const before = await measureDetailLen(page, frame)
  try {
    await card.scrollIntoViewIfNeeded({ timeout: 2000 })
    // 优先点姓名(避开右侧"打招呼"按钮)
    const name = card.locator('.name-label, span.name, .geek-name').first()
    if ((await name.count().catch(() => 0)) > 0) {
      await name.click({ timeout: 3000 })
    } else {
      // 搜索页:命中的是卡片"打开简历"链接(data-lid),直接点它本身打开对应候选人
      await card.click({ timeout: 3000 })
    }
  } catch (e) {
    log.warn(`卡片点击失败:${(e as Error).message}`)
    return false
  }
  // 等详情:文本增长 + 多 selector 双保险
  for (let i = 0; i < 20; i++) {
    await sleep(250)
    const after = await measureDetailLen(page, frame)
    if (after > before + 800) return true
    const sel = await page
      .evaluate(() => {
        return !!document.querySelector(
          '.resume-detail-wrap, .base-info-content, .geek-detail, .resume-detail, .candidate-detail, .resume-card, [class*="resume-detail"], [class*="candidate-detail"], [class*="geek-info-page"]'
        )
      })
      .catch(() => false)
    if (sel) return true
    // 推荐页详情可能在 frame 里渲染,也检测 frame
    const selF = await frame
      .evaluate(() => {
        return !!document.querySelector(
          '.candidate-detail, .geek-detail, .resume-detail, [class*="resume-detail"], [class*="candidate-detail"], [class*="geek-info-page"]'
        )
      })
      .catch(() => false)
    if (selF) return true
  }
  return false
}

// 估算"详情区"文本长度:取 page 顶层 document + 当前 frame 总 innerText 长度
async function measureDetailLen(page: Page, frame: Frame): Promise<number> {
  const a = await page
    .evaluate(() => (document.body ? document.body.innerText.length : 0))
    .catch(() => 0)
  const b = await frame
    .evaluate(() => (document.body ? document.body.innerText.length : 0))
    .catch(() => 0)
  return (a as number) + (b as number)
}

// 关掉浮层/详情:只按 ESC,不再点 close-btn / mask,避免列表页误点 close 元素
// (历史 close-btn / mask selector 模糊匹配,会在列表页命中 banner/广告/提示气泡的 x)
async function dismissOverlays(page: Page, _frame: Frame): Promise<void> {
  // 连按 2 次 ESC(BOSS 有时有"确认离开"二级提示)
  for (let k = 0; k < 2; k++) {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(120)
  }
}

// 读详情正文:简历文字能被鼠标选中复制 = 是真实 DOM 文本。
// 遍历所有 frame,用 textContent + 全选 selection 抓文本,取最长(简历主体)。
function cleanDetailText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function mergeTextChunks(chunks: string[]): string {
  const merged: string[] = []
  for (const chunk of chunks) {
    const lines = cleanDetailText(chunk)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) continue
    let overlap = 0
    const max = Math.min(merged.length, lines.length, 30)
    for (let n = max; n > 0; n--) {
      if (merged.slice(-n).join('\n') === lines.slice(0, n).join('\n')) {
        overlap = n
        break
      }
    }
    merged.push(...lines.slice(overlap))
  }
  return merged.join('\n')
}

async function getResumeViewportBox(page: Page, frame: Frame): Promise<{
  x: number
  y: number
  width: number
  height: number
} | null> {
  // 先拿正文 iframe 的位置:既用于"容器须罩住 iframe"的筛选判据,也作兜底。
  const handle = await frame.frameElement().catch(() => null)
  const ifb = handle ? await handle.boundingBox().catch(() => null) : null
  await handle?.dispose().catch(() => {})
  // 框选区域 = 左侧正文滚动容器 .resume-detail-wrap 的可见 box:它是固定高度的正文视口
  // (实测约 778×725,内嵌 c-resume 正文 iframe),滚动时容器本身不动、只是内部 iframe 上移,
  // 所以每屏都框同一块可见区、配合滚动即可逐屏读全。用"容器须横向罩住正文 iframe"判据筛选,
  // 排除右侧约 350 宽的操作侧栏 .resume-item-detail(它在 iframe 右边、罩不住,直接被剔除)。
  const parent = frame.parentFrame()
  if (parent && ifb) {
    for (const sel of ['.resume-detail-wrap', '[class*="resume-detail"]']) {
      const h = await parent.$(sel).catch(() => null)
      if (!h) continue
      const b = await h.boundingBox().catch(() => null)
      await h.dispose().catch(() => {})
      if (b && b.height > 80 && b.x <= ifb.x + 4 && b.x + b.width >= ifb.x + ifb.width - 4) return b
    }
  }
  // 兜底:正文容器 class 都找不到时,用 c-resume iframe 自身 box 并裁到视口可见区。
  // (iframe 高度是整篇简历、会随滚动上移,只能作 .resume-detail-wrap 缺失时的退路。)
  if (!ifb) return null
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null)
  if (!viewport) return ifb
  const x = Math.max(0, ifb.x)
  const y = Math.max(0, ifb.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(ifb.x + ifb.width, viewport.w) - x),
    height: Math.max(0, Math.min(ifb.y + ifb.height, viewport.h) - y)
  }
}

async function readCanvasClipboardText(page: Page): Promise<string> {
  const frame = page.frames().find((f) => /\/web\/frame\/c-resume\//.test(f.url()))
  if (!frame) return ''
  const parent = frame.parentFrame()
  const scrollInfo = parent
    ? ((await parent
        .evaluate(() => {
          const el = (['.resume-detail-wrap', '[class*="resume-detail"]']
            .map((s) => document.querySelector(s))
            .find((e) => e && (e as HTMLElement).offsetParent !== null) as HTMLElement | null)
          if (!el) return null
          const original = el.scrollTop
          const max = Math.max(0, el.scrollHeight - el.clientHeight)
          const step = Math.max(240, el.clientHeight - 90)
          el.scrollTop = 0
          return { original, max, step }
        })
        .catch(() => null)) as { original: number; max: number; step: number } | null)
    : null
  // 从顶部连续复制,覆盖"工作经历 + 项目经历"两块即停(自适应,不滚到底):
  // 个人基础信息/优势自述都在最顶,复制后交给 sliceWorkAndProject 按区块裁掉,
  // 只把工作经历+项目经历送判定。见到"项目经历"再多抓一屏把它拉全;
  // 最多 MAX_SCREENS 屏兜底,避免超长简历无限滚回拖慢详情读取。
  const MAX_SCREENS = 4
  const step = scrollInfo?.step ?? 0
  const maxScrollTop = scrollInfo?.max ?? 0

  const previousClipboard = clipboard.readText()
  const sentinel = `__BSA_COPY_${Date.now()}__`
  const chunks: string[] = []
  try {
    await page.bringToFront().catch(() => {})
    let pos = 0
    let sawProject = false
    for (let screen = 0; screen < MAX_SCREENS; screen++) {
      if (parent && scrollInfo) {
        await parent
          .evaluate((top) => {
            const el = (['.resume-detail-wrap', '[class*="resume-detail"]']
            .map((s) => document.querySelector(s))
            .find((e) => e && (e as HTMLElement).offsetParent !== null) as HTMLElement | null)
            if (el) el.scrollTop = top
          }, pos)
          .catch(() => {})
        await sleep(180)
      }
      const box = await getResumeViewportBox(page, frame)
      if (box && box.width >= 120 && box.height >= 120) {
        clipboard.writeText(sentinel)
        const startX = box.x + 14
        const startY = box.y + 14
        const endX = box.x + box.width - 18
        const endY = box.y + box.height - 18
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY, { steps: 36 })
        await page.mouse.up()
        await sleep(120)
        await page.keyboard.down('Control')
        await page.keyboard.press('KeyC')
        await page.keyboard.up('Control')
        await sleep(500)
        const copied = cleanDetailText(clipboard.readText())
        if (copied && copied !== sentinel && copied.length > 20) chunks.push(copied)
      }
      // 抓到"项目经历"后再多抓一屏把它拉全即停;短简历无此字则靠到底/上限停。
      if (/项目经[历验]/.test(mergeTextChunks(chunks))) {
        if (sawProject) break
        sawProject = true
      }
      if (!parent || !scrollInfo || pos >= maxScrollTop) break
      pos = Math.min(maxScrollTop, pos + step)
    }
  } finally {
    if (parent && scrollInfo) {
      await parent
        .evaluate((top) => {
          const el = (['.resume-detail-wrap', '[class*="resume-detail"]']
            .map((s) => document.querySelector(s))
            .find((e) => e && (e as HTMLElement).offsetParent !== null) as HTMLElement | null)
          if (el) el.scrollTop = top
        }, scrollInfo.original)
        .catch(() => {})
    }
    clipboard.writeText(previousClipboard)
  }

  const text = mergeTextChunks(chunks)
  if (text) log.info(`[detail-canvas-copy]读到 ${text.length} 字,分段 ${chunks.length}`)
  return text
}

async function readDetailText(page: Page): Promise<string> {
  // BOSS 简历是 wasm 加密 canvas 渲染:DOM 直读、canvas fillText hook、getSelection 都拿不到,
  // 唯一可行是"框选一屏 + Ctrl+C 读剪贴板"。只保留这条路,详情读取统一走它。
  return readCanvasClipboardText(page)
}

// 从详情正文切出"工作经历 / 项目经验"两块,丢掉最顶的个人基础信息/求职意向/优势自述。
// canvas 复制文本无 DOM 锚点,只能按区块标题关键词切行;切不出工作经历就整体回退为
// 工作经历(维持旧行为,绝不丢内容)。
function sliceWorkAndProject(text: string): {
  workExperience: string
  projectExperience: string
} {
  const lines = text.split('\n')
  const projRe = /项目经验|项目经历/
  const endRe = /教育经历|教育背景|培训经历|资格证书|语言能力|荣誉奖项|个人荣誉/
  const workIdx = lines.findIndex((l) => /工作经历/.test(l))
  if (workIdx < 0) return { workExperience: cleanDetailText(text), projectExperience: '' }
  const projIdx = lines.findIndex((l, i) => i > workIdx && projRe.test(l))
  if (projIdx < 0) {
    const endIdx = lines.findIndex((l, i) => i > workIdx && endRe.test(l))
    const work = lines.slice(workIdx, endIdx < 0 ? lines.length : endIdx)
    return { workExperience: cleanDetailText(work.join('\n')), projectExperience: '' }
  }
  const work = lines.slice(workIdx, projIdx)
  const projEndIdx = lines.findIndex((l, i) => i > projIdx && endRe.test(l))
  const proj = lines.slice(projIdx, projEndIdx < 0 ? lines.length : projEndIdx)
  return {
    workExperience: cleanDetailText(work.join('\n')),
    projectExperience: cleanDetailText(proj.join('\n'))
  }
}

let detailDumpSeq = 0
// 把实际喂给 LLM 的正文存盘到 userData/detail-dumps/<序号>-<姓名>-<时间戳>.txt,
// 便于事后核对详情是否"搞错人"(串人)或 LLM 编造。含原始详情全文 + 切分后三段。
async function dumpDetailText(
  c: CardInfo,
  rawDetail: string,
  sections: { advantage: string; workExperience: string; projectExperience: string }
): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const pathMod = await import('node:path')
    const { app } = await import('electron')
    const dir = pathMod.join(app.getPath('userData'), 'detail-dumps')
    await mkdir(dir, { recursive: true })
    detailDumpSeq++
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const safeName = (c.name || '无名').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20)
    const file = pathMod.join(
      dir,
      `${String(detailDumpSeq).padStart(4, '0')}-${safeName}-${ts}.txt`
    )
    const body = [
      `姓名: ${c.name || '(未知)'}`,
      `key: ${c.key}`,
      `姓名是否在正文: ${c.name ? rawDetail.includes(c.name) : '无姓名可核'}`,
      '',
      '=== 原始详情正文(框选复制) ===',
      rawDetail,
      '',
      '=== 优势/个人简介(列表卡) ===',
      sections.advantage,
      '',
      '=== 工作经历(送判定) ===',
      sections.workExperience,
      '',
      '=== 项目经验(送判定) ===',
      sections.projectExperience
    ].join('\n')
    await writeFile(file, body, 'utf8')
    log.info(`[正文留存]${c.name || c.key} → ${file}`)
  } catch (e) {
    log.warn(`[正文留存]失败:${(e as Error).message}`)
  }
}

async function closeDetail(page: Page, frame: Frame): Promise<void> {
  await dismissOverlays(page, frame)
}

// 列表 loadmore:先滚到底(触发滚动加载/下一批渲染),再点 .loadmore 兜底,等 card 数稳定
async function loadMore(frame: Frame): Promise<number> {
  const before = await countCards(frame)
  const res = await frame
    .evaluate(() => {
      // 滚到底:覆盖"必须滚动到底才加载/才渲染下一批"的列表,没有 .loadmore 按钮也能继续往下
      window.scrollTo(0, document.body.scrollHeight)
      const cards = document.querySelectorAll(
        'li.geek-info-card, div.candidate-card-wrap, li.card-item, .geek-item, .candidate-card'
      )
      const lastCard = cards[cards.length - 1] as HTMLElement | undefined
      if (lastCard) lastCard.scrollIntoView({ block: 'end' })
      // 有"加载更多"按钮再点一下兜底
      const btn = document.querySelector('.loadmore') as HTMLElement | null
      if (btn) {
        btn.scrollIntoView({ block: 'center' })
        btn.click()
      }
      return { ok: true }
    })
    .catch(() => ({ err: 'eval_failed' } as { err: string }))
  if ('err' in res) {
    state.lastNote = `loadmore 失败:${res.err}`
    return 0
  }
  let last = -1
  let stable = 0
  let final = before
  for (let i = 0; i < 12; i++) {
    await sleep(700)
    const cur = await countCards(frame)
    if (cur > 0) {
      if (cur === last) {
        stable++
        // 卡数连续稳定即认为本次加载结束(无论有无新增)就立刻返回,避免到底时空等满轮
        if (stable >= 3) {
          final = cur
          break
        }
      } else {
        stable = 0
      }
      last = cur
      final = cur
    }
  }
  return final - before
}

async function countCards(frame: Frame): Promise<number> {
  return await frame
    .evaluate(() => {
      const sels = [
        'li.geek-info-card',
        'div.candidate-card-wrap',
        'li.card-item',
        '.geek-item',
        '.candidate-card'
      ]
      const visCount = (s: string) =>
        Array.from(document.querySelectorAll(s)).filter((el) => {
          const r = (el as HTMLElement).getBoundingClientRect()
          return r.width > 50 && r.height > 50
        }).length
      for (const s of sels) {
        const n = visCount(s)
        if (n > 0) return n
      }
      return 0
    })
    .catch(() => 0)
}

function taskName(task: RunPlanTask): string {
  if (task.page === 'recommend') return `推荐页/${normalizeRecommendTab(task.tab)}`
  return `搜索页/${task.keyword || '当前关键词'}`
}

function pickPageForTask(task: RunPlanTask): Page | null {
  const pages = allZhipinPages()
  const want = task.page === 'recommend' ? /web\/chat\/recommend/ : /web\/chat\/search/
  // 只在匹配到对应页时执行;找不到就返回 null,由 runTask 抛错并跳过该任务,
  // 避免"配置说推荐却跑在搜索页"这类页面与配置不一致的静默错跑。
  return pages.find((p) => want.test(p.url())) || null
}

function normalizeRecommendTab(tab?: string): string {
  const value = (tab || '').trim().toLowerCase()
  if (!value || value === 'recommend' || value === 'rec' || value === 'tuijian') return '推荐'
  if (value === 'latest' || value === 'new' || value === 'zuixin') return '最新'
  if (value === 'featured' || value === 'select' || value === 'jingxuan') return '精选'
  return tab || '推荐'
}

async function switchRecommendTab(frame: Frame, tab?: string): Promise<void> {
  const wanted = normalizeRecommendTab(tab)
  // 先用 li.tab-item 精确选择器(BOSS 实际结构),失败再 fallback 到任意元素文本
  const selectors = ['li.tab-item', 'div,span,a']
  for (const sel of selectors) {
    const candidates = frame.locator(sel, { hasText: wanted })
    const count = await candidates.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const node = candidates.nth(i)
      const text = await node.innerText().catch(() => '')
      if (text.replace(/\s+/g, '') !== wanted) continue
      const box = await node.boundingBox().catch(() => null)
      if (!box || box.y > 240) continue
      await node.click({ timeout: 3000 }).catch(() => {})
      await sleep(1200)
      log.info(`[任务]已切到 ${wanted} (sel=${sel})`)
      return
    }
  }
  log.warn(`[任务]未找到 tab:${wanted},继续用当前 tab`)
}

async function prepareTask(
  page: Page,
  task: RunPlanTask,
  criteria: CriteriaData,
  keyword?: string
): Promise<Frame | null> {
  if (criteria.run_plan?.confirm_filters) {
    // 临时(根治前):搜索页筛选自动核对会因页面结构变动(学历"自定义"标签重复、薪资容器不可见)崩溃,
    // 这里先跳过搜索页的启动前核对,改由人工设置筛选;推荐页不受影响。根治后删除此 search 例外即可。
    if (task.page === 'search') {
      log.warn('[筛选校验]搜索页已临时跳过启动前自动核对,请先手动确认筛选项再运行')
    } else {
      const filterGuard = await ensureBossFilters(page).catch((e) => ({
        ok: false,
        message: (e as Error).message
      }))
      if (!filterGuard.ok) {
        state.errors++
        state.lastNote = filterGuard.message
        log.warn(`筛选条件未通过,暂停:${filterGuard.message}`)
        state.mode = 'paused'
        return null
      }
    }
  }
  if (task.page === 'search' && keyword) {
    await autoSearch(keyword, page).catch((e) => log.warn(`自动搜索失败:${(e as Error).message}`))
    await sleep(1500)
  }
  const frame = await getListFrame(page)
  if (task.page === 'recommend' && task.tab) await switchRecommendTab(frame, task.tab)
  await dismissOverlays(page, frame).catch(() => {})
  return frame
}

// 是否处于"模拟"(只判定不点击):界面闸门或 YAML 任一开启即为模拟。
// actOnPass 与 recordSeen 必须用同一判断,避免"通过的不记、拒绝的却记"的不一致;
// 模拟下一律不写 seen,也避免模拟留痕导致后续真跑把这些人当已处理而跳过、永不打招呼。
function isDryRun(criteria: CriteriaData): boolean {
  return getSettings().dryRun || !!criteria.run_plan?.dry_run
}

// 判定策略(二选一,无"待定"):直接采用 LLM 的 d。
// 原则"拿不准就过":模型只在明确不对口/零业绩/明确低于达标线/满一年没出成绩时判"不要",
// 其余(含是否达标拿不准、信息不全)一律"收藏"放过交人工,故不再用分数把"收藏"往保守降级。

async function actOnPass(
  page: Page,
  task: RunPlanTask,
  criteria: CriteriaData,
  c: CardInfo,
  score: number,
  reason: string
): Promise<void> {
  const settings = getSettings()
  // 安全闸门:界面"模拟模式"或 YAML dry_run 任一开启,都只记录不点击(取更保守者)。
  if (isDryRun(criteria)) {
    log.info(`[模拟模式]通过但不点击:${c.name || c.key}`)
    return
  }
  if (task.action === 'none') {
    await markSeen(c.key, '收藏', `${score}分 ${reason}`)
    log.info(`[不操作]通过但不点击:${c.name || c.key}`)
    return
  }
  if (task.action === 'collect') {
    // 界面"自动收藏"是额外闸门:关闭时即使非模拟也不点,只记录
    if (!settings.doCollect) {
      await markSeen(c.key, '收藏', `${score}分 ${reason}(收藏开关关闭,未点)`)
      log.info(`[收藏关闭]通过但未点收藏:${c.name || c.key}`)
      return
    }
    const ok = await collectCurrent(page).catch(() => false)
    await markSeen(c.key, ok ? '收藏' : 'check', `${score}分 ${reason}`)
    return
  }
  if (task.action === 'greet') {
    // 界面"自动打招呼"是额外闸门:关闭时即使非模拟也不打,只记录
    if (!settings.doGreet) {
      await markSeen(c.key, '收藏', `${score}分 ${reason}(打招呼开关关闭,未打)`)
      log.info(`[打招呼关闭]通过但未打招呼:${c.name || c.key}`)
      return
    }
    const ok = await greetCurrent(page).catch(() => false)
    await markSeen(c.key, ok ? '打招呼' : '收藏', `${score}分 ${reason}`)
    return
  }
  await markSeen(c.key, '收藏', `${score}分 ${reason}`)
}

async function recordSeen(
  criteria: CriteriaData,
  key: string,
  decision: string,
  reason: string
): Promise<void> {
  if (isDryRun(criteria)) return
  await markSeen(key, decision, reason)
}

// 漏斗:去重 → 硬筛 → 公司关(全部硬筛过的,5 人一片并发) → 职位关(只送公司过的) → 逐个开详情。
// remaining = 本轮还能开几个详情(受 task.limit 约束);开够就停,后续 toOpen 的人不再开详情。
async function processFunnel(
  page: Page,
  frame: Frame,
  task: RunPlanTask,
  criteria: CriteriaData,
  cards: CardInfo[],
  remaining: number
): Promise<{ opened: number; batchItems: BatchItem[] }> {
  const batchItems: BatchItem[] = []
  const hardPassed: CardInfo[] = []
  let opened = 0

  for (const c of cards) {
    if (await hasSeenCandidate(c.key, c.name)) {
      log.info(`跳过已记录:${c.name || c.key}`)
      continue
    }
    if (c.contacted) {
      await recordSeen(criteria, c.key, 'skip', '列表显示已沟通/继续沟通')
      log.info(`跳过已沟通:${c.name || c.key}`)
      continue
    }
    const j = judge(c.text, criteria.hard, c.eduText)
    if (j.d === '刷') {
      await recordSeen(criteria, c.key, '刷', j.r)
      state.flushed++
      log.info(`硬刷:${c.name || c.key} ${j.r}`)
    } else {
      hardPassed.push(c)
    }
  }

  // 公司确定性快筛(名单来自 criteria,代码只匹配):命中禁止→直接刷;命中允许→直接放过;其余才送 LLM。
  const toCompanyGate: CardInfo[] = []
  const companyPassed: CardInfo[] = []
  for (const c of hardPassed) {
    const { screen, hit, current } = companyQuickScreen(
      c.companyText || c.text,
      criteria.hard.allow_companies,
      criteria.hard.forbid_companies_current_only,
      criteria.hard.forbid_company_types
    )
    if (screen === 'forbid') {
      await recordSeen(criteria, c.key, '不要', `公司命中禁止名单(快筛):公司"${current}"命中"${hit}"`)
      state.flushed++
      log.info(`公司禁止(快筛):${c.name || c.key} 公司"${current}"命中"${hit}"`)
    } else if (screen === 'allow') {
      companyPassed.push(c)
      log.info(`公司允许(快筛,跳过 LLM):${c.name || c.key} 公司"${current}"命中"${hit}"`)
    } else {
      toCompanyGate.push(c)
    }
  }

  const companyInputs = toCompanyGate.map((c) => ({
    index: c.index,
    name: c.name,
    text: c.companyText || c.text
  }))
  const companyResults = new Map(
    (await companyGate(companyInputs, criteria.run_plan?.gate_chunk_size).catch((e) => {
      state.errors++
      log.warn(`公司批量判定失败:${(e as Error).message}`)
      return companyInputs.map((c) => ({ ...c, v: 'maybe' as const, r: '公司判定失败,保守继续' }))
    })).map((r) => [r.index, r])
  )
  for (const c of toCompanyGate) {
    const r = companyResults.get(c.index)
    const cur = ((c.companyText || '').split(/[；;]/)[0] || '').trim()
    if (r?.v === 'reject') {
      await recordSeen(criteria, c.key, '不要', `公司不过(LLM):公司"${cur}" ${r.r}`)
      state.flushed++
      log.info(`公司不过:${c.name || c.key} 公司"${cur}" ${r.r}`)
    } else {
      log.info(`公司过(LLM):${c.name || c.key} 公司"${cur}" ${r?.r || ''}`)
      companyPassed.push(c)
    }
  }

  // 职位关·代码预筛(LLM 之前):按岗位名硬刷黑名单;白名单命中=豁免硬刷。
  // 没被硬刷的(含豁免的)一律再过一遍 LLM 职位关,不直接放进详情。词表来自 criteria。
  const titleAllow = criteria.job_content_preference?.title_allow_keywords || []
  const titleBlock = criteria.job_content_preference?.title_block_keywords || []
  const toTitleGate: CardInfo[] = []
  for (const c of companyPassed) {
    const ts = titleQuickScreen(c.titleText, titleAllow, titleBlock)
    if (ts.screen === 'block') {
      await recordSeen(criteria, c.key, '不要', `职位不过(黑名单快筛):命中"${ts.hit}"`)
      state.flushed++
      log.info(`职位不过(快筛):${c.name || c.key} 命中"${ts.hit}"`)
    } else {
      if (ts.screen === 'allow') {
        log.info(`白名单豁免硬刷,仍过 LLM 职位关:${c.name || c.key} 命中"${ts.hit}"`)
      }
      toTitleGate.push(c)
    }
  }
  // 没被硬刷的(含白名单豁免的)全部再过 LLM 职位关
  const titleInputs = toTitleGate.map((c) => ({
    index: c.index,
    name: c.name,
    // 职位关只判"相关性":把职位名(期望+工作经历)、技能标签、个人优势一起喂。
    // 用整卡比单独 titleText 信息更全(技能标签/优势是强相关信号);公司理由由 prompt 禁止。
    text: c.text
  }))
  const titleResults = new Map(
    (await titleGate(titleInputs, criteria.run_plan?.gate_chunk_size).catch((e) => {
      state.errors++
      log.warn(`职位批量判定失败:${(e as Error).message}`)
      return titleInputs.map((c) => ({ ...c, v: 'maybe' as const, r: '职位判定失败,保守打开' }))
    })).map((r) => [r.index, r])
  )
  // 按 toTitleGate 原顺序(companyPassed 原序的子集)决定开详情队列,顺序不被快筛打乱。
  const toOpen: CardInfo[] = []
  for (const c of toTitleGate) {
    const r = titleResults.get(c.index)
    if (r?.v === 'reject') {
      await recordSeen(criteria, c.key, '不要', `职位不过:${r.r}`)
      state.flushed++
      log.info(`职位不过:${c.name || c.key} ${r.r}`)
    } else {
      toOpen.push(c)
    }
  }

  for (const c of toOpen) {
    if (opened >= remaining) break // 详情(开卡)上限,受 task.limit 约束
    if (await gateForPause()) break
    const openedOk = await openCardByStableId(page, frame, c.stableId, c.idx).catch(() => false)
    if (!openedOk) {
      log.warn(`详情未打开:${c.name || c.key}`)
      state.errors++
      continue
    }
    opened++
    await humanPause(800, 300)
    let detail = await readDetailText(page)
    // 姓名核对:正文应含候选人姓名;不含可能是框错/详情没切换干净 → 重读一次。
    let nameSuspect = false
    if (c.name && detail && !detail.includes(c.name)) {
      log.warn(`[姓名核对]${c.name} 不在详情正文,重读一次`)
      const retry = await readDetailText(page)
      if (retry.includes(c.name)) {
        detail = retry
      } else {
        if (retry.length > detail.length) detail = retry
        nameSuspect = true
        log.warn(`[存疑]${c.name || c.key} 重读后仍不含姓名,正文疑似搞错人,交人工不自动处理`)
      }
    }
    log.info(`[详情]${c.name || c.key} 读到 ${detail.length} 字`)
    if (detail.length <= 30) {
      state.errors++
      await recordSeen(criteria, c.key, 'check', '详情读取失败')
      await closeDetail(page, frame)
      continue
    }
    // 姓名核对不过(疑似框错人):不基于可疑详情自动判定/打招呼,留痕正文交人工复核。
    if (nameSuspect) {
      await dumpDetailText(c, detail, { advantage: c.text, workExperience: '', projectExperience: '' })
      await recordSeen(criteria, c.key, 'check', '姓名核对不过,疑似详情搞错人,交人工')
      batchItems.push({ key: c.key, name: c.name, decision: '跳过', score: 0, reason: '姓名核对不过,交人工' })
      state.checked++
      await closeDetail(page, frame)
      continue
    }
    // 详情复制从顶部覆盖到项目经历,这里按区块切出工作经历/项目经验,丢掉最顶的个人基础信息。
    const { workExperience, projectExperience } = sliceWorkAndProject(detail)
    // 留存实际喂给 LLM 的正文(原始详情 + 切分三段),便于核对"搞错人"/LLM 编造。
    await dumpDetailText(c, detail, { advantage: c.text, workExperience, projectExperience })
    const soft = await softJudge({
      // 列表卡整体文本(含"优势/个人简介")。用整卡而非按年份硬切,避免优势里含年份时被截断;
      // 精确只取优势 section 待抓取端 DOM 分段后提供。
      advantage: c.text,
      workExperience,
      projectExperience
    })
    const decision = soft.d
    if (decision === '收藏') {
      state.collected++
      await actOnPass(page, task, criteria, c, soft.score, soft.r)
      batchItems.push({ key: c.key, name: c.name, decision: '收藏', score: soft.score, reason: soft.r })
      log.info(`★通过:${c.name || c.key} ${soft.score}分 ${soft.r}`)
    } else if (decision === '不要') {
      state.rejected++
      await recordSeen(criteria, c.key, '不要', `${soft.score}分 ${soft.r}`)
      batchItems.push({ key: c.key, name: c.name, decision: '不要', score: soft.score, reason: soft.r })
      log.info(`不要:${c.name || c.key} ${soft.score}分 ${soft.r}`)
    } else {
      state.checked++
      await recordSeen(criteria, c.key, 'check', `${soft.score}分 ${soft.r}`)
      batchItems.push({ key: c.key, name: c.name, decision: '跳过', score: soft.score, reason: soft.r })
      log.info(`跳过(未判定):${c.name || c.key} ${soft.r}`)
    }
    await closeDetail(page, frame)
    await humanPause(800, 300)
  }

  return { opened, batchItems }
}

// 跑一轮漏斗:对当前 frame 列表,全量去重/硬筛/公司关/职位关,开详情到 target 个。
async function runFunnelLoop(
  page: Page,
  frame: Frame,
  task: RunPlanTask,
  criteria: CriteriaData,
  target: number
): Promise<void> {
  // 本轮已走过漏斗的人(按 cardKey)。dry_run 不写 seen,靠它避免每轮重复扫到同一批人反复处理。
  const processedKeys = new Set<string>()
  let opened = 0
  let emptyRounds = 0
  const started = Date.now()
  log.info(`[任务]开始 ${taskName(task)} 开详情上限=${target}`)

  while (opened < target && (state.mode === 'running' || state.mode === 'paused')) {
    if (await gateForPause()) return
    // 分界:页面出现"暂无合适/符合牛人,为你/更多推荐"可见文案即为本任务终点,之后是非精准区。
    // 所有 page/tab 通用(推荐/最新/搜索):先查已知容器,再兜底全页扫短文案元素,覆盖各 tab 不同 selector。
    const cutoffY = await frame
      .evaluate(() => {
        const hitY = (node: Element): number | null => {
          const el = node as HTMLElement
          if (!el.offsetParent) return null
          const r = el.getBoundingClientRect()
          if (r.height <= 0 || r.width <= 0) return null
          const t = (el.textContent || '').replace(/\s+/g, '')
          // 文案放宽:覆盖"暂无合适牛人,为你推荐""暂无符合牛人,更多推荐"等变体
          const noFit = t.includes('暂无合适') || t.includes('暂无符合')
          const rec = t.includes('为你推荐') || t.includes('更多推荐')
          if (!noFit || !rec) return null
          return r.top + window.scrollY
        }
        // 1) 已知容器
        for (const node of Array.from(document.querySelectorAll('.recommend-mome-ui, .mome-main-ui'))) {
          const y = hitY(node)
          if (y !== null) return y
        }
        // 2) 兜底:全页找含该文案的短元素(排除整页大容器),取最靠上的
        let best = Infinity
        for (const node of Array.from(document.querySelectorAll('div, p, section, span'))) {
          const raw = (node.textContent || '').replace(/\s+/g, '')
          if (raw.length > 40) continue
          const y = hitY(node)
          if (y !== null && y < best) best = y
        }
        return best
      })
      .catch(() => Infinity)
    // 每轮全读当前 DOM 能扫到的所有人,只处理还没处理过的
    const all = await scanCards(frame)
    // 把 mome 分界之后的卡过滤掉:那些是"更多推荐"非精准区,本任务不处理。
    // 用 DOM 顺序 idx 而非 stableId 匹配,避免无 stableId 卡被遗漏。
    let precise = all
    if (Number.isFinite(cutoffY)) {
      const yByIdx = await frame
        .evaluate(() => {
          const sels = ['li.geek-info-card', 'div.candidate-card-wrap', 'li.card-item', '.geek-item', '.candidate-card']
          const visible = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect()
            return r.width > 50 && r.height > 50
          }
          let nodes: Element[] = []
          for (const s of sels) {
            const list = Array.from(document.querySelectorAll(s)).filter(visible)
            if (list.length > 0) {
              nodes = list
              break
            }
          }
          return nodes.map((c) => {
            const r = (c as HTMLElement).getBoundingClientRect()
            return r.top + window.scrollY
          })
        })
        .catch(() => [] as number[])
      precise = all.filter((c) => {
        const y = yByIdx[c.idx]
        // 无 y(节点对不上)按保守策略丢弃:分界存在时宁可不处理也不误打非精准。
        return typeof y === 'number' && y < cutoffY
      })
      const dropped = all.length - precise.length
      if (dropped > 0) log.info(`[任务]分界过滤:丢弃${dropped}个非精准卡`)
    }
    const fresh = precise.filter((c) => !processedKeys.has(c.key))
    if (fresh.length === 0) {
      // 已无精准 fresh:分界出现就结束本任务,否则继续 loadMore
      if (Number.isFinite(cutoffY)) {
        log.info(`[任务]精准推荐结束(出现"暂无合适牛人,为你推荐"),结束本任务`)
        break
      }
      const added = await loadMore(frame)
      log.info(`[任务]loadmore 增加 ${added}`)
      // 滚动/虚拟列表下卡片数可能不变但内容已换,故不靠"数量差"判定到底;
      // 改为:本轮没扫到新人就累计空轮,连续 3 轮都没有任何新人才视为真到底。
      emptyRounds++
      if (emptyRounds >= 3) break
      await sleep(added > 0 ? 1200 : 2500)
      continue
    }
    // 本轮扫到新人 → 重置空轮计数,持续往下滚到连续多轮无新人为止
    emptyRounds = 0
    fresh.forEach((c) => processedKeys.add(c.key))
    const res = await processFunnel(page, frame, task, criteria, fresh, target - opened)
    opened += res.opened
    state.scanned = processedKeys.size
    if (res.batchItems.length > 0) {
      pushBatchSummary({
        batchNo: nextBatchNo(),
        total: fresh.length,
        flushed: fresh.length - res.opened,
        items: res.batchItems
      })
    }
    const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
    state.lastNote = `${taskName(task)} 开详情${opened}/${target}, 已扫${processedKeys.size}, ${(
      opened / seconds
    ).toFixed(2)}详情/秒`
    log.info(`[速度]${state.lastNote}`)
  }
  log.info(`[任务]完成 ${taskName(task)} 开详情${opened}, 已扫${processedKeys.size}`)
}

async function runTask(task: RunPlanTask, criteria: CriteriaData, pageArg?: Page | null): Promise<void> {
  // mainLoop 已按"当前前台页"选定 page 时直接用,避免多开页时重新 find 跑到错的那一页
  const page = pageArg ?? pickPageForTask(task)
  if (!page) {
    throw new Error(
      `未找到${task.page === 'recommend' ? '推荐' : '搜索'}页,跳过该任务(请先在浏览器打开对应页)`
    )
  }
  const target = Math.max(0, Math.floor(Number(task.limit) || 0))
  if (task.page === 'search') {
    // 多搜索词:任务自带 keyword 优先;否则用当前项目的搜索词列表。每个词搜一轮、各跑 target 个详情。
    const fromProject = (await getProjectFilters()).searchKeywords.filter(Boolean)
    const keywords = task.keyword ? [task.keyword] : fromProject
    if (keywords.length === 0) {
      // 没有搜索词:直接用当前列表跑(不搜)
      const frame = await prepareTask(page, task, criteria)
      if (frame) await runFunnelLoop(page, frame, task, criteria, target)
      return
    }
    for (const kw of keywords) {
      if (await gateForPause()) return
      log.info(`[任务]搜索词:${kw}`)
      const frame = await prepareTask(page, task, criteria, kw)
      if (frame) await runFunnelLoop(page, frame, task, criteria, target)
    }
    return
  }
  // 推荐页:无搜索词,直接跑
  const frame = await prepareTask(page, task, criteria)
  if (!frame) return
  await runFunnelLoop(page, frame, task, criteria, target)
}

// 识别当前所在的列表页(推荐/搜索):有多个候选时优先取前台可见的;只有一个就直接用。
async function detectActivePage(): Promise<{ page: Page; kind: 'recommend' | 'search' } | null> {
  const cls = (u: string): 'recommend' | 'search' | null =>
    /web\/chat\/recommend/.test(u) ? 'recommend' : /web\/chat\/search/.test(u) ? 'search' : null
  const cands = allZhipinPages()
    .map((p) => ({ p, k: cls(p.url()) }))
    .filter((x): x is { p: Page; k: 'recommend' | 'search' } => x.k !== null)
  if (cands.length === 0) return null
  if (cands.length === 1) return { page: cands[0].p, kind: cands[0].k }
  for (const c of cands) {
    const vis = await c.p.evaluate(() => document.visibilityState).catch(() => 'hidden')
    if (vis === 'visible') return { page: c.p, kind: c.k }
  }
  // 多个列表页且都不在前台:无法确定该跑哪个,返回 null 让 mainLoop 提示用户切到目标页(避免在后台页误操作)
  return null
}

// 主 loop:当前页驱动——识别用户当前在推荐页还是搜索页,只跑该页对应的那个任务
// (推荐→打招呼、搜索→收藏;具体动作由 run_plan.tasks 里各自的 action 决定)。
async function mainLoop(): Promise<void> {
  try {
    const criteria = await readCriteriaData()
    const tasks = (criteria.run_plan?.tasks || []).filter((task) => task.enabled)
    if (tasks.length === 0) {
      log.warn('criteria.yaml run_plan.tasks 为空')
      state.lastNote = 'run_plan.tasks 为空'
      return
    }
    if (await gateForPause()) return
    const active = await detectActivePage()
    if (!active) {
      state.lastNote = '未识别到可执行的列表页:请把要跑的推荐页/搜索页切到前台,再点开始'
      log.warn(state.lastNote)
      return
    }
    const zh = active.kind === 'recommend' ? '推荐' : '搜索'
    const matched = tasks.filter((t) => t.page === active.kind)
    if (matched.length === 0) {
      state.lastNote = `当前在${zh}页,但配置里没有对应的启用任务`
      log.warn(state.lastNote)
      return
    }
    log.info(`[当前页驱动]识别到${zh}页,执行 ${matched.length} 个对应任务`)
    let failed = 0
    for (const task of matched) {
      if (await gateForPause()) return
      try {
        await runTask(task, criteria, active.page)
      } catch (e) {
        failed++
        state.errors++
        log.error(`任务异常:${(e as Error).message}`)
      }
    }
    state.lastNote =
      failed > 0 ? `已结束(${zh}页):${failed}/${matched.length} 个任务异常` : `已跑完(${zh}页)`
  } catch (e) {
    state.errors++
    state.lastNote = (e as Error).message
    log.error(`主循环异常:${(e as Error).message}`)
  } finally {
    state.mode = 'idle'
    log.info('主循环退出')
  }
}
