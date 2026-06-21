// seen 记录拆成两层:
//  1) 全局「已联系保护」contacted.json(跨项目共享):decision 为 '打招呼'/'收藏' 的记录,
//     换了项目也不能对同一个人重复打招呼/收藏。
//  2) 项目级「评估记录」projects/<activeId>/seen.json(各项目独立):其它 decision
//     (刷/不要/check/skip 等"看过/判定")只在当前项目内去重。
// 首次启动自动从旧 userData/seen_log.json 按 decision 分流导入,不删旧文件作兜底。
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { paths } from './paths'
import { getActiveProjectId } from './projects'
import { log } from './logger'

export type SeenEntry = {
  d: '收藏' | '刷' | '不要' | 'skip' | string
  r: string
  ts: number
}

export type SeenLog = Record<string, SeenEntry>

// decision 落到全局 contacted 的判定:打招呼/收藏属"已联系",需跨项目保护
const CONTACTED_DECISIONS = ['打招呼', '收藏']
function isContacted(decision: SeenEntry['d']): boolean {
  return CONTACTED_DECISIONS.includes(decision)
}

// ---- 路径推导 ----
// userData 根目录由 projectsDir 的父级推导(paths.projectsDir() = userData/projects)
function userDataDir(): string {
  return path.dirname(paths.projectsDir())
}
function contactedPath(): string {
  return path.join(userDataDir(), 'contacted.json')
}
function projectSeenPath(id: string): string {
  return path.join(paths.projectsDir(), id, 'seen.json')
}

// ---- 两层缓存 ----
// 全局 contacted:进程内只读一次
let contactedCache: SeenLog | null = null
let contactedFailed = false
// 项目 seen:随 activeId 变化失效重读(记录当前缓存对应的项目 id)
let projectCache: SeenLog | null = null
let projectCacheId: string | null = null
let projectFailed = false

// 读 JSON:文件不存在=空库(正常起点);存在但读/解析失败必须抛出,
// 绝不当空库返回——否则随后写入会用空对象覆盖,清空历史 → 重复打招呼。
async function readJson(file: string): Promise<SeenLog> {
  if (!existsSync(file)) return {}
  const raw = await readFile(file, 'utf8')
  const data = JSON.parse(raw)
  if (typeof data !== 'object' || data === null) {
    throw new Error(`${path.basename(file)} 内容不是合法对象`)
  }
  // 兼容旧 collected 列表格式
  if ('collected' in data && Array.isArray((data as { collected: unknown }).collected)) {
    const out: SeenLog = {}
    for (const item of (data as { collected: Array<{ key: string; reason?: string }> })
      .collected) {
      out[item.key] = { d: '收藏', r: item.reason || '', ts: 0 }
    }
    return out
  }
  return data as SeenLog
}

// 原子写:先写临时文件再 rename 覆盖,避免写一半崩溃导致文件损坏
async function writeJson(file: string, data: SeenLog): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

// ---- 旧 seen_log.json 一次性分流迁移 ----
// 首次(目标新文件都不存在)若旧 userData/seen_log.json 存在,把旧记录原样分流:
//   打招呼/收藏 → contacted.json;其余 → 默认项目 projects/default/seen.json。
// 不解析、不重写内容,只按 decision 归类;保留旧 seen_log.json 不删作兜底。
let migrateDone = false
async function migrateLegacyOnce(): Promise<void> {
  if (migrateDone) return
  migrateDone = true
  const legacy = paths.seenLog()
  const contactedFile = contactedPath()
  const defaultSeenFile = projectSeenPath('default')
  // 任一目标已存在则视为已迁移过,不再覆盖
  if (existsSync(contactedFile) || existsSync(defaultSeenFile)) return
  if (!existsSync(legacy)) return
  let old: SeenLog
  try {
    old = await readJson(legacy)
  } catch (e) {
    // 旧文件损坏:跳过迁移,不阻断后续(两层各自从空库开始)
    log.warn(`旧 seen_log 迁移读取失败,跳过迁移:${(e as Error).message}`)
    return
  }
  const contacted: SeenLog = {}
  const projectSeen: SeenLog = {}
  for (const [k, v] of Object.entries(old)) {
    if (isContacted(v?.d)) contacted[k] = v
    else projectSeen[k] = v
  }
  try {
    await writeJson(contactedFile, contacted)
    await writeJson(defaultSeenFile, projectSeen)
    log.info(
      `已从旧 seen_log 分流迁移:contacted ${Object.keys(contacted).length} 条,` +
        `默认项目 seen ${Object.keys(projectSeen).length} 条(旧文件保留)`
    )
  } catch (e) {
    log.warn(`旧 seen_log 分流写入失败:${(e as Error).message}`)
  }
}

// ---- 加载两层 ----
async function loadContacted(): Promise<SeenLog> {
  if (contactedCache) return contactedCache
  await migrateLegacyOnce()
  try {
    contactedCache = await readJson(contactedPath())
    contactedFailed = false
  } catch (e) {
    contactedFailed = true
    log.error(`contacted 读取失败,已停止写入以保护历史:${(e as Error).message}`)
    throw new Error(`contacted 读取失败,为保护历史已中止:${(e as Error).message}`)
  }
  log.info(`contacted 加载 ${Object.keys(contactedCache).length} 条`)
  return contactedCache
}

async function loadProjectSeen(): Promise<SeenLog> {
  await migrateLegacyOnce()
  const id = await getActiveProjectId()
  // 项目切换:缓存对应的不是当前项目时,失效重读
  if (projectCache && projectCacheId === id) return projectCache
  try {
    const data = await readJson(projectSeenPath(id))
    projectCache = data
    projectCacheId = id
    projectFailed = false
  } catch (e) {
    projectFailed = true
    log.error(`项目 seen 读取失败,已停止写入以保护历史:${(e as Error).message}`)
    throw new Error(`项目 seen 读取失败,为保护历史已中止:${(e as Error).message}`)
  }
  log.info(`项目 ${id} seen 加载 ${Object.keys(projectCache).length} 条`)
  return projectCache
}

// 对外保留:整体视图 = 全局 contacted + 当前项目 seen(合并)。
// 历史上 loadSeen 返回"全部记录",这里维持等价语义(两层合并)。
export async function loadSeen(): Promise<SeenLog> {
  const contacted = await loadContacted()
  const projectSeen = await loadProjectSeen()
  // contacted 优先(已联系保护更强),其余用项目记录补齐
  return { ...projectSeen, ...contacted }
}

// 对外保留:把两层各自写回(只写已成功加载、未标记失败的层)
export async function saveSeen(): Promise<void> {
  if (contactedCache && !contactedFailed) {
    await writeJson(contactedPath(), contactedCache)
  }
  if (projectCache && projectCacheId && !projectFailed) {
    await writeJson(projectSeenPath(projectCacheId), projectCache)
  }
}

export async function markSeen(
  key: string,
  decision: SeenEntry['d'],
  reason: string
): Promise<void> {
  const entry: SeenEntry = { d: decision, r: reason, ts: Math.floor(Date.now() / 1000) }
  if (isContacted(decision)) {
    // 打招呼/收藏 → 全局 contacted(跨项目保护)
    const contacted = await loadContacted()
    contacted[key] = entry
    if (!contactedFailed) await writeJson(contactedPath(), contacted)
  } else {
    // 刷/不要/check/skip 等 → 当前项目 seen
    const projectSeen = await loadProjectSeen()
    projectSeen[key] = entry
    if (!projectFailed && projectCacheId) {
      await writeJson(projectSeenPath(projectCacheId), projectSeen)
    }
  }
}

export async function hasSeen(key: string): Promise<boolean> {
  const contacted = await loadContacted()
  if (key in contacted) return true
  const projectSeen = await loadProjectSeen()
  return key in projectSeen
}

export async function hasSeenCandidate(key: string, name: string): Promise<boolean> {
  const contacted = await loadContacted()
  const projectSeen = await loadProjectSeen()
  // 全局已联系命中 → 跳过(打招呼/收藏跨项目保护)
  if (key in contacted) return true
  // 当前项目已看过命中 → 跳过;但 d='check'(详情读取失败/姓名核对不过等"没真正判定过")
  // 不算看过,放行下次重看 —— 避免一次失败就把人永久跳过(历史里的失败记录也随之自动失效)。
  const pv = projectSeen[key]
  if (pv && pv.d !== 'check') return true
  // 兼容历史坏 key:早期学校/专业没解析出来时会写成 "姓名||"。
  // 新记录仍只按 "姓名|学校|专业" 写入和去重。两层都查。
  const legacyKey = `${name}||`
  if (legacyKey in contacted && ['收藏', '打招呼', 'skip'].includes(contacted[legacyKey]?.d)) {
    return true
  }
  if (legacyKey in projectSeen && ['收藏', '打招呼', 'skip'].includes(projectSeen[legacyKey]?.d)) {
    return true
  }
  return false
}

export async function seenSize(): Promise<number> {
  const contacted = await loadContacted()
  const projectSeen = await loadProjectSeen()
  // 当前项目 seen 条数 + 全局 contacted 条数合计
  return Object.keys(projectSeen).length + Object.keys(contacted).length
}
