// criteria.yaml 读写 + 结构化访问
// - loadCriteria(): 返回原始字符串(给 LLM)
// - readCriteriaData(): 解析为结构化对象(给 UI)
// - writeCriteriaData(): 写回 yaml,保存前自动备份
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { DEFAULT_CRITERIA, type CriteriaData } from '../../shared/ipc'
import { getActiveCriteriaPath, getActiveProjectId } from './projects'
import { log } from './logger'

let rawCache: string | null = null
let cachedProjectId: string | null = null

export async function loadCriteria(): Promise<string> {
  const activeId = await getActiveProjectId()
  // 项目没变且有缓存才复用;切到别的项目会自动重读(等效缓存失效)
  if (rawCache !== null && cachedProjectId === activeId) return rawCache
  cachedProjectId = activeId
  const target = await getActiveCriteriaPath()
  if (!existsSync(target)) {
    log.warn(`criteria.yaml 缺失 (${target})`)
    rawCache = ''
    return ''
  }
  rawCache = await readFile(target, 'utf8')
  log.info(`criteria.yaml 已加载 ${rawCache.length} 字符`)
  return rawCache
}

export function resetCriteriaCache(): void {
  rawCache = null
  cachedProjectId = null
}

function mergeDeep<T>(base: T, patch: Partial<T>): T {
  if (!patch || typeof patch !== 'object') return base
  const out = { ...(base as object) } as Record<string, unknown>
  const p = patch as Record<string, unknown>
  for (const k of Object.keys(p)) {
    const v = p[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeDeep((out[k] || {}) as object, v as object)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export async function readCriteriaData(): Promise<CriteriaData> {
  const raw = await loadCriteria()
  if (!raw) return { ...DEFAULT_CRITERIA }
  try {
    const parsed = yaml.load(raw) as Partial<CriteriaData>
    return mergeDeep(DEFAULT_CRITERIA, parsed || {})
  } catch (e) {
    log.warn(`criteria.yaml 解析失败,使用默认值:${(e as Error).message}`)
    return { ...DEFAULT_CRITERIA }
  }
}

export async function writeCriteriaData(data: CriteriaData): Promise<void> {
  const target = await getActiveCriteriaPath()
  await mkdir(path.dirname(target), { recursive: true })
  if (existsSync(target)) {
    const ts = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14)
    const bak = `${target}.bak.${ts}`
    try {
      await copyFile(target, bak)
      log.info(`criteria 已备份到 ${bak}`)
    } catch (e) {
      log.warn(`备份失败,但继续保存:${(e as Error).message}`)
    }
  }
  const dumped = yaml.dump(data, {
    sortKeys: false,
    lineWidth: 200,
    noRefs: true,
    quotingType: '"'
  })
  await writeFile(target, dumped, 'utf8')
  rawCache = dumped
  cachedProjectId = await getActiveProjectId()
  log.info(`criteria.yaml 已保存(${dumped.length} 字符,原注释已被结构化数据覆盖)`)
}
