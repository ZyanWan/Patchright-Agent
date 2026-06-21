// 软判定:把详情正文 + criteria 送 DeepSeek,要 JSON 输出。
// DeepSeek 走 OpenAI 兼容协议,base_url = https://api.deepseek.com/v1
// 没设 DEEPSEEK_API_KEY 就降级返回 check。
import OpenAI from 'openai'
import yaml from 'js-yaml'
import { loadCriteria, readCriteriaData } from './criteria'
import { log } from './logger'

export type SoftDecision = '收藏' | '不要' | 'check'

export type SoftResult = {
  d: SoftDecision
  score: number
  r: string
  model: string
}

export type ListGateValue = 'pass' | 'maybe' | 'reject'

export type ListGateInput = {
  index: number
  name: string
  text: string
}

export type ListGateResult = {
  index: number
  name: string
  v: ListGateValue
  r: string
}

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

let client: OpenAI | null = null

function getClient(): OpenAI | null {
  if (client) return client
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  let base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
  if (/^https:\/\/api\.deepseek\.com\/?$/.test(base)) base = 'https://api.deepseek.com/v1'
  client = new OpenAI({ apiKey: key, baseURL: base })
  return client
}

export function hasLlmKey(): boolean {
  return !!process.env.DEEPSEEK_API_KEY
}

export function llmModelName(): string {
  return DEFAULT_MODEL
}

// 详情判定步骤:第一步"主体定性"+第二步"业绩归一化"
const RECENT_YEARS = 2

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cutoffStr(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 按日期范围段切工作经历/项目经验,只保留 endDate >= now - years*年 的段。
// 日期范围正则支持:yyyy / yyyy.m(m) / yyyy.m.d / yyyy-m / yyyy/m / yyyy年m月,
// 终点可写"至今/现在/目前/now"或同格式日期。
// 段划分:每段以日期行为中点,上溯 2 行(公司+岗位),下延到下一段日期行 - 2 行,
// 相邻段不重叠不吃尾部。
function filterRecentExperience(text: string, years: number, now: Date = new Date()): string {
  if (!text || !text.trim()) return text
  const cutoffMs = now.getTime() - years * 365 * 86400_000
  const lines = text.split('\n')
  const re = /(\d{4})(?:[.\-/年](\d{1,2})月?)?\s*[-–~至到]+\s*(至今|现在|目前|now|(\d{4})(?:[.\-/年](\d{1,2})月?)?)/i
  const markers: { line: number; endMs: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    let endMs: number
    if (/至今|现在|目前|now/i.test(m[3])) endMs = now.getTime()
    else {
      const y = Number(m[4])
      const mo = m[5] ? Number(m[5]) - 1 : 11
      endMs = new Date(y, mo, 28).getTime()
    }
    markers.push({ line: i, endMs })
  }
  if (markers.length === 0) return text
  const segments: { start: number; end: number; endMs: number }[] = []
  for (let i = 0; i < markers.length; i++) {
    const dateLine = markers[i].line
    const start = i === 0 ? 0 : Math.max(0, dateLine - 2)
    const next = i < markers.length - 1 ? markers[i + 1].line : lines.length + 2
    const end = Math.max(start + 1, next - 2)
    segments.push({ start, end, endMs: markers[i].endMs })
  }
  const kept = segments.filter((s) => s.endMs >= cutoffMs)
  if (kept.length === 0) return ''
  return kept.map((s) => lines.slice(s.start, s.end).join('\n')).join('\n').trim()
}

function buildSystemStep1(): string {
  return `你只做一件事:判断候选人最近 ${RECENT_YEARS} 年(${cutoffStr(RECENT_YEARS)} 之后)的工作经历/项目经验,主体岗位是不是"内容创作类"。今天是 ${todayStr()}。
仅看工作经历+项目经验本身的事实,不要看个人优势/自述卖点。判定依据以 criteria.job_content_preference(role_summary/must_be/must_not_be) 为准,下面是常见参考但 criteria 优先。

内容创作类(算)参考清单:亲手做内容产出——
- 短视频/直播:脚本、拍摄、剪辑、出镜、主播、博主、UP主、自媒体、内容操盘、内容运营、视频运营、短视频运营、新媒体运营(以内容为主)
- 图文:公众号写作、小红书内容、品牌内容、文案创作
- 编辑/编导/编剧/剪辑师/导演助理(以内容产出为主)
- 内容策划/选题/IP 孵化/账号矩阵运营
- 含内容创作的市场/品牌/广告策划/PR(亲手出内容、非纯执行)

非内容创作(刷掉)参考清单:
- 产品运营/活动运营(无内容产出)、用户运营、数据运营、增长运营
- 销售/商务/BD/招商/采购/供应链
- 客户成功/客服/客户经理
- HR/行政/财务/法务/审计
- 技术/开发/工程师/测试/运维/数据分析
- 教研/教师(非内容产出)、辅导老师
- UI/UX/视觉/平面设计(无内容产出场景)
- 项目经理/咨询/翻译/外贸/中后台支持

边界:对接达人/纯投放/纯管理/纯剪辑专员,按"非内容创作主体"刷掉(criteria.must_not_be 也禁这些)。
跨年段:若一段经历日期跨早期与近期,只按段内 ${cutoffStr(RECENT_YEARS)} 之后的实际工作内容定性,早期不算。
拿不准时(信息不全/兼有内容与运营)倾向放过(is_content=true),交第二步业绩判定。

返回严格 JSON,无其它字符:
{"is_content": <true|false>, "role": "<最近主体岗位,如 抖音内容运营 / 产品运营 / 销售>", "reason": "<不超过30字>"}`
}

const SYSTEM_STEP2 = `你是 BOSS 直聘招聘端的简历筛选助手,负责"详情判定·业绩归一化"(主体已确认为内容创作,本步只评业绩是否达标)。
用户会给你两段输入:
1) 招聘者的"筛选标准"(YAML),其中 job_content_preference 是岗位匹配与业绩达标线的【权威依据】(含主体门槛、倍数锚点、赞藏口径等)。
2) 候选人简历的分段正文:<工作经历>、<项目经验>(只保留最近 ${RECENT_YEARS} 年,从 BOSS 网页读到,可能带噪、可能不全)。注意不再提供"个人优势/自述卖点",只看真实工作经历事实。

【判定分两步:先抽离事实,再归一化对标。不要看到大数字就直接打高分。】

第一步 抽离(只提取事实,先不下结论):
1. 主体类型:对每段相关经历,判断他做号属于哪一类——
   - 自己搞(个人号/个人 IP,自己从 0 做)
   - MCN/自媒体机构(机构号,有团队和流量扶持)
   - 甲方(品牌方自有号,借公司资源做自家号)
   - 乙方(代运营/服务客户,给别人做号)
2. 时间:每段相关经历的起止与时长(简历通常有标准日期,务必抽出)。
3. 数据口径:每个业绩数字都标注三要素——指标(涨粉/播放/赞藏/GMV/线索)× 范围(单条视频 / 单月 / 单账号累计 / 全年 / 整个生涯累计)× 时间窗。

第二步 归一化判断(结合上面三项对标 criteria):
- 把裸数字换算成"代表作水平 + 单位时间产出"再比,【不看绝对数】。例:"账号累计 30 万播放 / 2 年"要摊到月,看是否持续达标。
- 按主体套达标线,门槛由低到高:自己搞 < 乙方 < 甲方 < MCN(机构/资源越强,同样数字越不算数,达标线越高)。具体达标线与倍数以 criteria 的 job_content_preference 为准。
- 互动以"赞藏"为主;播放量不设绝对硬线(可买、靠推荐冲),只用于归一化——明显过低(如"2 年累计才几十万播放")要判不要。
- 接手已有基础的号:涨粉不算(基数撑的,不是他的本事),改看其任内有没有【持续】做出过万赞藏的爆款;有才达标。
- 做短视频满一年仍未做出任何达标成绩 → 不要。

判定为二选一,没有"待定":"收藏" = 通过(进入人工/打招呼),"不要" = 刷掉。
只有以下明确情形才判 "不要":
1) 全文完全没有任何业绩数据。
2) 有数据但归一化后明确低于 criteria 达标线(例:甲方一年多涨粉才一万多;任意主体 1-2 年累计才几十万播放;全靠单条/单月数据撑场、无持续累计量级)。
3) 做短视频满一年仍无任何达标成绩。
除此之外一律判 "收藏":既包括明确达标的,也包括"对口、有成绩迹象,但时间/数据口径缺失、是否达标拿不准、信息不全"的——这类一律放过交人工。【宁可多放过,不可误刷。】

返回严格 JSON,不要任何其它字符:
{"extract":{"subject":"<主体类型,如 甲方/MCN/乙方/自己搞;多段写主要一段>","span":"<时间跨度,如 2021-2024 共3年>","metrics":"<关键数据及口径,如 单账号累计30万播放/2年>"},"score":<1-10>,"d":"收藏"|"不要","r":"<不超过60字中文理由>"}
- r 必须点出:主体类型 + 时间跨度 + 数据口径 + 归一化结论。例:"甲方2年,账号累计30万播放,摊到月偏低,刷";"MCN1年做出多条过万赞藏,达标"。
- score 仅表示强弱供参考:越达标越高;拿不准给 6-7,不要因为分数低就判 "不要"——最终动作只看 d。`

function tryParseJson(text: string): Partial<SoftResult> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // 尝试从 text 中抠 {...}
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

async function chatJson<T>(messages: Array<{ role: 'system' | 'user'; content: string }>, label: string): Promise<T> {
  const c = getClient()
  if (!c) throw new Error('未配置 DEEPSEEK_API_KEY')
  let last = ''
  for (let i = 0; i < 3; i++) {
    const resp = await c.chat.completions.create({
      model: DEFAULT_MODEL,
      messages:
        i === 0
          ? messages
          : [...messages, { role: 'user', content: '上一次不是合法 JSON。只返回合法 JSON object。' }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 5000
    })
    last = resp.choices?.[0]?.message?.content || ''
    const parsed = tryParseAnyJson<T>(last)
    if (parsed) return parsed
  }
  throw new Error(`${label} JSON 解析失败:${last.slice(0, 120)}`)
}

function tryParseAnyJson<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0]) as T
    } catch {
      return null
    }
  }
}

function normalizeGate(v: unknown): ListGateValue {
  return v === 'pass' || v === 'maybe' || v === 'reject' ? v : 'maybe'
}

const DEFAULT_GATE_CHUNK = 5
// 并发窗口:正常 batch(默认30→6片)等于全并发;只在极端大 batch 时分轮,避免一次打爆 API
const GATE_CONCURRENCY = 16

function gateSystemPrompt(stage: 'company' | 'title'): string {
  // 共同原则:拿不准/疑似一律不 reject,偏召回(与详情判定一致)。
  const recall =
    '【拿不准就过】When unsure, or when the case is only "suspected"/ambiguous, or info is insufficient, NEVER reject — return maybe or pass. Wrongly rejecting a wanted candidate is worse than passing an unwanted one. Reject only when clearly and definitely disallowed by the YAML.'
  return stage === 'company'
    ? `You are the first list-page gate. Judge company only, including company type and industry.
Use only hard.forbid_companies_current_only, hard.forbid_company_types, and company_preference in the YAML. Ignore job_content_preference, job title, job duties, skills, advantages, salary, age, city, and candidate capability.
Treat hard.forbid_companies_current_only and hard.forbid_company_types as hard reject rules.
Treat company_preference as preferred pass/maybe signals, not hard reject rules.
Clearly-disallowed big companies and clearly-allowed ones (字节/快手/小红书) are already filtered by code before reaching you, so you mainly handle the ambiguous middle — do not over-reject.
HARD ALLOW RULE(强制放行):字节跳动 / 快手 / 小红书 及其旗下产品、关联品牌、子公司一律视为 allowed,必须返回 pass,绝不 reject。例(非穷举):今日头条、抖音、抖店、西瓜视频、番茄(番茄小说/畅听)、剪映、巨量引擎、火山引擎、TikTok 属字节系;快影 属快手系;行吟 属小红书系。命中这些一律 pass。
${recall}
Return reject only when the company/company type itself is clearly disallowed by the YAML. If the text lacks clear company information or you are unsure, return maybe or pass.
Return strict JSON only: {"items":[{"index":1,"name":"...","v":"pass|maybe|reject","r":"reason under 30 Chinese chars"}]}`
    : `You are the second list-page gate — a COARSE RELEVANCE pre-filter before opening the resume. Decide ONLY whether the candidate's role is RELEVANT to short-video content creation; do NOT judge whether they are good/strong/qualified enough — that is the detail stage's job.
Per candidate you get the list card: expected job title + work-experience roles (company/title/dates) + skill tags + the candidate's self-described advantages. Judge from job title + skill tags + advantages together.
- NEVER use company name/type/industry/scale as a reason — company is the previous gate's job. Ignore which company it is.
- Ignore age, salary, city, school.
- Judge by the actual work-experience roles + skills + advantages, NOT the self-filled expected title alone.
- Reject ONLY when the role is CLEARLY unrelated to content/short-video, with no content/video signal at all — e.g. 软件/开发/工程师, 财务/会计, HR/人事, 行政, 纯销售, 客服, 法务, 供应链, 教师/医护.
- For ANYTHING that might touch content — 运营/营销/策划/新媒体/内容/编导/短视频/直播/主播/博主/UP主/自媒体/MCN/广告/品牌/市场/拍摄/剪辑, or any vague/ambiguous title, or insufficient info — ALWAYS return pass or maybe and let the detail stage decide. Titles like 市场营销/广告/品类运营/产品运营/新媒体 are NOT enough to reject by themselves.
${recall}
Return strict JSON only: {"items":[{"index":1,"name":"...","v":"pass|maybe|reject","r":"reason under 30 Chinese chars"}]}`
}

// 列表关只喂与本关相关的标准子集:公司关看公司名单/偏好,职位关只拿"相关性靶子"。
// 不把公司名单塞给职位关,避免它越权用公司理由刷人;也不给 must_not_be 等精筛规则,
// 免得它在列表层就把"产品运营/图文"等误刷——这些该进详情看真实工作内容。
async function gateCriteriaText(stage: 'company' | 'title'): Promise<string> {
  try {
    const d = await readCriteriaData()
    if (stage === 'company') {
      return yaml.dump(
        {
          hard: {
            forbid_companies_current_only: d.hard.forbid_companies_current_only,
            forbid_company_types: d.hard.forbid_company_types,
            allow_companies: d.hard.allow_companies
          },
          company_preference: d.company_preference
        },
        { lineWidth: 200, noRefs: true }
      )
    }
    return yaml.dump(
      {
        role_summary: d.job_content_preference.role_summary,
        relevance_rule:
          '只判是否与"短视频内容创作"大类相关,不判是否优秀、不判是否达标、不判图文还是短视频(留详情)。运营/营销/策划/新媒体/内容/编导/拍摄/剪辑/直播/主播/博主/自媒体/MCN/广告/品牌/市场 等一律视为可能相关→放过;仅技术/开发/工程/财务/会计/HR/行政/纯销售/客服/法务/供应链/教师/医护 等明显无关才刷。'
      },
      { lineWidth: 200, noRefs: true }
    )
  } catch {
    return loadCriteria()
  }
}

// 单片判定:失败时只让这一片的人保守 maybe,不抛错、不拖累其它并发片
async function gateOneChunk(
  stage: 'company' | 'title',
  candidates: ListGateInput[]
): Promise<ListGateResult[]> {
  const fallback = (r: string): ListGateResult[] =>
    candidates.map((c) => ({ index: c.index, name: c.name, v: 'maybe' as ListGateValue, r }))
  try {
    const criteria = await gateCriteriaText(stage)
    const system = gateSystemPrompt(stage)
    const payload = candidates.map((c) => `${c.index}. ${c.name}\n${c.text}`).join('\n\n')
    const parsed = await chatJson<{ items?: Array<Partial<ListGateResult>> }>(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `<criteria>\n${criteria}\n</criteria>\n\n<candidates>\n${payload}\n</candidates>`
        }
      ],
      stage === 'company' ? '公司列表判定' : '职位列表判定'
    )
    const byIndex = new Map<number, ListGateResult>()
    for (const item of parsed.items || []) {
      const index = Number(item.index)
      if (!Number.isFinite(index)) continue
      byIndex.set(index, {
        index,
        name: typeof item.name === 'string' ? item.name : '',
        v: normalizeGate(item.v),
        r: typeof item.r === 'string' ? item.r : ''
      })
    }
    return candidates.map(
      (c) => byIndex.get(c.index) || { index: c.index, name: c.name, v: 'maybe' as ListGateValue, r: 'LLM未返回,保守继续' }
    )
  } catch (e) {
    log.warn(`${stage === 'company' ? '公司' : '职位'}分片判定失败,保守继续:${(e as Error).message}`)
    return fallback('LLM分片失败,保守继续')
  }
}

async function listGate(
  stage: 'company' | 'title',
  candidates: ListGateInput[],
  chunkSize = DEFAULT_GATE_CHUNK
): Promise<ListGateResult[]> {
  if (candidates.length === 0) return []
  // 钳到 [1,20]:先取整再兜底,防止 0 / 小数(如 0.5) / 负数让后面 i += size 变成 i += 0 死循环
  const floored = Math.floor(Number(chunkSize))
  const size = Number.isFinite(floored) ? Math.min(20, Math.max(1, floored)) : DEFAULT_GATE_CHUNK
  // 拆小片:降低 LLM 漏返回/串号/截断;小片之间并发,把整批列表判定耗时从"片数×单次"压到约"一次"
  const chunks: ListGateInput[][] = []
  for (let i = 0; i < candidates.length; i += size) chunks.push(candidates.slice(i, i + size))
  const results: ListGateResult[] = []
  for (let i = 0; i < chunks.length; i += GATE_CONCURRENCY) {
    const window = chunks.slice(i, i + GATE_CONCURRENCY)
    const settled = await Promise.all(window.map((ch) => gateOneChunk(stage, ch)))
    for (const part of settled) results.push(...part)
  }
  return results
}

export async function companyGate(
  candidates: ListGateInput[],
  chunkSize?: number
): Promise<ListGateResult[]> {
  return listGate('company', candidates, chunkSize)
}

export async function titleGate(
  candidates: ListGateInput[],
  chunkSize?: number
): Promise<ListGateResult[]> {
  return listGate('title', candidates, chunkSize)
}

// 详情判定的输入契约(抓取端产出 → 送端组织后送 LLM)。
export type ResumeForJudge = {
  advantage: string // 列表卡"优势/个人简介"(候选人自述卖点)
  workExperience: string // 详情页"工作经历"
  projectExperience: string // 详情页"项目经验"
}

export async function softJudge(resume: ResumeForJudge): Promise<SoftResult> {
  const c = getClient()
  if (!c) {
    return { d: 'check', score: 0, r: '未配置 DEEPSEEK_API_KEY,降级', model: '' }
  }
  const criteria = await loadCriteria()
  if (!criteria) {
    return { d: 'check', score: 0, r: 'criteria.yaml 缺失,降级', model: DEFAULT_MODEL }
  }
  // 只看近 N 年的工作经历+项目经验,完全不看个人优势/自述卖点
  const recentWork = filterRecentExperience(resume.workExperience || '', RECENT_YEARS)
  const recentProject = filterRecentExperience(resume.projectExperience || '', RECENT_YEARS)
  if (!recentWork && !recentProject) {
    return { d: 'check', score: 0, r: `近${RECENT_YEARS}年无工作/项目经历可判,降级`, model: DEFAULT_MODEL }
  }
  const recentSections = [
    recentWork && `<工作经历>\n${recentWork}\n</工作经历>`,
    recentProject && `<项目经验>\n${recentProject}\n</项目经验>`
  ]
    .filter(Boolean)
    .join('\n\n')
  // 第一步:判断最近主体岗位是否内容创作类
  try {
    const step1 = await chatJson<{ is_content?: boolean; role?: string; reason?: string }>(
      [
        { role: 'system', content: buildSystemStep1() },
        {
          role: 'user',
          content: `<criteria>\n${criteria}\n</criteria>\n\n今天是 ${todayStr()},以下只含最近 ${RECENT_YEARS} 年(${cutoffStr(RECENT_YEARS)} 之后)经历:\n\n${recentSections}`
        }
      ],
      '主体定性'
    )
    const role = typeof step1.role === 'string' ? step1.role : ''
    const reason = typeof step1.reason === 'string' ? step1.reason : ''
    if (step1.is_content === false) {
      log.info(`[详情·主体]非内容创作 role=${role} ${reason}`)
      return {
        d: '不要',
        score: 1,
        r: `主体为${role}，${reason || '非内容创作'}`,
        model: DEFAULT_MODEL
      }
    }
    log.info(`[详情·主体]内容创作 role=${role} ${reason}`)
  } catch (e) {
    log.warn(`主体定性失败,降级 check:${(e as Error).message}`)
    return { d: 'check', score: 0, r: `主体定性失败:${(e as Error).message.slice(0, 40)}`, model: DEFAULT_MODEL }
  }
  // 第二步:业绩归一化判定
  const truncated = recentSections.length > 6000 ? recentSections.slice(0, 6000) + '…' : recentSections
  const user = `<criteria>\n${criteria}\n</criteria>\n\n今天是 ${todayStr()},以下只含最近 ${RECENT_YEARS} 年(${cutoffStr(RECENT_YEARS)} 之后)经历。若某段日期跨早期与近期,只按段内 ${cutoffStr(RECENT_YEARS)} 之后的业绩评估,早期数据不计入达标判断:\n\n${truncated}`
  try {
    const resp = await c.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_STEP2 },
        { role: 'user', content: user }
      ],
      // DeepSeek 支持 response_format: json_object,强制 JSON
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1000
    })
    const text = resp.choices?.[0]?.message?.content || ''
    const parsed = tryParseJson(text)
    if (!parsed) {
      log.warn(`LLM 返回无法解析:${text.slice(0, 100)}`)
      return { d: 'check', score: 0, r: 'JSON 解析失败', model: DEFAULT_MODEL }
    }
    // 记录抽离结果(主体/时间/数据口径)到日志,便于核对归一化判定是否合理。
    const extract = (parsed as { extract?: unknown }).extract
    if (extract) log.info(`[详情抽离]${JSON.stringify(extract).slice(0, 200)}`)
    const d: SoftDecision =
      parsed.d === '收藏' || parsed.d === '不要' || parsed.d === 'check' ? parsed.d : 'check'
    return {
      d,
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      r: typeof parsed.r === 'string' ? parsed.r : '',
      model: DEFAULT_MODEL
    }
  } catch (e) {
    log.warn(`LLM 软判定失败:${(e as Error).message}`)
    return {
      d: 'check',
      score: 0,
      r: `LLM 异常:${(e as Error).message.slice(0, 40)}`,
      model: DEFAULT_MODEL
    }
  }
}
