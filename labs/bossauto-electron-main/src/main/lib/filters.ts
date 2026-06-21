// 项目级筛选条件(推荐 + 搜索两套 + 搜索词)单例,落盘到当前项目的 filters.json
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_FILTERS,
  DEFAULT_PROJECT_FILTERS,
  type FilterSection,
  type FilterSettings,
  type ProjectFilters
} from '../../shared/ipc'
import { getActiveFiltersPath, getActiveProjectId } from './projects'
import { log } from './logger'

// 内部状态:整套项目筛选(推荐/搜索/搜索词);按项目失效缓存
let current: ProjectFilters = clone(DEFAULT_PROJECT_FILTERS)
let loadedProjectId: string | null = null

// 深拷贝一套项目筛选,避免外部引用同一对象造成串改
function clone(pf: ProjectFilters): ProjectFilters {
  return {
    recommend: { ...pf.recommend },
    search: { ...pf.search },
    searchKeywords: [...pf.searchKeywords]
  }
}

// 无损迁移:把任意磁盘数据规整成 ProjectFilters
// - 新结构(已有 recommend 字段):各 section 用默认值兜底合并,搜索词按下面 readKeywords 规则迁移
// - 旧结构(单一 FilterSettings,没有 recommend):同一份值同时作为 recommend 和 search(各自独立拷贝)
function normalize(data: unknown): ProjectFilters {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.recommend && typeof d.recommend === 'object') {
    return {
      recommend: { ...DEFAULT_FILTERS, ...(d.recommend as Partial<FilterSettings>) },
      search: { ...DEFAULT_FILTERS, ...((d.search as Partial<FilterSettings>) ?? {}) },
      searchKeywords: readKeywords(d)
    }
  }
  // 旧的单一 FilterSettings:推荐和搜索都用这份旧值
  const legacy = { ...DEFAULT_FILTERS, ...(d as Partial<FilterSettings>) }
  return {
    recommend: { ...legacy },
    search: { ...legacy },
    searchKeywords: []
  }
}

// 搜索词无损迁移:
// - 新结构有数组 searchKeywords 就用(过滤成非空字符串数组)
// - 否则有旧的单个字符串 searchKeyword 且非空,转成 [那个]
// - 都没有则 []
function readKeywords(d: Record<string, unknown>): string[] {
  if (Array.isArray(d.searchKeywords)) {
    return d.searchKeywords.filter((k): k is string => typeof k === 'string')
  }
  if (typeof d.searchKeyword === 'string' && d.searchKeyword) {
    return [d.searchKeyword]
  }
  return []
}

async function ensureLoaded(): Promise<void> {
  const activeId = await getActiveProjectId()
  // 项目没变就用缓存;切项目自动重读对应项目的 filters
  if (loadedProjectId === activeId) return
  loadedProjectId = activeId
  current = clone(DEFAULT_PROJECT_FILTERS)
  const p = await getActiveFiltersPath()
  if (!existsSync(p)) return
  try {
    const raw = await readFile(p, 'utf8')
    current = normalize(JSON.parse(raw))
  } catch (e) {
    log.warn(`filters.json 读取失败:${(e as Error).message}`)
  }
}

// 原子落盘:先写 .tmp 再 rename;项目目录可能不存在,先建目录
async function persist(): Promise<void> {
  const p = await getActiveFiltersPath()
  try {
    await mkdir(path.dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
    await rename(tmp, p)
  } catch (e) {
    log.warn(`filters.json 写入失败:${(e as Error).message}`)
  }
}

export async function getProjectFilters(): Promise<ProjectFilters> {
  await ensureLoaded()
  return clone(current)
}

// 合并补丁到指定 section(推荐/搜索),落盘后返回深拷贝
export async function setSectionFilters(
  section: FilterSection,
  patch: Partial<FilterSettings>
): Promise<ProjectFilters> {
  await ensureLoaded()
  current = { ...current, [section]: { ...current[section], ...patch } }
  await persist()
  return clone(current)
}

// 设置搜索词(多个,一行一个),落盘后返回深拷贝
export async function setSearchKeywords(kws: string[]): Promise<ProjectFilters> {
  await ensureLoaded()
  current = { ...current, searchKeywords: kws }
  await persist()
  return clone(current)
}

// 取某个 section 的筛选条件(给应用筛选用)
export async function getSectionFilters(section: FilterSection): Promise<FilterSettings> {
  await ensureLoaded()
  return { ...current[section] }
}

// 把指定 section 的筛选条件描述成一段人话(给日志/对话面板用)
export async function describeForApply(section: FilterSection): Promise<string> {
  const f = await getSectionFilters(section)
  const degreeStr = f.useDegreeRange
    ? `等级${f.degreeMin}-${f.degreeMax}`
    : f.degrees.join('/') || '不限'
  const parts = [
    `学历:${degreeStr}`,
    `院校:${f.schools.join('/') || '不限'}`,
    `经验:${f.experiences.join('/') || '不限'}`,
    `年龄:${f.ageMin}-${f.ageMax}`,
    `性别:${f.gender}`
  ]
  if (f.salaryMinK > 0 || f.salaryMaxK > 0) parts.push(`薪资:${f.salaryMinK}-${f.salaryMaxK}K`)
  if (f.activeness !== '不限') parts.push(`活跃度:${f.activeness}`)
  if (f.jobHopFrequency !== '不限') parts.push(`跳槽频率:${f.jobHopFrequency}`)
  if (f.jobStatuses.length) parts.push(`求职状态:${f.jobStatuses.join('/')}`)
  if (f.onlyFirstDegree) parts.push('只看第一学历')
  const customKeys = Object.keys(f.custom).filter((k) => f.custom[k])
  for (const k of customKeys) parts.push(`${k}:${f.custom[k]}`)
  return parts.join(' | ')
}
