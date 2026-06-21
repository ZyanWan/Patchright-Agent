// 推荐页(zhipin.com/web/chat/recommend → iframe[name=recommendFrame])的筛选联动
// DOM 结构(基于探测):
//   筛选面板:div.filter-panel > div.top
//     ├── div.vip-filters-wrap > div.filters-wrap.vip-filters (VIP 专享:年龄/活跃度/院校/专业...)
//     └── div.filters-wrap (普通:求职意向/学历要求/经验要求/薪资待遇...)
//   每个分组:div.filter-item > div.filter-wrap > div.name + div.check-box.<x> > div.options > div.option
//   "name" 含 "[单选]" 表示单选,否则按 check 状态切换
// 选项名跟搜索页不一样,做映射:
//   学历: 搜索页 "本科及以上" → 推荐页 "本科";"硕士及以上" → "硕士"
//   院校: 搜索页 "985院校"/"211院校"/"双一流院校" → 推荐页 "985"/"211"/"双一流院校"
//        搜索页 "留学生" → 推荐页 "留学"
import type { Frame, Page } from 'patchright'
import type { FilterSettings } from '../../shared/ipc'
import { log } from './logger'
import { humanPause, sleep } from './human'

async function getRecommendFrame(page: Page): Promise<Frame | null> {
  if (!/web\/chat\/recommend/.test(page.url())) return null
  for (let i = 0; i < 10; i++) {
    const f = page.frames().find((fr) => fr.name() === 'recommendFrame' && !fr.isDetached())
    if (f) return f
    await sleep(300)
  }
  return null
}

// 先点开右上角"筛选 ▾",等面板出现
async function openFilterPanel(frame: Frame): Promise<boolean> {
  // 已经展开就跳过
  const already = await frame.locator('div.filter-panel').first().isVisible().catch(() => false)
  if (already) return true
  const trigger = frame.locator('div.recommend-filter div.filter-label-wrap').first()
  const has = await trigger.count().catch(() => 0)
  if (has === 0) return false
  await trigger.click({ timeout: 2000 }).catch(() => {})
  await sleep(400)
  return await frame.locator('div.filter-panel').first().isVisible().catch(() => false)
}

// 根据 name 文本(支持 "学历要求" 也支持 "学历要求[单选]")找到 filter-item 容器
function filterItemByName(frame: Frame, name: string) {
  // div.filter-item 里有 div.name 文本以 name 开头
  return frame.locator('div.filter-item', { hasText: name }).first()
}

// 在某个 filter-item 容器里点击文本完全匹配的 option
async function clickOption(frame: Frame, itemName: string, optionText: string): Promise<boolean> {
  const item = filterItemByName(frame, itemName)
  if ((await item.count().catch(() => 0)) === 0) return false
  const opt = item.locator('div.options div.option', { hasText: optionText })
  const n = await opt.count().catch(() => 0)
  for (let i = 0; i < n; i++) {
    const el = opt.nth(i)
    const t = (await el.innerText().catch(() => '')).trim()
    if (t === optionText) {
      await el.click({ timeout: 2000 }).catch(() => {})
      return true
    }
  }
  return false
}

// 多选:按目标列表 want 跟当前 checked 状态比对,点击切换
async function syncMultiOptions(
  frame: Frame,
  itemName: string,
  want: string[]
): Promise<void> {
  const item = filterItemByName(frame, itemName)
  if ((await item.count().catch(() => 0)) === 0) {
    log.info(`[BOSS推荐]${itemName} 未找到 filter-item`)
    return
  }
  // 如果什么都不要,点"不限"清空
  if (want.length === 0) {
    const ok = await clickOption(frame, itemName, '不限')
    log.info(`[BOSS推荐]${itemName} → 不限 ${ok ? '✓' : '×'}`)
    return
  }
  const opts = item.locator('div.options div.option')
  const n = await opts.count().catch(() => 0)
  for (let i = 0; i < n; i++) {
    const el = opts.nth(i)
    const t = (await el.innerText().catch(() => '')).trim()
    if (!t || t === '不限') continue
    const isOn = await el.evaluate((e) => e.classList.contains('active')).catch(() => false)
    const should = want.includes(t)
    if (should !== isOn) {
      await el.click({ timeout: 2000 }).catch(() => {})
      log.info(`[BOSS推荐]${itemName} ${should ? '✓' : '×'} ${t}`)
      await sleep(150)
    }
  }
}

// ─── 字段映射(从搜索页用语映射到推荐页用语)──────────────────────
// legacy 学历映射:搜索页 chip → 推荐页 chip(新版不直接用,但保留可能后续用)
// @ts-expect-error 暂未使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DEGREE_MAP_LEGACY: Record<string, string> = {
  本科及以上: '本科',
  硕士及以上: '硕士',
  博士: '博士'
}

const SCHOOL_MAP: Record<string, string> = {
  '985院校': '985',
  '211院校': '211',
  双一流院校: '双一流院校',
  留学生: '留学',
  '统招本科': '公办本科', // 推荐页里大致对应"公办本科";不是精确等价
  'QS 100': '国内外名校', // 推荐页粒度更粗,只能映到"国内外名校"
  'QS 500': '国内外名校'
}

const ACTIVENESS_MAP: Record<string, string> = {
  不限: '不限',
  近1日活跃: '今日活跃',
  近3日活跃: '3日内活跃',
  近7日活跃: '本周活跃',
  近30日活跃: '本月活跃'
}

const JOB_STATUS_MAP: Record<string, string> = {
  '离职-随时到岗': '离职-随时到岗',
  '在职-月内到岗': '在职-考虑机会',
  '在职-考虑机会': '在职-考虑机会',
  '在校-月内到岗': '离职-随时到岗' // 推荐页可能没"在校",降级到最近
}


export async function applyFiltersToRecommend(
  page: Page,
  filters: FilterSettings
): Promise<{ ok: boolean; message: string }> {
  const frame = await getRecommendFrame(page)
  if (!frame) return { ok: false, message: '当前不在推荐页' }
  log.info('[BOSS推荐]开始应用筛选...')
  const opened = await openFilterPanel(frame)
  if (!opened) {
    return { ok: false, message: '筛选面板未能打开(找不到"筛选 ▾"按钮)' }
  }
  await humanPause(400, 100)

  // 学历(推荐页支持多选 chip,选项是"本科/硕士/博士/..."细颗粒)
  // 如果 useDegreeRange 模式,按 degreeMin~degreeMax 范围内的等级 chip 多选;否则按 degrees 数组
  let wantDegrees: string[]
  if (filters.useDegreeRange) {
    // BOSS_DEGREE_LEVELS = ['初中及以下','中专/中技','高中','大专','本科','硕士','博士'] (索引 0-6 对应等级 1-7)
    const levels = ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士']
    wantDegrees = levels.slice(filters.degreeMin - 1, filters.degreeMax)
  } else {
    wantDegrees = filters.degrees
  }
  await syncMultiOptions(frame, '学历要求', wantDegrees)
  await humanPause(300, 80)

  // 院校(多选)
  const wantSchools = filters.schools.map((s) => SCHOOL_MAP[s] || s)
  const uniq = Array.from(new Set(wantSchools))
  await syncMultiOptions(frame, '院校', uniq)
  await humanPause(300, 80)

  // 经验(推荐页 chip 多选)
  await syncMultiOptions(frame, '经验要求', filters.experiences)
  await humanPause(300, 80)

  // 求职意向(多选)
  const wantJobs = filters.jobStatuses.map((s) => JOB_STATUS_MAP[s] || s)
  if (wantJobs.length > 0 || filters.jobStatuses.length === 0) {
    await syncMultiOptions(frame, '求职意向', Array.from(new Set(wantJobs)))
    await humanPause(300, 80)
  }

  // 活跃度(单选)
  const act = ACTIVENESS_MAP[filters.activeness] || filters.activeness
  if (act && act !== '不限') {
    const ok = await clickOption(frame, '活跃度', act)
    log.info(`[BOSS推荐]活跃度 → ${act} ${ok ? '✓' : '×'}`)
  } else {
    await clickOption(frame, '活跃度', '不限')
  }
  await humanPause(300, 80)

  // 年龄(VIP 滑块) / 性别 / 薪资:推荐页是 VIP 滑块,第一版先打日志说明
  if (!(filters.ageMin <= 18 && filters.ageMax >= 60)) {
    log.warn(`[BOSS推荐]年龄=${filters.ageMin}-${filters.ageMax} 是 VIP 滑块,暂未联动`)
  }
  if (filters.gender !== '不限') {
    log.warn(`[BOSS推荐]性别=${filters.gender} 推荐页无此项,跳过`)
  }
  if (filters.salaryMinK > 0 || filters.salaryMaxK > 0) {
    log.warn(`[BOSS推荐]薪资=${filters.salaryMinK}-${filters.salaryMaxK}K 暂未联动`)
  }

  // 点底部"确定"按钮触发筛选生效
  const confirm = frame.locator('div.filter-panel button, div.filter-panel span', {
    hasText: '确定'
  })
  const cnt = await confirm.count().catch(() => 0)
  for (let i = 0; i < cnt; i++) {
    const el = confirm.nth(i)
    const t = (await el.innerText().catch(() => '')).trim()
    if (t === '确定') {
      await el.click({ timeout: 2000 }).catch(() => {})
      log.info('[BOSS推荐]点击底部"确定",筛选生效')
      break
    }
  }

  log.info('[BOSS推荐]筛选应用完成')
  return {
    ok: true,
    message: '推荐页:已应用学历/院校/经验/求职意向/活跃度;年龄/薪资 VIP 滑块未联动'
  }
}
