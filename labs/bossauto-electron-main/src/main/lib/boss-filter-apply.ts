// 把 FilterSettings 应用到 BOSS 招聘端搜索页 (zhipin.com/web/chat/search,iframe=searchFrame)
// 选择器基于 DOM 探测结果:
//   学历: div.degree-ui span.degree-item (单选 chip)
//   院校: div.school-ui label.checkbox (多选;不限 = span.degree-item)
//   只看第一学历: div.school-ui p.only-first-degree label.checkbox
//   经验: div.experience-select span.exp-item
//   年龄: div.age-select span.age-item
//   其他: div.more-filter-container div.filter-2-item (需点开下拉,目前先不实现)
import type { Frame, Page } from 'patchright'
import type { FilterSection, FilterSettings } from '../../shared/ipc'
import { allZhipinPages } from './browser'
import { log } from './logger'
import { humanPause, sleep } from './human'
import { applyFiltersToRecommend } from './boss-filter-apply-recommend'

async function getActiveFrame(page: Page): Promise<Frame | null> {
  const url = page.url()
  const wantName = /web\/chat\/search/.test(url)
    ? 'searchFrame'
    : /web\/chat\/recommend/.test(url)
      ? 'recommendFrame'
      : null
  if (!wantName) return null
  for (let i = 0; i < 10; i++) {
    const f = page.frames().find((fr) => fr.name() === wantName && !fr.isDetached())
    if (f) return f
    await sleep(300)
  }
  return null
}

// 在容器内找文本完全匹配的 chip,点击。返回是否点了。
async function clickChip(frame: Frame, container: string, item: string, text: string): Promise<boolean> {
  // 用 :text 的精确匹配(BOSS 的 chip 文本中没有混合内容)
  const sel = `${container} ${item}`
  const loc = frame.locator(sel, { hasText: text })
  const cnt = await loc.count().catch(() => 0)
  for (let i = 0; i < cnt; i++) {
    const el = loc.nth(i)
    const t = (await el.innerText().catch(() => '')).trim()
    if (t === text) {
      await el.click({ timeout: 2500 }).catch(() => {})
      return true
    }
  }
  return false
}

// 搜索页学历:chips "不限/本科及以上/硕士及以上/博士"。新版 UI 允许多选,但搜索页 chip 是单选,
// 我们按"用户选了哪一档就点哪一档"的最低档(最宽松)处理;后续可以接搜索页的滑块上下限
async function applyDegrees(frame: Frame, degrees: string[]): Promise<void> {
  if (degrees.length === 0) {
    const ok = await clickChip(frame, 'div.degree-ui', 'span.degree-item', '不限')
    log.info(`[BOSS搜索]学历 → 不限 ${ok ? '✓' : '×'}`)
    return
  }
  // 搜索页只有 4 个 chip;映射:本科/硕士/博士 → 对应 chip。多选取最低档(最宽松)
  const order = ['本科', '硕士', '博士']
  let lowest = '博士'
  for (const o of order) {
    if (degrees.includes(o)) {
      lowest = o
      break
    }
  }
  const chipText =
    lowest === '本科' ? '本科及以上' : lowest === '硕士' ? '硕士及以上' : '博士'
  const ok = await clickChip(frame, 'div.degree-ui', 'span.degree-item', chipText)
  log.info(`[BOSS搜索]学历 → ${chipText} ${ok ? '✓' : '×'}`)
}

// 搜索页经验:chips 单选 "不限/在校应届/25年毕业/.../1-3年/3-5年/5-10年"
// 用户多选时点最低档(最宽松)
async function applyExperiences(frame: Frame, experiences: string[]): Promise<void> {
  if (experiences.length === 0) {
    const ok = await clickChip(frame, 'div.experience-select', 'span.exp-item', '不限')
    log.info(`[BOSS搜索]经验 → 不限 ${ok ? '✓' : '×'}`)
    return
  }
  // 按经验范围排序找最低档
  const rank = (v: string): number =>
    /在校|应届|25年|26年|26年后/.test(v) ? 0 : /1-3/.test(v) ? 1 : /3-5/.test(v) ? 2 : 3
  const lowest = experiences.slice().sort((a, b) => rank(a) - rank(b))[0]
  const ok = await clickChip(frame, 'div.experience-select', 'span.exp-item', lowest)
  log.info(`[BOSS搜索]经验 → ${lowest} ${ok ? '✓' : '×'}`)
}

// 搜索页年龄段 chip:"不限/20-25/25-30/30-35/35-40/40-50/50以上"。
// 用 ageMin/ageMax 找最匹配的 chip,如 22-35 → 点 20-25 这一档(覆盖下限)
async function applyAgeRange(frame: Frame, ageMin: number, ageMax: number): Promise<void> {
  const isDefault = ageMin <= 18 && ageMax >= 60
  if (isDefault) {
    const ok = await clickChip(frame, 'div.age-select', 'span.age-item', '不限')
    log.info(`[BOSS搜索]年龄 → 不限 ${ok ? '✓' : '×'}`)
    return
  }
  const seg =
    ageMin < 25
      ? '20-25'
      : ageMin < 30
        ? '25-30'
        : ageMin < 35
          ? '30-35'
          : ageMin < 40
            ? '35-40'
            : ageMin < 50
              ? '40-50'
              : '50以上'
  const ok = await clickChip(frame, 'div.age-select', 'span.age-item', seg)
  log.info(`[BOSS搜索]年龄 → ${seg} (按下限 ${ageMin} 映射) ${ok ? '✓' : '×'}`)
}

async function applySchools(frame: Frame, want: string[]): Promise<void> {
  // 如果什么都不要,点 "不限"
  if (want.length === 0) {
    const ok = await clickChip(frame, 'div.school-ui', 'span.degree-item', '不限')
    log.info(`[BOSS]院校 → 不限 ${ok ? '✓' : '未命中'}`)
    return
  }
  // 否则:遍历所有 school-item,根据 want 和当前 checked 状态做切换
  const items = frame.locator('div.school-ui div.school-item label.checkbox')
  const n = await items.count().catch(() => 0)
  for (let i = 0; i < n; i++) {
    const el = items.nth(i)
    const text = (await el.innerText().catch(() => '')).trim()
    if (!text) continue
    const checked = await el.evaluate((e) => e.classList.contains('checked')).catch(() => false)
    const should = want.includes(text)
    if (should !== checked) {
      await el.click({ timeout: 2000 }).catch(() => {})
      log.info(`[BOSS]院校 ${should ? '✓ 勾选' : '× 取消'} ${text}`)
      await sleep(120)
    }
  }
}

async function applyOnlyFirstDegree(frame: Frame, want: boolean): Promise<void> {
  const el = frame.locator('div.school-ui p.only-first-degree label.checkbox').first()
  const cnt = await el.count().catch(() => 0)
  if (cnt === 0) return // 该选项可能隐藏(BOSS 仅在某些院校组合下显示)
  const checked = await el.evaluate((e) => e.classList.contains('checked')).catch(() => false)
  if (checked !== want) {
    await el.click({ timeout: 2000 }).catch(() => {})
    log.info(`[BOSS]只看第一学历 → ${want}`)
  }
}

// 其他筛选(下拉/弹窗):第一版只在能识别时打日志,实际点击实现复杂,留待下一轮
async function applyOthers(frame: Frame, f: FilterSettings): Promise<void> {
  const notes: string[] = []
  if (f.gender !== '不限') notes.push(`性别=${f.gender}`)
  if (f.salaryMinK > 0 || f.salaryMaxK > 0) notes.push(`薪资=${f.salaryMinK}-${f.salaryMaxK}K`)
  if (f.activeness !== '不限') notes.push(`活跃度=${f.activeness}`)
  if (f.jobHopFrequency !== '不限') notes.push(`跳槽=${f.jobHopFrequency}`)
  if (f.jobStatuses.length > 0) notes.push(`求职状态=${f.jobStatuses.join('/')}`)
  if (notes.length > 0) {
    log.warn(`[BOSS]其他筛选项暂未联动(${notes.join(' | ')});需要点开 BOSS 下拉再适配`)
  }
  // 触发未使用变量警告规避
  void frame
}

export async function applyFiltersToBoss(
  filters: FilterSettings,
  section: FilterSection
): Promise<{
  ok: boolean
  message: string
}> {
  // 按 section 选对应的 BOSS 页面,避免把推荐配置应用到搜索页(反之亦然)
  const want = section === 'recommend' ? /web\/chat\/recommend/ : /web\/chat\/search/
  const page = allZhipinPages().find((p) => want.test(p.url())) || null
  if (!page) {
    return {
      ok: false,
      message: `未找到${section === 'recommend' ? '推荐' : '搜索'}页,请先在浏览器打开对应页`
    }
  }
  // 推荐页走推荐页专用 apply(DOM 完全不同)
  if (section === 'recommend') {
    return applyFiltersToRecommend(page, filters)
  }
  const frame = await getActiveFrame(page)
  if (!frame) {
    return { ok: false, message: '搜索页 frame 未就绪' }
  }
  log.info('[BOSS搜索]开始应用筛选...')
  try {
    await applyDegrees(frame, filters.degrees)
    await humanPause(400, 100)
    await applySchools(frame, filters.schools)
    await humanPause(400, 100)
    await applyOnlyFirstDegree(frame, filters.onlyFirstDegree)
    await humanPause(400, 100)
    await applyExperiences(frame, filters.experiences)
    await humanPause(400, 100)
    await applyAgeRange(frame, filters.ageMin, filters.ageMax)
    await humanPause(400, 100)
    await applyOthers(frame, filters)
    log.info('[BOSS]筛选应用完成')
    return { ok: true, message: '已应用学历/院校/经验/年龄;其他下拉项暂未联动' }
  } catch (e) {
    const msg = (e as Error).message
    log.warn(`[BOSS]筛选应用过程中异常:${msg}`)
    return { ok: false, message: msg }
  }
}
