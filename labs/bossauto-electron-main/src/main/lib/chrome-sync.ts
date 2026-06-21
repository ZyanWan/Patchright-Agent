// 把用户日常 Chrome 的登录态(Cookies + Local Storage + Session Storage + IndexedDB)
// 同步到 patchright 的 chrome-profile,用于 BOSS 单点登录被挤掉后快速恢复。
//
// 步骤:
// 1) 关掉所有 chrome.exe(否则 Cookies SQLite 文件被锁)
// 2) 关掉 patchright Chromium(避免目标文件被锁)
// 3) 复制几个关键目录,覆盖
// 4) 返回提示
import { spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { closeBrowser } from './browser'
import { log } from './logger'

function defaultChromeProfile(): string {
  const local = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(local, 'Google', 'Chrome', 'User Data', 'Default')
}

function patchrightProfileDefault(): string {
  return path.join(app.getPath('userData'), 'chrome-profile', 'Default')
}

async function killChromeProcesses(): Promise<void> {
  await new Promise<void>((resolve) => {
    const p = spawn('taskkill', ['/F', '/IM', 'chrome.exe', '/T'], { shell: false })
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
  await new Promise((r) => setTimeout(r, 800))
}

function copyIfExists(src: string, dst: string): { copied: boolean; bytes: number } {
  if (!existsSync(src)) return { copied: false, bytes: 0 }
  const st = statSync(src)
  mkdirSync(path.dirname(dst), { recursive: true })
  if (st.isDirectory()) {
    cpSync(src, dst, { recursive: true, force: true, errorOnExist: false })
    return { copied: true, bytes: 0 }
  }
  copyFileSync(src, dst)
  return { copied: true, bytes: st.size }
}

export async function syncChromeLogin(): Promise<{
  ok: boolean
  message: string
  details: Record<string, unknown>
}> {
  const src = defaultChromeProfile()
  const dst = patchrightProfileDefault()
  if (!existsSync(src)) {
    return {
      ok: false,
      message: `没找到 Chrome 默认 profile:${src}`,
      details: {}
    }
  }
  log.info(`[chrome-sync]src=${src}`)
  log.info(`[chrome-sync]dst=${dst}`)

  // 关 patchright Chromium(主进程持有的)
  try {
    await closeBrowser()
  } catch (e) {
    log.warn(`[chrome-sync]closeBrowser 异常(可忽略):${(e as Error).message}`)
  }
  // 关用户 Chrome
  await killChromeProcesses()

  // 关键:Local State 在 User Data 父目录(不在 Default 里),里面有 os_crypt.encrypted_key
  // 没它 patchright 的 Chromium 解不开 Chrome 加密过的 cookies
  const srcParent = path.dirname(src)
  const dstParent = path.dirname(dst)
  const items: Array<[string, string]> = [
    [path.join(srcParent, 'Local State'), path.join(dstParent, 'Local State')],
    [path.join(src, 'Network', 'Cookies'), path.join(dst, 'Network', 'Cookies')],
    [
      path.join(src, 'Network', 'Cookies-journal'),
      path.join(dst, 'Network', 'Cookies-journal')
    ],
    [path.join(src, 'Local Storage'), path.join(dst, 'Local Storage')],
    [path.join(src, 'Session Storage'), path.join(dst, 'Session Storage')]
  ]
  const report: Record<string, unknown> = {}
  for (const [s, d] of items) {
    try {
      const r = copyIfExists(s, d)
      report[path.relative(src, s)] = r.copied ? `✓ ${r.bytes || 'dir'}` : '× 源不存在'
    } catch (e) {
      report[path.relative(src, s)] = `× ${(e as Error).message}`
      log.warn(`[chrome-sync]复制失败 ${s} → ${d}:${(e as Error).message}`)
    }
  }
  log.info(`[chrome-sync]完成:${JSON.stringify(report)}`)
  return {
    ok: true,
    message: '已从 Chrome 同步登录态。请点"启动 Chromium"看是否免扫码进 BOSS。',
    details: report
  }
}
