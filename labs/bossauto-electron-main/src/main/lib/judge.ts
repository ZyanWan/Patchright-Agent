// 列表层只做确定性硬筛:工作年限 + 学校。
// 去重 key 只由 姓名 + 学校 + 专业 构成。
import type { CriteriaHard } from '../../shared/ipc'

const KNOWN_985_211 = new Set(
  [
    '北京大学',
    '清华大学',
    '中国人民大学',
    '北京航空航天大学',
    '北京理工大学',
    '中国农业大学',
    '北京师范大学',
    '中央民族大学',
    '南开大学',
    '天津大学',
    '大连理工大学',
    '东北大学',
    '吉林大学',
    '哈尔滨工业大学',
    '复旦大学',
    '同济大学',
    '上海交通大学',
    '华东师范大学',
    '南京大学',
    '东南大学',
    '浙江大学',
    '中国科学技术大学',
    '厦门大学',
    '山东大学',
    '中国海洋大学',
    '武汉大学',
    '华中科技大学',
    '湖南大学',
    '中南大学',
    '中山大学',
    '华南理工大学',
    '四川大学',
    '重庆大学',
    '电子科技大学',
    '西安交通大学',
    '西北工业大学',
    '西北农林科技大学',
    '兰州大学',
    '国防科技大学',
    '北京交通大学',
    '北京工业大学',
    '北京科技大学',
    '北京化工大学',
    '北京邮电大学',
    '北京林业大学',
    '北京中医药大学',
    '北京外国语大学',
    '中国传媒大学',
    '中央财经大学',
    '对外经济贸易大学',
    '北京体育大学',
    '中央音乐学院',
    '中国政法大学',
    '华北电力大学',
    '中国矿业大学',
    '中国石油大学',
    '中国地质大学',
    '天津医科大学',
    '河北工业大学',
    '太原理工大学',
    '内蒙古大学',
    '辽宁大学',
    '大连海事大学',
    '延边大学',
    '东北师范大学',
    '哈尔滨工程大学',
    '东北农业大学',
    '东北林业大学',
    '华东理工大学',
    '东华大学',
    '上海外国语大学',
    '上海财经大学',
    '上海大学',
    '苏州大学',
    '南京航空航天大学',
    '南京理工大学',
    '河海大学',
    '江南大学',
    '南京农业大学',
    '中国药科大学',
    '南京师范大学',
    '安徽大学',
    '合肥工业大学',
    '福州大学',
    '南昌大学',
    '郑州大学',
    '华中农业大学',
    '华中师范大学',
    '中南财经政法大学',
    '湖南师范大学',
    '暨南大学',
    '华南师范大学',
    '海南大学',
    '广西大学',
    '西南交通大学',
    '四川农业大学',
    '西南大学',
    '西南财经大学',
    '贵州大学',
    '云南大学',
    '西藏大学',
    '西北大学',
    '西安电子科技大学',
    '陕西师范大学',
    '青海大学',
    '宁夏大学',
    '新疆大学',
    '石河子大学'
  ].map((s) => s.replace(/[（）()\s]/g, ''))
)

export type Decision = '刷' | 'check'

export interface JudgeResult {
  d: Decision
  r: string
}

export type EducationFact = {
  school: string
  major: string
  degree: string
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeSchool(text: string): string {
  return text.replace(/[（）()\s]/g, '')
}

export function extractEducation(rawText: string): EducationFact | null {
  const t = compact(rawText)
  const schoolMajorDegree =
    /([^\d\s|｜,，。；;:：]{2,40}(?:大学|大學|学院|學院|学校|學校))\s+([^\d\s|｜,，。；;:：]{2,30})\s+(本科|硕士|博士)/g
  const matches = Array.from(t.matchAll(schoolMajorDegree))
  const picked = matches[matches.length - 1]
  if (picked) {
    const school = picked[1].replace(/[·,，。；;:：]+$/g, '')
    const major = picked[2].replace(/[·,，。；;:：]+$/g, '')
    return { school, major, degree: picked[3] }
  }

  const normalized = normalizeSchool(t)
  const knownSchools = Array.from(KNOWN_985_211).sort((a, b) => b.length - a.length)
  for (const school of knownSchools) {
    const pos = normalized.indexOf(school)
    if (pos < 0) continue
    const tail = normalized.slice(pos + school.length, pos + school.length + 40)
    const m = /^(.{2,24}?)(本科|硕士|博士)/.exec(tail)
    if (m) return { school, major: m[1], degree: m[2] }
  }
  return null
}

export function extractYears(rawText: string): number | null {
  const t = compact(rawText)
  // "28岁 | 3年" → 取后一个数字(工作年限)
  const m1 = /(\d+)岁\s*[|｜]?\s*(\d+)年/.exec(t)
  if (m1) {
    const value = Number(m1[2])
    return Number.isFinite(value) ? value : null
  }
  // "3年 本科" → 取前一个数字(工作年限);学历词只用于定位,不参与取值
  const m2 = /(?:^|\s)(\d+)年\s+(?:本科|硕士|博士)/.exec(t)
  if (m2) {
    const value = Number(m2[1])
    return Number.isFinite(value) ? value : null
  }
  return null
}

function shortHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export function cardKey(name: string, rawText: string): string {
  const edu = extractEducation(rawText)
  if (edu) return `${name}|${edu.school}|${edu.major}`
  // 学历抽取失败时不要退化成 "姓名||":那样会把同名不同人误判成同一人而漏看。
  // 改用 姓名 + 文本指纹(去掉活跃时间等动态词),同一人文本一致仍能命中,不同人不易碰撞。
  const stable = compact(rawText).replace(/(刚刚|今日|本周|本月|近半年|\d+(?:日|周|月)内)活跃/g, '')
  return `${name}|?|${shortHash(stable)}`
}

// 学校硬筛:要求 985/211 开启时,只认国内 985/211 名单 —— 凡能识别出学校且不在名单
// (境外/港澳台/合办都在其中)即判不符合;识别不出则放行交后续,避免误杀。
// 返回 true=确定符合;false=确定不符合;null=列表卡片信息不足,无法判定。
function schoolPasses(rawText: string, hard: CriteriaHard): boolean | null {
  if (!hard.require_985_or_211) return true
  if (/985院校|211院校|双一流院校/.test(rawText)) return true
  const edu = extractEducation(rawText)
  if (!edu) return null
  return KNOWN_985_211.has(normalizeSchool(edu.school))
}

// 学历段里的境外英文信号:常见英语圈国家/地区 + 主流海外名校。绝不含中国地名拼音
// (Tsinghua/Peking/Fudan…),故国内院校的英文名不会命中、不误杀。只覆盖主流,冷门英文
// 校名可能漏(放行交后续);只扫学历段不扫整卡,避免公司英文名误刷。
const OVERSEAS_EN_SIGNAL =
  /\b(?:Singapore|Hong\s?Kong|Macau|Macao|Taiwan|Japan|Korea|Korean|Britain|British|England|Scotland|Wales|Ireland|Australia|Australian|Canada|Canadian|America|American|London|Melbourne|Sydney|Tokyo|Kyoto|Seoul|Toronto|Manchester|Edinburgh|Glasgow|Nottingham|Liverpool|Harvard|Stanford|Oxford|Cambridge|Yale|Princeton|Cornell|Berkeley|Columbia|Imperial|Monash|Waseda|Keio|Yonsei|NUS|NTU|HKU|HKUST|CUHK|PolyU|UCL)\b/i

export function judge(cardText: string, hard: CriteriaHard, eduText = ''): JudgeResult {
  // 硬筛原则:只刷"能确定不符合"的;识别不出的信息一律放行到下一关,避免误杀。
  const years = extractYears(cardText)
  if (years !== null && (years < hard.exp_years_min || years > hard.exp_years_max)) {
    return { d: '刷', r: `工作年限${years}年` }
  }
  // 学校关:只认国内 985/211。凡能识别出学校且不在名单(境外/港澳台/合办都在其中)→ 刷。
  if (schoolPasses(cardText, hard) === false) {
    return { d: '刷', r: '学校不符合要求' }
  }
  // 学历段含境外英文信号(中文/繁体译名已在上面按名单判断)→ 海外 → 刷。
  if ((hard.require_985_or_211 || hard.forbid_overseas_edu) && OVERSEAS_EN_SIGNAL.test(eduText)) {
    return { d: '刷', r: '海外院校' }
  }
  return { d: 'check', r: years === null ? '工作年限未识别,放行' : '' }
}

export type CompanyScreen = 'forbid' | 'allow' | 'none'
// 带上命中的关键词与当前公司名,便于上层记录"被刷是因为哪个公司名/类型"。
export type CompanyScreenResult = { screen: CompanyScreen; hit: string; current: string }

// 公司确定性快筛(在公司关 LLM 之前跑):名单放 criteria,代码只做子串匹配。
// 只认"当前公司"(公司文本第一段,各段以 ；/; 连接、最新在前),避免"现在在小公司、
// 几年前在大厂"被历史背景误伤;allow 优先,确保当前在允许名单的人绝不被快筛刷。
// 当前公司串过长(>30)视为非公司名(可能是整卡兜底文本),放弃快筛交 LLM。
export function companyQuickScreen(
  companyText: string,
  allow: string[],
  forbidCompanies: string[],
  forbidTypes: string[]
): CompanyScreenResult {
  const current = ((companyText || '').split(/[；;]/)[0] || '').trim()
  if (!current || current.length > 30) return { screen: 'none', hit: '', current }
  const firstHit = (list: string[]): string => {
    if (!Array.isArray(list)) return ''
    for (const kw of list) {
      const k = (kw || '').trim()
      if (k.length > 0 && current.includes(k)) return k
    }
    return ''
  }
  const a = firstHit(allow)
  if (a) return { screen: 'allow', hit: a, current }
  const f = firstHit(forbidCompanies) || firstHit(forbidTypes)
  if (f) return { screen: 'forbid', hit: f, current }
  return { screen: 'none', hit: '', current }
}

export type TitleScreen = 'allow' | 'block' | 'none'
export type TitleScreenResult = { screen: TitleScreen; hit: string }

// 职位关代码预筛(在 LLM 职位关之前跑):按岗位名做子串匹配,黑名单优先——
// 命中黑名单即刷掉(即使同时命中白名单也照刷,杜绝"品牌公关"等明确不对口岗位被一个内容类经历词豁免);
// 没命中黑名单再看白名单,命中白名单即豁免硬刷。大小写不敏感(兼容 PR/BD/SEM 等英文岗位词)。
// allow/block 皆空 → none,全部交给 LLM(等于不启用本预筛)。
// 关键词命中:纯英文/数字词(PR/BD/HR/SEM/KOL…)用单词边界,避免命中 PRD/THR/SHR 等子串造成误判;
// 含中文的词(短视频运营/产品运营…)用子串匹配。
function firstKwHit(text: string, list: string[]): string {
  const t = (text || '').toLowerCase()
  if (!t || !Array.isArray(list)) return ''
  for (const kw of list) {
    const raw = (kw || '').trim()
    const k = raw.toLowerCase()
    if (!k) continue
    const matched = /^[a-z0-9]+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(t) : t.includes(k)
    if (matched) return raw
  }
  return ''
}

// 职位关代码预筛(LLM 之前):白名单/黑名单都只匹配岗位名(期望职位+工作经历职位),不碰技能/优势/公司,
// 避免泛词在非岗位字段误命中。黑名单优先:命中黑名单→'block'(上层硬刷),即便同时命中白名单也照刷
// (杜绝"品牌公关"等明确不对口岗位靠一个内容类经历词豁免黑名单);否则命中白名单→'allow'(上层豁免硬刷);
// 都不中→'none'。是否"放进详情/再过 LLM"由上层决定,本函数只给判定档。allow/block 皆空 → none(不启用)。
export function titleQuickScreen(
  titleText: string,
  allow: string[],
  block: string[]
): TitleScreenResult {
  const b = firstKwHit(titleText, block)
  if (b) return { screen: 'block', hit: b }
  const a = firstKwHit(titleText, allow)
  if (a) return { screen: 'allow', hit: a }
  return { screen: 'none', hit: '' }
}
