import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// dev 时 __dirname 指向 out/main/,prod 时指向打包路径
// 我们把用户数据放在 app.getPath('userData') 下,profile/seen_log 都放那
const userData = () => app.getPath('userData')

export const paths = {
  chromeProfile: () => path.join(userData(), 'chrome-profile'),
  seenLog: () => path.join(userData(), 'seen_log.json'),
  criteriaYaml: () => path.join(userData(), 'criteria.yaml'),
  // 多项目配置根目录:userData/projects/<id>/{criteria.yaml,filters.json} + index.json
  projectsDir: () => path.join(userData(), 'projects'),
  // 兼容旧 bossauto/ 目录的 seen_log.json + criteria.yaml,首次启动从这导入
  legacySeenLog: path.resolve('C:/Users/test/my_project/bossauto/seen_log.json'),
  legacyCriteria: path.resolve('C:/Users/test/my_project/bossauto/criteria.yaml')
}

// 让 TS 知道 fileURLToPath 被引用了(不然 lint 报错)
export const __sentinel = fileURLToPath
