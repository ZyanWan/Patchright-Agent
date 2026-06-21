import type { Frame, Locator, Page } from 'patchright'
import { BOSS_DEGREE_LEVELS, type FilterSettings } from '../../shared/ipc'
import { getSectionFilters } from './filters'
import { log } from './logger'
import { sleep } from './human'

type GuardResult = {
  ok: boolean
  message: string
}

type SearchState = {
  city: string
  job: string
  keyword: string
  degreeVal: string
  degreeContent: string
  checkedSchools: string[]
  expVal: string
  expContent: string
  ageHidden: string[]
  salaryText: string
  activeText: string
  hopText: string
  viewed14: boolean
}

// ─── 从项目筛选配置 (FilterSettings) 派生 BOSS 页面目标值 ──────────────────
// 原则:
// - 页面操作方式(滑块/chip/下拉)完全不变,只把"目标值"从写死换成读 filters。
// - 某项 filters 为空 / 「不限」时,对应设置和校验整块跳过(返回 null),不强制、不算未通过。
// - filters 与 BOSS 页面用语不一致处,在此做映射;映射不到的取值同样按"跳过"处理。

// 学历:统一折算成滑块用的等级上下限 [min,max](1=初中及以下 ... 7=博士)。
// - useDegreeRange:直接用 degreeMin/degreeMax
// - 否则按 degrees 标签反查等级,取最小/最大
// - 都为空 → null(不限,跳过)
function degreeRange(f: FilterSettings): { min: number; max: number } | null {
  if (f.useDegreeRange) {
    if (!f.degreeMin || !f.degreeMax) return null
    return { min: f.degreeMin, max: f.degreeMax }
  }
  if (!f.degrees.length) return null
  const levels = f.degrees
    .map((d) => BOSS_DEGREE_LEVELS.indexOf(d) + 1)
    .filter((n) => n >= 1)
  if (!levels.length) return null
  return { min: Math.min(...levels), max: Math.max(...levels) }
}

// 学历等级 → 标签(滑块内容文本 "本科-本科" 用)
function degreeLabel(level: number): string {
  return BOSS_DEGREE_LEVELS[level - 1] || ''
}

// 院校:搜索页 label 文本与 BOSS_SCHOOL_OPTIONS 一致,直接用配置;空 → null(跳过)
function searchSchools(f: FilterSettings): string[] | null {
  return f.schools.length ? f.schools : null
}

// 院校:推荐页 chip 用语与配置不同,做映射(与 boss-filter-apply-recommend.ts 保持一致)
const RECOMMEND_SCHOOL_MAP: Record<string, string> = {
  '985院校': '985',
  '211院校': '211',
  双一流院校: '双一流院校',
  留学生: '留学'
}
function recommendSchools(f: FilterSettings): string[] | null {
  if (!f.schools.length) return null
  return Array.from(new Set(f.schools.map((s) => RECOMMEND_SCHOOL_MAP[s] || s)))
}

// 经验:把若干经验标签折算成年限区间 [minY,maxY];空 → null(跳过)
// 搜索页是"年限滑块",位置 p 对应 (p-1) 年(value 2,5 ↔ 内容 "1年-4年",max=12)。
const EXP_YEAR_RANGE: Record<string, [number, number]> = {
  '在校/应届': [0, 0],
  '25年毕业': [0, 0],
  '26年毕业': [0, 0],
  '26年后毕业': [0, 0],
  '1-3年': [1, 3],
  '3-5年': [3, 5],
  '5-10年': [5, 10],
  '10年以上': [10, 11] // 11=滑块上限(max 12 → 内容封顶 11年)
}
function experienceYearRange(f: FilterSettings): { minY: number; maxY: number } | null {
  if (!f.experiences.length) return null
  const spans = f.experiences.map((e) => EXP_YEAR_RANGE[e]).filter(Boolean) as [number, number][]
  if (!spans.length) return null
  const minY = Math.min(...spans.map((s) => s[0]))
  const maxY = Math.max(...spans.map((s) => s[1]))
  return { minY, maxY }
}

// 经验:推荐页 chip 用语映射;配置里能直接对上的保留,其余尽量映射;空 → null(跳过)
const RECOMMEND_EXP_MAP: Record<string, string> = {
  '在校/应届': '1年以内',
  '25年毕业': '1年以内',
  '26年毕业': '1年以内',
  '26年后毕业': '1年以内',
  '1-3年': '1-3年',
  '3-5年': '3-5年',
  '5-10年': '5-10年',
  '10年以上': '10年以上'
}
function recommendExperiences(f: FilterSettings): string[] | null {
  if (!f.experiences.length) return null
  const mapped = Array.from(new Set(f.experiences.map((e) => RECOMMEND_EXP_MAP[e] || e)))
  return mapped.length ? mapped : null
}

// 年龄:filters 默认 18~60 视为不限;否则用 ageMin/ageMax;不限 → null(跳过)
function ageRange(f: FilterSettings): { min: number; max: number } | null {
  if (f.ageMin <= 18 && f.ageMax >= 60) return null
  return { min: f.ageMin, max: f.ageMax }
}

// 薪资:salaryMinK/salaryMaxK 都为 0 视为不限;否则取下限 K 档(搜索页只点左侧下限列表)
function salaryMinK(f: FilterSettings): number | null {
  if (f.salaryMinK <= 0 && f.salaryMaxK <= 0) return null
  return f.salaryMinK > 0 ? f.salaryMinK : null
}

// 活跃度:搜索页下拉用语映射(BOSS_ACTIVENESS_OPTIONS → 搜索页文本);不限/映射不到 → null(跳过)
const SEARCH_ACTIVE_MAP: Record<string, string> = {
  近1日活跃: '近一天活跃',
  近3日活跃: '近三天活跃',
  近7日活跃: '近一周活跃',
  近30日活跃: '近一月活跃'
}
function searchActiveness(f: FilterSettings): string | null {
  if (!f.activeness || f.activeness === '不限') return null
  return SEARCH_ACTIVE_MAP[f.activeness] || null
}

// 活跃度:推荐页 chip 用语映射(与 boss-filter-apply-recommend.ts 一致);不限/映射不到 → null
const RECOMMEND_ACTIVE_MAP: Record<string, string> = {
  近1日活跃: '今日活跃',
  近3日活跃: '3日内活跃',
  近7日活跃: '本周活跃',
  近30日活跃: '本月活跃'
}
function recommendActiveness(f: FilterSettings): string | null {
  if (!f.activeness || f.activeness === '不限') return null
  return RECOMMEND_ACTIVE_MAP[f.activeness] || null
}

// 跳槽频率:配置取值 稳定型/正常/频繁,与页面"按年限"的选项语义不完全对应。
// 只把"稳定型"映射到页面"长期稳定"一档(搜索页="时间≥1年",推荐页="平均每份工作大于1年");
// 正常/频繁页面无对应稳妥项 → null(跳过,不强制)。不限 → null。
function searchJobHop(f: FilterSettings): string | null {
  return f.jobHopFrequency === '稳定型' ? '时间≥1年' : null
}
function recommendJobHop(f: FilterSettings): string | null {
  return f.jobHopFrequency === '稳定型' ? '平均每份工作大于1年' : null
}

async function listFrame(page: Page, name: string): Promise<Frame | null> {
  for (let i = 0; i < 10; i++) {
    const frame = page.frames().find((f) => f.name() === name && !f.isDetached())
    if (frame) return frame
    await sleep(300)
  }
  return null
}

async function innerText(locator: Locator): Promise<string> {
  return (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}

async function clickExact(
  root: Frame | Locator,
  selector: string,
  wanted: string
): Promise<boolean> {
  const items = root.locator(selector, { hasText: wanted })
  const count = await items.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    if ((await innerText(item)) === wanted) {
      await item.click({ timeout: 3000 }).catch(() => {})
      return true
    }
  }
  return false
}

async function dragCenter(page: Page, locator: Locator, toX: number, toY: number): Promise<void> {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps: 20 })
  await page.mouse.up()
}

async function setRangeSlider(
  page: Page,
  frame: Frame,
  rootSelector: string,
  lowValue: number,
  highValue: number,
  maxValue: number
): Promise<void> {
  const buttons = frame.locator(`${rootSelector} .ui-slider-button`)
  const box = await frame.locator(`${rootSelector} .ui-slider-wrap`).boundingBox().catch(() => null)
  if (!box) return
  const xFor = (value: number) => box.x + box.width * ((value - 1) / (maxValue - 1))
  const y = box.y + box.height / 2
  await dragCenter(page, buttons.nth(1), xFor(highValue), y)
  await sleep(300)
  await dragCenter(page, buttons.nth(0), xFor(lowValue), y)
  await sleep(700)
}

async function selectOpenDropdownOption(frame: Frame, wanted: string): Promise<boolean> {
  const loc = frame.locator('.dropdown-wrap.dropdown-menu-open li', { hasText: wanted })
  const count = await loc.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const item = loc.nth(i)
    if ((await innerText(item)) === wanted) {
      await item.click({ timeout: 3000 }).catch(() => {})
      return true
    }
  }
  return false
}

// 城市:目标城市来自 filters.city(界面可填),默认北京
async function setCity(frame: Frame, city: string): Promise<void> {
  const target = (city || '北京').replace(/\s+/g, '')
  const cityText = await frame
    .locator('.city-wrap')
    .first()
    .innerText()
    .catch(() => '')
  if (cityText.replace(/\s+/g, '') === target) return

  const input = frame.locator('.city-wrap input').first()
  await input.click({ timeout: 3000 }).catch(() => {})
  await input.fill(target, { timeout: 3000 }).catch(() => {})
  await sleep(500)
  await clickExact(frame, '.city-box .search-result-item', target)
  await sleep(1000)
}

// 学历(搜索页滑块):目标等级区间来自 filters;不限则跳过
async function setDegree(page: Page, frame: Frame, range: { min: number; max: number }): Promise<void> {
  const wantContent = `${degreeLabel(range.min)}-${degreeLabel(range.max)}`
  const wantValue = `${range.min},${range.max}`
  const content = await innerText(frame.locator('.degree-select-custom-content').first())
  const value = await frame
    .locator('.degree-select-custom-slider input')
    .first()
    .getAttribute('value')
    .catch(() => '')
  if (content === wantContent && value === wantValue) return

  await frame.locator('.degree-select-C .degree-select-custom-label').click({ timeout: 3000 })
  await sleep(400)
  await setRangeSlider(page, frame, '.degree-select-custom-slider', range.min, range.max, 7)
}

// 院校(搜索页多选):目标集合来自 filters.schools;空则跳过
async function setSchools(frame: Frame, want: string[]): Promise<void> {
  const labels = frame.locator('.school-ui label.checkbox')
  const count = await labels.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const label = labels.nth(i)
    const text = await innerText(label)
    if (!text) continue
    const shouldCheck = want.includes(text)
    const checked = await label.evaluate((el) => el.classList.contains('checked')).catch(() => false)
    if (shouldCheck !== checked) {
      await label.click({ timeout: 3000 }).catch(() => {})
      await sleep(150)
    }
  }
}

// 经验(搜索页滑块):年限区间 → 滑块位置(位置=年限+1),内容 "x年-y年";不限则跳过
async function setExperience(
  page: Page,
  frame: Frame,
  span: { minY: number; maxY: number }
): Promise<void> {
  const lowPos = span.minY + 1
  const highPos = span.maxY + 1
  const wantContent = `${span.minY}年-${span.maxY}年`
  const wantValue = `${lowPos},${highPos}`
  const content = await innerText(frame.locator('.experience-select-custom-content').first())
  const value = await frame
    .locator('.experience-select-custom-slider input')
    .first()
    .getAttribute('value')
    .catch(() => '')
  if (content === wantContent && value === wantValue) return

  await frame.locator('.experience-select .custom').click({ timeout: 3000 })
  await sleep(400)
  await setRangeSlider(page, frame, '.experience-select-custom-slider', lowPos, highPos, 12)
}

// 年龄(搜索页双下拉):上下限来自 filters.ageMin/ageMax;不限则跳过
async function setAge(frame: Frame, range: { min: number; max: number }): Promise<void> {
  const values = await frame
    .locator('.age-custom input[type=hidden]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
    .catch(() => [])
  if (values[0] === String(range.min) && values[1] === String(range.max)) return

  await frame.locator('.age-select .custom').click({ timeout: 3000 }).catch(() => {})
  await sleep(300)
  await frame.locator('.age-custom .dropdown-wrap').nth(0).click({ timeout: 3000 })
  await sleep(300)
  await selectOpenDropdownOption(frame, `${range.min}岁`)
  await sleep(300)
  await frame.locator('.age-custom .dropdown-wrap').nth(1).click({ timeout: 3000 })
  await sleep(300)
  await selectOpenDropdownOption(frame, `${range.max}岁`)
  await sleep(700)
}

// 薪资(搜索页):点左侧下限 K 档;下限来自 filters.salaryMinK;不限则跳过
async function setSalary(frame: Frame, minK: number): Promise<void> {
  const wantK = `${minK}K`
  const selected = await innerText(frame.locator('.salary-container .double-select-gray-inner-flip').first())
  if (selected.startsWith(`${wantK}-`)) return

  await frame.locator('.salary-container').click({ timeout: 3000 })
  await sleep(400)
  await frame.evaluate((wanted) => {
    const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim()
    const lists = Array.from(document.querySelectorAll('.salary-container .dropdown-menu ul.options'))
    const left = lists[0]
    const item = Array.from(left?.querySelectorAll('li') || []).find((li) => text(li) === wanted)
    ;(item as HTMLElement | undefined)?.click()
  }, wantK)
  await sleep(800)
}

async function setSingleDropdown(
  frame: Frame,
  triggerSelector: string,
  wanted: string
): Promise<void> {
  const trigger = frame.locator(triggerSelector).first()
  if ((await innerText(trigger)) === wanted) return
  await trigger.click({ timeout: 3000 })
  await sleep(300)
  await selectOpenDropdownOption(frame, wanted)
  await sleep(600)
}

// 过滤近14天查看:FilterSettings 无此字段,暂保留写死(默认勾选)
async function setViewed14(frame: Frame): Promise<void> {
  const checkbox = frame.locator('label[ka="search_change_view_resume"]').first()
  const state = await checkbox
    .evaluate((el) => ({
      checked: !!el.querySelector('input')?.checked,
      cls: String(el.className)
    }))
    .catch(() => ({ checked: false, cls: '' }))
  if (state.checked || state.cls.includes('checked')) return
  await checkbox.click({ timeout: 3000 }).catch(() => {})
  await sleep(800)
}

async function readSearchState(frame: Frame): Promise<SearchState> {
  return await frame.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      (el?.textContent || '').replace(/\s+/g, ' ').trim()
    const checkedSchools = Array.from(document.querySelectorAll('.school-ui label.checkbox.checked')).map(
      (el) => text(el)
    )
    const activeTrigger = Array.from(
      document.querySelectorAll('.more-filter-container .dropdown-wrap')
    ).find((el) => text(el).includes('活跃'))
    return {
      city: text(document.querySelector('.city-wrap')).replace(/\s+/g, ''),
      job: text(document.querySelector('.search-current-job')),
      keyword:
        (document.querySelector('input.search-input') as HTMLInputElement | null)?.value ||
        (text(document.body).match(/持续关注「([^」]+)」/) || [])[1] ||
        '',
      degreeVal:
        (document.querySelector('.degree-select-custom-slider input') as HTMLInputElement | null)
          ?.value || '',
      degreeContent: text(document.querySelector('.degree-select-custom-content')),
      checkedSchools,
      expVal:
        (document.querySelector('.experience-select-custom-slider input') as HTMLInputElement | null)
          ?.value || '',
      expContent: text(document.querySelector('.experience-select-custom-content')),
      ageHidden: Array.from(document.querySelectorAll('.age-custom input[type=hidden]')).map(
        (el) => (el as HTMLInputElement).value
      ),
      salaryText: text(document.querySelector('.salary-container .double-select-gray-inner-flip')),
      activeText: text(activeTrigger),
      hopText: text(document.querySelector('.work-year-select')),
      viewed14:
        !!document.querySelector('label[ka="search_change_view_resume"].checked') ||
        !!(document.querySelector('label[ka="search_change_view_resume"] input') as HTMLInputElement | null)
          ?.checked
    }
  })
}

// 校验:逐项只在 filters 有该目标时才比对;为空/不限的项整块跳过(不算未通过)
function verifySearchState(s: SearchState, f: FilterSettings): string[] {
  const missing: string[] = []

  // 城市:FilterSettings 无此字段,暂保留写死(北京)
  const wantCity = (f.city || '北京').replace(/\s+/g, '')
  if (s.city !== wantCity) missing.push(`城市=${wantCity}`)

  const deg = degreeRange(f)
  if (deg) {
    const wantContent = `${degreeLabel(deg.min)}-${degreeLabel(deg.max)}`
    const wantValue = `${deg.min},${deg.max}`
    if (s.degreeVal !== wantValue || s.degreeContent !== wantContent) {
      missing.push(`学历=${wantContent}`)
    }
  }

  const schools = searchSchools(f)
  if (schools) {
    if (!schools.every((school) => s.checkedSchools.includes(school))) {
      missing.push(`院校=${schools.join('/')}`)
    }
  }

  const exp = experienceYearRange(f)
  if (exp) {
    const wantContent = `${exp.minY}年-${exp.maxY}年`
    const wantValue = `${exp.minY + 1},${exp.maxY + 1}`
    if (s.expVal !== wantValue || s.expContent !== wantContent) {
      missing.push(`经验=${wantContent}`)
    }
  }

  const age = ageRange(f)
  if (age) {
    if (s.ageHidden[0] !== String(age.min) || s.ageHidden[1] !== String(age.max)) {
      missing.push(`年龄=${age.min}-${age.max}`)
    }
  }

  const minK = salaryMinK(f)
  if (minK) {
    if (!s.salaryText.startsWith(`${minK}K-`)) missing.push(`薪资=${minK}K-`)
  }

  const active = searchActiveness(f)
  if (active) {
    if (s.activeText !== active) missing.push(`牛人活跃度=${active}`)
  }

  const hop = searchJobHop(f)
  if (hop) {
    if (s.hopText !== hop) missing.push(`跳槽频率=${hop}`)
  }

  // 过滤近14天查看:FilterSettings 无此字段,暂保留写死(要求勾选)
  if (!s.viewed14) missing.push('过滤近14天查看')

  return missing
}

async function ensureSearchFilters(page: Page): Promise<GuardResult> {
  const frame = await listFrame(page, 'searchFrame')
  if (!frame) return { ok: false, message: '搜索页 frame 未就绪' }

  // 搜索页读「搜索」section 的筛选配置
  const f = await getSectionFilters('search')

  // 城市:来自 filters.city(界面可填),默认北京
  await setCity(frame, f.city || '北京')

  const deg = degreeRange(f)
  if (deg) await setDegree(page, frame, deg)

  const schools = searchSchools(f)
  if (schools) await setSchools(frame, schools)

  const exp = experienceYearRange(f)
  if (exp) await setExperience(page, frame, exp)

  const age = ageRange(f)
  if (age) await setAge(frame, age)

  const minK = salaryMinK(f)
  if (minK) await setSalary(frame, minK)

  const active = searchActiveness(f)
  if (active) {
    await setSingleDropdown(
      frame,
      '.more-filter-container .dropdown-wrap:has-text("牛人活跃度")',
      active
    )
  }

  const hop = searchJobHop(f)
  if (hop) await setSingleDropdown(frame, '.more-filter-container .work-year-select', hop)

  // 过滤近14天查看:FilterSettings 无此字段,暂保留写死(默认勾选)
  await setViewed14(frame)

  const state = await readSearchState(frame)
  const missing = verifySearchState(state, f)
  if (missing.length > 0) {
    return { ok: false, message: `搜索条件未完整:${missing.join('、')}` }
  }
  return {
    ok: true,
    message: `搜索条件已确认: ${state.job || '-'} / ${state.keyword || '-'}`
  }
}

async function openRecommendFilter(frame: Frame): Promise<boolean> {
  if (await frame.locator('div.filter-panel').first().isVisible().catch(() => false)) return true
  await frame.locator('div.recommend-filter div.filter-label-wrap').first().click({ timeout: 3000 }).catch(() => {})
  await sleep(500)
  return await frame.locator('div.filter-panel').first().isVisible().catch(() => false)
}

function recommendFilterItem(frame: Frame, name: string): Locator {
  return frame.locator('div.filter-panel div.filter-item', { hasText: name }).first()
}

async function activeRecommendOptions(item: Locator): Promise<string[]> {
  return await item
    .locator('div.options div.option')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const cls = String((node as HTMLElement).className || '')
          return /\b(active|selected|on)\b/.test(cls)
        })
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
    .catch(() => [])
}

async function recommendOption(item: Locator, wanted: string): Promise<Locator | null> {
  const options = item.locator('div.options div.option', { hasText: wanted })
  const count = await options.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const option = options.nth(i)
    if ((await innerText(option)) === wanted) return option
  }
  return null
}

async function setRecommendSingle(frame: Frame, itemName: string, wanted: string): Promise<void> {
  const item = recommendFilterItem(frame, itemName)
  if ((await item.count().catch(() => 0)) === 0) return
  const active = await activeRecommendOptions(item)
  if (active.length === 1 && active[0] === wanted) return
  const option = await recommendOption(item, wanted)
  if (!option) return
  await option.click({ timeout: 3000 }).catch(() => {})
  await sleep(500)
}

async function syncRecommendMulti(frame: Frame, itemName: string, wanted: string[]): Promise<void> {
  const item = recommendFilterItem(frame, itemName)
  if ((await item.count().catch(() => 0)) === 0) return

  const options = item.locator('div.options div.option')
  const count = await options.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const option = options.nth(i)
    const value = await innerText(option)
    if (!value || value === '不限') continue
    const shouldBeActive = wanted.includes(value)
    const isActive = await option
      .evaluate((node) => /\b(active|selected|on)\b/.test(String((node as HTMLElement).className || '')))
      .catch(() => false)
    if (shouldBeActive !== isActive) {
      await option.click({ timeout: 3000 }).catch(() => {})
      await sleep(500)
    }
  }
}

async function confirmRecommendFilter(frame: Frame): Promise<void> {
  const buttons = frame.locator('div.filter-panel div.btn', { hasText: '确定' })
  const count = await buttons.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i)
    if ((await innerText(button)) === '确定') {
      await button.click({ timeout: 3000 }).catch(() => {})
      await sleep(1000)
      return
    }
  }
}

async function readRecommendState(frame: Frame): Promise<Record<string, string[]>> {
  return await frame
    .evaluate(() => {
      const text = (el: Element | null | undefined) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim()
      const rows = Array.from(document.querySelectorAll('div.filter-panel div.filter-item')).map(
        (item) => {
          const name = text(item.querySelector('.name'))
          const active = Array.from(item.querySelectorAll('div.options div.option'))
            .filter((option) =>
              /\b(active|selected|on)\b/.test(String((option as HTMLElement).className || ''))
            )
            .map((option) => text(option))
            .filter(Boolean)
          return [name, active]
        }
      )
      return Object.fromEntries(rows)
    })
    .catch(() => ({}))
}

function activeByPrefix(state: Record<string, string[]>, prefix: string): string[] {
  const key = Object.keys(state).find((name) => name.startsWith(prefix))
  return key ? state[key] || [] : []
}

async function ensureRecommendFilters(_page: Page): Promise<GuardResult> {
  const frame = await listFrame(_page, 'recommendFrame')
  if (!frame) return { ok: false, message: '推荐页 frame 未就绪' }

  if (!(await openRecommendFilter(frame))) {
    return { ok: false, message: '推荐筛选面板未能打开' }
  }

  // 推荐页读「推荐」section 的筛选配置
  const f = await getSectionFilters('recommend')

  // 各目标值从 filters 派生;为空/不限/映射不到的项跳过(不设置、不校验)
  const wantActive = recommendActiveness(f)
  const wantSchools = recommendSchools(f)
  const wantHop = recommendJobHop(f)
  const deg = degreeRange(f)
  const wantDegrees = deg ? BOSS_DEGREE_LEVELS.slice(deg.min - 1, deg.max) : null
  const wantExp = recommendExperiences(f)

  if (wantActive) await setRecommendSingle(frame, '活跃度', wantActive)
  // 过滤近14天查看:FilterSettings 无此字段,暂保留写死(选"近14天没有")
  await setRecommendSingle(frame, '近期没有看过', '近14天没有')
  if (wantSchools) await syncRecommendMulti(frame, '院校', wantSchools)
  if (wantHop) await setRecommendSingle(frame, '跳槽频率', wantHop)
  if (wantDegrees) await syncRecommendMulti(frame, '学历要求', wantDegrees)
  if (wantExp) await syncRecommendMulti(frame, '经验要求', wantExp)
  await confirmRecommendFilter(frame)

  if (!(await openRecommendFilter(frame))) {
    return { ok: false, message: '推荐筛选已尝试设置,但无法复核' }
  }

  const state = await readRecommendState(frame)
  const missing: string[] = []

  const schools = activeByPrefix(state, '院校')
  const degrees = activeByPrefix(state, '学历要求')
  const experiences = activeByPrefix(state, '经验要求')

  if (wantActive && !activeByPrefix(state, '活跃度').includes(wantActive)) {
    missing.push(`牛人活跃度=${wantActive}`)
  }
  // 过滤近14天查看:FilterSettings 无此字段,暂保留写死
  if (!activeByPrefix(state, '近期没有看过').includes('近14天没有')) missing.push('过滤近14天查看')
  if (wantSchools) {
    if (!wantSchools.every((school) => schools.includes(school))) {
      missing.push(`院校=${wantSchools.join('/')}`)
    }
    if (schools.some((school) => !wantSchools.includes(school))) {
      missing.push(`院校只选${wantSchools.join('/')}`)
    }
  }
  if (wantDegrees) {
    if (!wantDegrees.every((d) => degrees.includes(d))) {
      missing.push(`学历=${wantDegrees.join('/')}`)
    }
    if (degrees.some((d) => !wantDegrees.includes(d))) {
      missing.push(`学历只选${wantDegrees.join('/')}`)
    }
  }
  if (wantExp) {
    if (!wantExp.every((exp) => experiences.includes(exp))) {
      missing.push(`经验=${wantExp.join('/')}`)
    }
    if (experiences.some((exp) => !wantExp.includes(exp))) {
      missing.push(`经验只选${wantExp.join('/')}`)
    }
  }
  if (wantHop && !activeByPrefix(state, '跳槽频率').includes(wantHop)) {
    missing.push(`跳槽频率=${wantHop}`)
  }

  await confirmRecommendFilter(frame)

  if (missing.length > 0) {
    return { ok: false, message: `推荐条件未完整:${missing.join('、')}` }
  }
  return { ok: true, message: '推荐条件已确认' }
}

export async function ensureBossFilters(page: Page): Promise<GuardResult> {
  const url = page.url()
  const result = /web\/chat\/search/.test(url)
    ? await ensureSearchFilters(page)
    : /web\/chat\/recommend/.test(url)
      ? await ensureRecommendFilters(page)
      : { ok: true, message: '非搜索/推荐页,跳过筛选校验' }

  if (result.ok) log.info(`[筛选校验]${result.message}`)
  else log.warn(`[筛选校验]${result.message}`)
  return result
}
