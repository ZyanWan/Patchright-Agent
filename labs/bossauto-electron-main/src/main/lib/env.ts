// 加载 .env:先看项目根的 .env(本仓库自有),再向上找一级 my_project/.env(共享凭证)
// dotenv 默认行为是不覆盖已存在的 env,所以两者并存时本地优先。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import dotenv from 'dotenv'
import { log } from './logger'

export function loadDotEnvs(): void {
  // electron 中 app.getAppPath() 在 dev/prod 都指向 app 根
  const appRoot = app.getAppPath()
  const candidates = [
    path.join(appRoot, '.env'),
    path.join(appRoot, '..', '.env'),
    path.join(appRoot, '..', '..', '.env'),
    // 兜底:用户机器上固定位置
    'C:/Users/test/my_project/.env'
  ]
  const loaded: string[] = []
  for (const file of candidates) {
    if (existsSync(file) && !loaded.includes(file)) {
      const r = dotenv.config({ path: file, override: false })
      if (!r.error) loaded.push(file)
    }
  }
  if (loaded.length === 0) {
    log.warn('未找到任何 .env;LLM/外部服务将不可用')
    return
  }
  for (const f of loaded) log.info(`.env 已加载:${f}`)
  const have = (k: string) => (process.env[k] ? '✓' : '✗')
  log.info(
    `凭证检查: DEEPSEEK${have('DEEPSEEK_API_KEY')} ` +
      `OPENROUTER${have('OPENROUTER_API_KEY')} ` +
      `SILICONFLOW${have('SILICONFLOW_API_KEY')} ` +
      `DOUBAO${have('DOUBAO_API_KEY')} ` +
      `ZHIPU${have('ZHIPU_API_KEY')} ` +
      `ANTHROPIC${have('ANTHROPIC_API_KEY')}`
  )
}
