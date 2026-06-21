// 运行时设置(内存单例,不落盘)
// 已移除界面"模拟模式":运行时默认真发(dryRun=false、doGreet=true)。
// 仍保留配置级兜底——criteria.run_plan.dry_run=true 时 isDryRun 仍只判定不点击(供调试,界面不暴露)。
import type { RunSettings } from '../../shared/ipc'

let settings: RunSettings | null = null

function init(): RunSettings {
  return {
    dryRun: false,
    doCollect: true,
    doGreet: true
  }
}

export function getSettings(): RunSettings {
  if (!settings) settings = init()
  return { ...settings }
}

export function updateSettings(patch: Partial<RunSettings>): RunSettings {
  if (!settings) settings = init()
  Object.assign(settings, patch)
  return { ...settings }
}
