// IPC channel 常量 + 类型,主进程和 renderer 共用
export const IPC = {
  // 浏览器生命周期
  BROWSER_LAUNCH: 'browser:launch',
  BROWSER_CLOSE: 'browser:close',
  BROWSER_STATUS: 'browser:status',
  // 日志推送
  LOG_APPEND: 'log:append',
  // DOM 直读验证
  PROBE_DOM_READ: 'probe:dom-read',
  // 主循环控制
  RUN_START: 'run:start',
  RUN_PAUSE: 'run:pause',
  RUN_STOP: 'run:stop',
  RUN_STATS: 'run:stats',
  // 运行设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  // 筛选条件
  FILTERS_GET: 'filters:get',
  FILTERS_SET: 'filters:set',
  FILTERS_APPLY: 'filters:apply',
  FILTERS_KEYWORD: 'filters:keyword',
  // 判定标准
  CRITERIA_GET: 'criteria:get',
  CRITERIA_SET: 'criteria:set',
  CRITERIA_RAW: 'criteria:raw',
  // 对话(每批 runner 主动汇总,用户可追问/反馈调整)
  CHAT_HISTORY: 'chat:history',
  CHAT_SEND: 'chat:send',
  CHAT_CLEAR: 'chat:clear',
  CHAT_APPEND: 'chat:append',
  // BOSS 网页筛选区 DOM 探测
  BOSS_FILTER_PROBE: 'boss:filter-probe',
  // 从用户日常 Chrome profile 同步 cookies/local storage 到 patchright profile
  // 用于 BOSS 单点登录被挤掉后快速恢复
  CHROME_SYNC_LOGIN: 'chrome:sync-login',
  // 状态广播
  STATUS_UPDATE: 'status:update',
  RUN_STATS_UPDATE: 'run:stats-update',
  // 多项目
  PROJECTS_LIST: 'projects:list',
  PROJECTS_SET_ACTIVE: 'projects:set-active',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_DUPLICATE: 'projects:duplicate',
  PROJECTS_RENAME: 'projects:rename',
  PROJECTS_ARCHIVE: 'projects:archive'
} as const

export type RunSettings = {
  dryRun: boolean // true 时不点 BOSS 上的写按钮
  doCollect: boolean // 收藏开关
  doGreet: boolean // 打招呼开关
}

// 筛选条件(一比一对照 BOSS 招聘端搜索页的实际筛选项)
// 学历等级:1=初中及以下 ... 7=博士(搜索页滑块的值域)
export const BOSS_DEGREE_LEVELS = [
  '初中及以下',
  '中专/中技',
  '高中',
  '大专',
  '本科',
  '硕士',
  '博士'
]
export const BOSS_SCHOOL_OPTIONS = [
  '统招本科',
  '双一流院校',
  '211院校',
  '985院校',
  '留学生',
  'QS 100',
  'QS 500'
]
export const BOSS_EXPERIENCE_OPTIONS = [
  '在校/应届',
  '25年毕业',
  '26年毕业',
  '26年后毕业',
  '1-3年',
  '3-5年',
  '5-10年',
  '10年以上'
]
export const BOSS_GENDER_OPTIONS = ['不限', '男', '女']
export const BOSS_ACTIVENESS_OPTIONS = [
  '不限',
  '近1日活跃',
  '近3日活跃',
  '近7日活跃',
  '近30日活跃'
]
export const BOSS_JOB_HOP_OPTIONS = ['不限', '稳定型', '正常', '频繁']
export const BOSS_JOB_STATUS_OPTIONS = [
  '离职-随时到岗',
  '在职-月内到岗',
  '在职-考虑机会',
  '在校-月内到岗'
]

export type FilterSettings = {
  // 学历:支持两种模式
  // - degrees=[] 表示不限
  // - useDegreeRange=true 时按 [degreeMin, degreeMax] 上下限(1~7=初中~博士),搜索页用滑块
  //   推荐页降级为按上下限范围内的等级 chip 多选
  // - useDegreeRange=false 时直接按 degrees 多选 chip
  degrees: string[]
  useDegreeRange: boolean
  degreeMin: number // 1=初中及以下
  degreeMax: number // 7=博士
  schools: string[] // 多选 BOSS_SCHOOL_OPTIONS
  onlyFirstDegree: boolean
  experiences: string[] // 多选 BOSS_EXPERIENCE_OPTIONS
  ageMin: number // 18~60,等于 ageMax 时表示某个点
  ageMax: number
  gender: string // 单选 BOSS_GENDER_OPTIONS
  salaryMinK: number // 0 = 不限
  salaryMaxK: number
  activeness: string
  jobHopFrequency: string
  jobStatuses: string[] // 多选
  city: string // 目标城市(目前仅搜索页生效),默认北京
  custom: Record<string, string>
}

// 对话消息
export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  ts: number
  meta?: {
    kind?: 'batch_summary' | 'reply'
    batchNo?: number
  }
}

// criteria.yaml 结构化数据(给 UI)
export type CriteriaHard = {
  edu_levels_allowed: string[]
  age_max: number
  exp_years_min: number
  exp_years_max: number
  city_in: string[]
  require_985_or_211: boolean
  forbid_overseas_edu: boolean
  forbid_tags: string[]
  forbid_companies_current_only: string[]
  forbid_company_types: string[]
  // 允许名单(代码快筛):当前公司命中即直接放过、不进公司关 LLM
  allow_companies: string[]
}

export type CriteriaEduPref = {
  prefer_985: boolean
  prefer_211: boolean
  prefer_qs500: boolean
  prefer_overseas: boolean
  prefer_majors: string[]
  avoid_majors: string[]
  notes: string
}

export type CriteriaCompanyPref = {
  big_company_required: boolean
  preferred_company_types: string[]
  preferred_industries: string[]
  notes: string
}

export type CriteriaJobContent = {
  role_summary: string
  evaluation_rules: string[]
  must_be: string[]
  must_not_be: string[]
  strong_plus: string[]
  minus: string[]
  // 列表层"职位关"代码预筛(在 LLM 职位关之前跑):按岗位名(期望职位+工作经历职位)匹配。
  // 命中 title_block_keywords→直接刷掉;命中 title_allow_keywords→豁免硬刷;没被硬刷的(含豁免)一律再过一遍 LLM 职位关。block 为空=不启用硬刷。
  title_allow_keywords: string[]
  title_block_keywords: string[]
  notes: string
}

export type CriteriaTalent = {
  preferred_company_size: string | null
  require_strong_intent: boolean
  notes: string
}

export type CriteriaDecision = {
  pass_score: number
  bias: string
  action_on_pass: string
  action_on_fail: string
  uncertain_band: [number, number]
}

export type RunPlanTask = {
  enabled: boolean
  page: 'recommend' | 'search'
  tab?: string
  keyword?: string
  limit: number
  action: 'greet' | 'collect' | 'none'
}

export type RunPlan = {
  batch_size: number
  dry_run: boolean
  confirm_filters: boolean
  // 列表公司关/职位关每次喂给 LLM 的人数(小片+并发);缺省走代码默认 5
  gate_chunk_size?: number
  tasks: RunPlanTask[]
}

export type CriteriaData = {
  hard: CriteriaHard
  education_preference: CriteriaEduPref
  company_preference: CriteriaCompanyPref
  job_content_preference: CriteriaJobContent
  talent_analyzer_preference: CriteriaTalent
  decision: CriteriaDecision
  run_plan: RunPlan
}

export const DEFAULT_CRITERIA: CriteriaData = {
  hard: {
    edu_levels_allowed: ['本科', '硕士'],
    age_max: 35,
    exp_years_min: 1,
    exp_years_max: 4,
    city_in: ['北京'],
    require_985_or_211: true,
    forbid_overseas_edu: true,
    forbid_tags: [],
    forbid_companies_current_only: [],
    forbid_company_types: [],
    allow_companies: []
  },
  education_preference: {
    prefer_985: true,
    prefer_211: true,
    prefer_qs500: false,
    prefer_overseas: false,
    prefer_majors: [],
    avoid_majors: [],
    notes: ''
  },
  company_preference: {
    big_company_required: false,
    preferred_company_types: [],
    preferred_industries: [],
    notes: ''
  },
  job_content_preference: {
    role_summary: '',
    evaluation_rules: [],
    must_be: [],
    must_not_be: [],
    strong_plus: [],
    minus: [],
    title_allow_keywords: [],
    title_block_keywords: [],
    notes: ''
  },
  talent_analyzer_preference: {
    preferred_company_size: null,
    require_strong_intent: false,
    notes: ''
  },
  decision: {
    pass_score: 7,
    bias: 'balanced',
    action_on_pass: '打招呼',
    action_on_fail: '关闭看下一个',
    uncertain_band: [5, 7]
  },
  run_plan: {
    batch_size: 30,
    dry_run: false,
    confirm_filters: true,
    gate_chunk_size: 5,
    tasks: [
      { enabled: true, page: 'recommend', tab: 'recommend', limit: 30, action: 'greet' }
    ]
  }
}

export const DEFAULT_FILTERS: FilterSettings = {
  degrees: [],
  useDegreeRange: false,
  degreeMin: 5, // 本科
  degreeMax: 7, // 博士
  schools: [],
  onlyFirstDegree: false,
  experiences: [],
  ageMin: 22,
  ageMax: 35,
  gender: '不限',
  salaryMinK: 0,
  salaryMaxK: 0,
  activeness: '不限',
  jobHopFrequency: '不限',
  jobStatuses: [],
  city: '北京',
  custom: {}
}

// 每个项目把筛选拆成两套:推荐页一套、搜索页一套;再加一个搜索词
export type FilterSection = 'recommend' | 'search'
export type ProjectFilters = {
  recommend: FilterSettings
  search: FilterSettings
  searchKeywords: string[] // 搜索词支持多个,一行一个
}
export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  recommend: { ...DEFAULT_FILTERS },
  search: { ...DEFAULT_FILTERS },
  searchKeywords: []
}

export type BrowserStatus = {
  launched: boolean
  url: string
  loggedIn: boolean
  cardCount: number
}

export type LogEntry = {
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug'
  msg: string
}

export type RunMode = 'idle' | 'running' | 'paused' | 'stopping'

export type RunStats = {
  mode: RunMode
  scanned: number
  flushed: number
  checked: number
  collected: number
  rejected: number
  errors: number
  seenSize: number
  llmReady: boolean
  llmModel: string
  lastNote: string
  // 当前 YAML 运行计划 + 安全状态的人读摘要,供界面如实显示(避免界面开关与实际脱节的误解)
  planSummary: string
}

export type ProbeResult = {
  attempted: string[] // 试过的选择器列表
  hits: { selector: string; sampleText: string; len: number }[]
  topUrl: string
  iframes: { name: string; url: string }[]
}

// 多项目:index.json 只存项目元信息(meta);每个项目的 criteria/filters 存各自文件
export type ProjectMeta = {
  id: string
  name: string
  notes: string
  archived: boolean
}
export type ProjectsIndex = {
  version: number
  activeProjectId: string
  projects: ProjectMeta[]
}

// 给界面用的项目状态(列表 + 当前项目 id)
export type ProjectsState = {
  projects: ProjectMeta[]
  activeId: string
}
