// 多项目配置层。
// 每个项目独立存:userData/projects/<id>/criteria.yaml + filters.json。
// userData/projects/index.json 管项目列表(meta)+ 当前项目。
// 第1步原则:
//  - 无损迁移:首次把旧 userData/criteria.yaml + filters.json 原样复制成"默认项目",绝不解析后重写。
//  - 读失败保护:index.json 读/解析失败时抛错、不当空配置覆盖。
//  - 当前项目:criteria/filters 模块读时按 activeProjectId 取对应文件,切项目即自动生效。
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { paths } from './paths'
import { log } from './logger'
import type { ProjectMeta, ProjectsIndex } from '../../shared/ipc'

const DEFAULT_ID = 'default'

function userDataDir(): string {
  return path.dirname(paths.projectsDir())
}
function projectDir(id: string): string {
  return path.join(paths.projectsDir(), id)
}
export function projectCriteriaPath(id: string): string {
  return path.join(projectDir(id), 'criteria.yaml')
}
export function projectFiltersPath(id: string): string {
  return path.join(projectDir(id), 'filters.json')
}
function indexPath(): string {
  return path.join(paths.projectsDir(), 'index.json')
}

let cache: ProjectsIndex | null = null
let inflight: Promise<ProjectsIndex> | null = null

function genId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

async function readIndex(): Promise<ProjectsIndex | null> {
  if (!existsSync(indexPath())) return null
  // 存在但读/解析失败必须抛出,绝不当空配置返回(否则会覆盖掉项目列表)
  const raw = await readFile(indexPath(), 'utf8')
  const data = JSON.parse(raw) as ProjectsIndex
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    throw new Error('projects/index.json 结构异常')
  }
  return data
}

async function writeIndex(idx: ProjectsIndex): Promise<void> {
  await mkdir(paths.projectsDir(), { recursive: true })
  const tmp = indexPath() + '.tmp'
  await writeFile(tmp, JSON.stringify(idx, null, 2), 'utf8')
  await rename(tmp, indexPath())
  cache = idx
}

// 复用同一个迁移/加载 Promise:首启时多个并发 IPC(getCriteria/getFilters/...)会同时进来,
// 不串行化会并发复制 + 抢同一个 index.json.tmp,rename 后互相 ENOENT/EPERM 导致迁移失败。
async function ensureMigrated(): Promise<ProjectsIndex> {
  if (cache) return cache
  if (!inflight) {
    inflight = doMigrate().finally(() => {
      inflight = null
    })
  }
  return inflight
}

// 无损迁移:把旧的单项目配置原样复制进默认项目。优先 userData/criteria.yaml,兜底旧 bossauto 目录。
async function doMigrate(): Promise<ProjectsIndex> {
  const existing = await readIndex().catch((e) => {
    log.error(`projects/index.json 读取失败,已停止以保护配置:${(e as Error).message}`)
    throw new Error(`projects 配置读取失败,为保护配置已中止:${(e as Error).message}`)
  })
  if (existing) {
    cache = existing
    return existing
  }
  // 首次:建默认项目,原样复制旧配置(不解析、不重写)
  await mkdir(projectDir(DEFAULT_ID), { recursive: true })
  const criteriaSrc = existsSync(paths.criteriaYaml())
    ? paths.criteriaYaml()
    : existsSync(paths.legacyCriteria)
      ? paths.legacyCriteria
      : ''
  if (criteriaSrc && !existsSync(projectCriteriaPath(DEFAULT_ID))) {
    await copyFile(criteriaSrc, projectCriteriaPath(DEFAULT_ID)).catch((e) =>
      log.warn(`迁移 criteria 失败:${(e as Error).message}`)
    )
  }
  const filtersSrc = path.join(userDataDir(), 'filters.json')
  if (existsSync(filtersSrc) && !existsSync(projectFiltersPath(DEFAULT_ID))) {
    await copyFile(filtersSrc, projectFiltersPath(DEFAULT_ID)).catch((e) =>
      log.warn(`迁移 filters 失败:${(e as Error).message}`)
    )
  }
  const idx: ProjectsIndex = {
    version: 1,
    activeProjectId: DEFAULT_ID,
    projects: [{ id: DEFAULT_ID, name: '默认', notes: '', archived: false }]
  }
  await writeIndex(idx)
  log.info('已创建默认项目并无损迁移旧配置(原样复制)')
  return idx
}

export async function getActiveProjectId(): Promise<string> {
  return (await ensureMigrated()).activeProjectId
}
export async function getActiveCriteriaPath(): Promise<string> {
  return projectCriteriaPath(await getActiveProjectId())
}
export async function getActiveFiltersPath(): Promise<string> {
  return projectFiltersPath(await getActiveProjectId())
}

export async function listProjects(): Promise<ProjectMeta[]> {
  return (await ensureMigrated()).projects.filter((p) => !p.archived)
}

export async function setActiveProject(id: string): Promise<ProjectsIndex> {
  const idx = await ensureMigrated()
  if (!idx.projects.some((p) => p.id === id && !p.archived)) {
    throw new Error(`项目不存在或已归档:${id}`)
  }
  idx.activeProjectId = id
  await writeIndex(idx)
  return idx
}

// 新建空项目(criteria/filters 缺省,各模块读不到文件时用各自默认值)
export async function createProject(name: string, notes = ''): Promise<ProjectMeta> {
  const idx = await ensureMigrated()
  const meta: ProjectMeta = { id: genId(), name: name.trim() || '未命名项目', notes, archived: false }
  await mkdir(projectDir(meta.id), { recursive: true })
  idx.projects.push(meta)
  await writeIndex(idx)
  return meta
}

// 从已有项目复制一份(连同 criteria.yaml + filters.json 原样复制)
export async function duplicateProject(srcId: string, name: string): Promise<ProjectMeta> {
  const idx = await ensureMigrated()
  if (!idx.projects.some((p) => p.id === srcId)) throw new Error(`源项目不存在:${srcId}`)
  const meta: ProjectMeta = { id: genId(), name: name.trim() || '副本', notes: '', archived: false }
  await mkdir(projectDir(meta.id), { recursive: true })
  if (existsSync(projectCriteriaPath(srcId))) {
    await copyFile(projectCriteriaPath(srcId), projectCriteriaPath(meta.id))
  }
  if (existsSync(projectFiltersPath(srcId))) {
    await copyFile(projectFiltersPath(srcId), projectFiltersPath(meta.id))
  }
  idx.projects.push(meta)
  await writeIndex(idx)
  return meta
}

export async function renameProject(id: string, name: string, notes?: string): Promise<ProjectsIndex> {
  const idx = await ensureMigrated()
  const p = idx.projects.find((x) => x.id === id)
  if (!p) throw new Error(`项目不存在:${id}`)
  p.name = name.trim() || p.name
  if (typeof notes === 'string') p.notes = notes
  await writeIndex(idx)
  return idx
}

// 归档(不真删,保留文件作兜底)。不允许归档当前项目或最后一个未归档项目。
export async function archiveProject(id: string): Promise<ProjectsIndex> {
  const idx = await ensureMigrated()
  const p = idx.projects.find((x) => x.id === id)
  if (!p) throw new Error(`项目不存在:${id}`)
  const liveCount = idx.projects.filter((x) => !x.archived).length
  if (liveCount <= 1) throw new Error('至少保留一个项目')
  p.archived = true
  // 归档的是当前项目→自动切到另一个未归档项目
  if (idx.activeProjectId === id) {
    const next = idx.projects.find((x) => !x.archived)
    if (next) idx.activeProjectId = next.id
  }
  await writeIndex(idx)
  return idx
}
