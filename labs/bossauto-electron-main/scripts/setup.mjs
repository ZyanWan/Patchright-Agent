// 一键部署:把仓库里的默认筛选配置(config/)还原到运行时目录(%AppData%\bossauto-electron)。
// 安全原则:仅当运行时"还没有任何项目"时才部署,绝不覆盖已有配置/已看库。
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appData = process.env.APPDATA || join(process.env.HOME || '', 'AppData', 'Roaming')
const userData = join(appData, 'bossauto-electron')
const projectsDir = join(userData, 'projects')
const indexPath = join(projectsDir, 'index.json')

// 只看"配置痕迹"(多项目索引 / projects 目录 / 旧版单配置 criteria.yaml),不看 contacted/seen 等"记录":
// - 有配置痕迹 → 跳过,交给 app 自身无损迁移,避免抢先写索引导致旧配置不被迁移;
// - 只单独拷过来 contacted.json(防重复打招呼)而没有配置时 → 仍正常部署配置,不会降级。
const hasConfig =
  existsSync(indexPath) || existsSync(projectsDir) || existsSync(join(userData, 'criteria.yaml'))
if (hasConfig) {
  console.log('[setup] 运行时已有配置,跳过默认配置部署(交给应用自身迁移,不覆盖)。')
} else {
  const id = 'default' // 与 app 旧数据迁移用的项目 id 一致,避免历史 seen 落到未列出的项目
  const pdir = join(projectsDir, id)
  mkdirSync(pdir, { recursive: true })
  copyFileSync(join(root, 'config/criteria.default.yaml'), join(pdir, 'criteria.yaml'))
  const filtersSrc = join(root, 'config/filters.default.json')
  if (existsSync(filtersSrc)) copyFileSync(filtersSrc, join(pdir, 'filters.json'))
  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        version: 1,
        activeProjectId: id,
        projects: [{ id, name: '新媒体运营', notes: '', archived: false }]
      },
      null,
      2
    )
  )
  console.log(`[setup] 已部署默认配置(项目:新媒体运营)到 ${userData}`)
}

const envPath = join(root, '.env')
if (!existsSync(envPath)) {
  console.log('[setup] 下一步:复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY,然后运行 npm run dev(首次需扫码登录 BOSS)。')
}
