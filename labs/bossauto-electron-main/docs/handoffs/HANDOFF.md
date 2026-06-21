# 项目交接说明

## 当前状态

- 项目路径：`<workspace>\bossauto-electron`
- 当前分支：`codex/config-driven-screening-runner`
- 远端仓库：`https://github.com/wxkawxk/bossauto-electron.git`
- 当前分支已推送到远端。
- 最近提交：
  - `8439622 Clarify company gate rules`
  - `6c1d832 Refactor screening runner to use YAML run plan`
- 最近已验证：`npm run typecheck` 通过。
- Claude review 尚未完成：`claude -p` 返回 403，`claude ultrareview origin/main` 返回 `Access denied for upload`。

## 项目用途

这是一个 BOSS 直聘简历筛选 Electron 工具。

核心目标：

- 在 BOSS 推荐/搜索列表页抓取候选人卡片。
- 先做列表页筛选，必要时打开详情页读取简历正文。
- 用 LLM 按配置判断是否合适。
- 对合适的人执行收藏或打招呼。
- 记录已看、已联系、已收藏的人，避免重复处理。

## 重要文件

- `src/main/lib/runner.ts`：主筛选流程、列表扫描、批处理、打开详情、动作执行。
- `src/main/lib/judge.ts`：确定性硬筛和候选人 key 生成。
- `src/main/lib/llm.ts`：DeepSeek/OpenAI 兼容调用、公司关、职位关、详情判断。
- `src/main/lib/seen-log.ts`：已看/已联系/已收藏记录。
- `src/main/lib/browser.ts`：浏览器连接与 BOSS 页面处理。
- `src/shared/ipc.ts`：配置类型与默认配置。
- `src/renderer/src/Criteria.tsx`：配置界面。
- 运行时配置：`%AppData%\bossauto-electron\criteria.yaml`
- 运行日志/记录：`%AppData%\bossauto-electron\screening-runs*.json`

## 当前业务规则

业务规则应主要放在 YAML，不要硬编码到代码里。

当前最近口径如下：

- 硬筛只看工作年限和学校。
- 列表页处理顺序：硬筛 -> 公司关 -> 职位关 -> 必要时打开详情。
- 公司不过，就不再看职位，也不打开详情。
- 职位明确不相关，不打开详情。
- 职位拿不准，打开详情。
- 详情页再判断真实工作内容是否符合短视频要求。
- 拿不准的候选人，应偏向继续看详情，而不是直接拒绝。

公司规则：

- 所有互联网大厂/中厂，除字节、快手、小红书外过滤。
- 过滤示例：阿里、腾讯、美团、京东、拼多多、B 站、百度、搜狐、携程、微博、网易、滴滴、知乎、爱奇艺、优酷、蚂蚁/支付宝、小米等。
- Keep 这类小规模垂直互联网公司，不因“互联网公司”直接过滤。
- 政府、事业单位都不要，包括官方媒体、出版社、高校、研究院、报社、电视台/广播台等。
- 偏好新媒体/自媒体、MCN、教育、电商，以及其他需要频繁做视频、依赖视频获客或靠视频获得收入的公司。
- 公司偏好不是硬拒绝条件；拿不准要放过。

职位/内容规则：

- 只要是做短视频的都可以，平台不限。
- 只做图文不行。
- 需要偏亲手做短视频内容，例如脚本、拍摄、剪辑、发布、复盘。
- 纯投放、纯社群、产品运营、数据标注、纯文案、公众号/图文为主、只管达人或乙方的不要。
- “个人优势”目前不作为独立 gate；如果要用，只能作为列表可见的明确短视频证据，需先和用户确认。

去重/跳过规则：

- 去重只看姓名 + 学校 + 专业。
- 列表显示“继续沟通 / 已沟通 / 已联系 / 已打招呼”的人应直接跳过。
- 联系过、收藏过的记录不能误清空。

## 已完成的主要改动

- `run_plan` 已加入配置类型，筛选任务由 YAML 驱动。
- `runner.ts` 已按 YAML tasks 执行推荐/搜索任务，支持 tab、keyword、limit、action、batch_size。
- 列表处理改为批量 30 人左右：硬筛后先公司关，再职位关，再打开详情。
- 硬筛改为只看工作年限和学校。
- 去重 key 改为姓名 + 学校 + 专业。
- 列表中已沟通/继续沟通的人会跳过。
- 公司关和职位关使用强制 JSON 输出，`max_tokens` 提高到 5000。
- 公司关提示已改为按 YAML 的 `hard.forbid_companies_current_only`、`hard.forbid_company_types`、`company_preference` 执行。
- 浏览器连接已有 BOSS 页面时，不再强制跳到搜索页，避免打断当前页面和登录状态。
- 运行时 YAML 已写入最新公司规则。

## 当前运行时 YAML 状态

路径：`%AppData%\bossauto-electron\criteria.yaml`

当前关键配置：

- `run_plan.batch_size: 30`
- `run_plan.dry_run: true`
- `run_plan.tasks` 当前是推荐页、推荐 tab、limit 30、action greet。
- `hard.forbid_company_types` 已包含最新公司过滤口径。
- `company_preference` 已包含偏好公司方向。

注意：

- 这个 YAML 在 AppData，不在仓库里。
- 这是目前最大可复现性风险：换机器、重装、清配置后会丢业务规则。
- 更稳的做法是：仓库内放一份默认 `criteria.example.yaml` 或默认业务配置模板，AppData 作为运行时副本。

## 已知问题和风险

1. Claude review 未完成。
   - 原因：Claude CLI 登录状态显示正常，但实际请求返回 403；`ultrareview` 上传也被拒。
   - 风险：缺少外部 review。

2. 详情读取很慢。
   - 之前 dry-run 打开 6 个详情约 20 分钟，平均约 3 分 20 秒/人。
   - 日志显示 canvas hook 未抓到正文，退回鼠标拖选复制。
   - 风险：不能直接跑 1000 + 1000，大批量会非常慢且更容易错位。

3. 公司规则目前依赖运行时 YAML。
   - 代码流程已收敛，但业务规则不在仓库。
   - 风险：换环境不可复现。

4. 职位关不看个人优势。
   - 例如李筱的“短视频脚本”等信息来自优势字段，不是职位/经历标题。
   - 当前规则下职位关可能看不到这类证据。
   - 是否允许提取优势里的明确短视频证据，需要用户拍板。

5. 大批量真实打招呼前需要再 dry-run。
   - 尤其要确认：公司关是否按最新口径拒绝/放行，职位拿不准是否打开详情，已沟通是否跳过，详情关闭后是否回到正确卡片。

## 建议下一步

1. 先让 Claude 或另一个 AI 做只读 review。
   - 主审代码是否正确读取 YAML、执行流程、失败保守策略、去重和浏览器自动化。
   - 辅审运行时 YAML 字段是否与代码匹配。

2. 修复详情读取慢的问题。
   - 优先查 canvas hook 为什么未生效。
   - 目标是恢复直接抓正文，而不是鼠标拖选复制。

3. 把默认业务配置模板放进仓库。
   - 建议新增 `criteria.example.yaml` 或类似文件。
   - 不提交密钥、账号、个人状态、运行记录。

4. 做一轮 30 人 dry-run。
   - 输出每个人在列表页的顺序、硬筛/公司/职位/详情结果和原因。
   - 重点核对公司关：微博、搜狐、百度、美团等是否按规则处理。

5. dry-run 没问题后，再决定是否跑 1000 推荐 + 1000 最新。

## 给下一个 AI 的提醒

- 全程中文，少贴代码和长日志。
- 不要改用户当前打开的 BOSS 页面，避免登录状态丢失。
- 不要清空联系过、收藏过的记录。
- 不要把密钥、token、env、AppData 里的个人状态提交进仓库。
- 修改代码后默认 `npm run typecheck`，小步提交并 push 当前分支。
- 如果需要改业务规则，优先改 YAML；代码只负责稳定执行配置。
