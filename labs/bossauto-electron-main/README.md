# bossauto-electron

> BOSS 直聘自动筛选简历工具。Electron + patchright(Playwright 分支)接管**真实 Chrome**,在推荐/搜索列表页按规则筛人,必要时打开详情读简历正文,用 LLM 判定后自动打招呼或收藏,并记录已看/已联系避免重复。

本文是项目总入口。部署见 [SETUP.md](SETUP.md);早期技术交接见 [docs/handoffs/HANDOFF.md](docs/handoffs/HANDOFF.md)、[docs/handoffs/CANVAS_RESUME_HANDOFF.md](docs/handoffs/CANVAS_RESUME_HANDOFF.md);协作约定见 [CLAUDE.md](CLAUDE.md)。

---

## 一、能做什么

- 接管你已登录的真实 Chrome(调试端口 9222),复用登录态,不顶号。
- 「当前页驱动」:你把要跑的页切到前台(推荐页 / 搜索页),点开始,程序只跑当前页对应的任务(推荐→打招呼,搜索→收藏)。
- 列表层先做确定性 + LLM 漏斗筛选,只对拿不准的人才打开详情,省时间和 token。
- 详情正文用「框选一屏 + 复制」方式读取(BOSS 简历是加密 canvas,直读 DOM / hook 都拿不到)。
- 多项目管理:不同岗位各一套筛选规则与记录,互不干扰。

## 二、快速开始

```
git clone <仓库地址> && cd bossauto-electron && npm install
```

`npm install` 会自动安装依赖、安装浏览器内核、部署默认筛选配置。随后:

1. 复制 `.env.example` 为 `.env`,填入 `DEEPSEEK_API_KEY`(LLM 判定必需;密钥不入库)。
2. `npm run dev` 启动;首次扫码登录 BOSS。
3. 把要跑的页(推荐 / 搜索)切到前台 → 点开始。

详见 [SETUP.md](SETUP.md)。

## 三、筛选漏斗(列表 → 详情)

1. **硬筛**:工作年限、学校等确定性规则,直接刷掉明显不符的。
2. **公司关**:按名单 + LLM 判断公司是否在禁止/允许范围(公司不过则不再看职位、不开详情)。
3. **职位关**:先按职位黑白名单代码预筛(命中黑名单直接刷、不过 LLM;其余含白名单一律再过一遍 LLM 职位相关性)。
4. **详情判定**:对前面放行的人打开详情,读「工作经历 + 项目经历」正文,LLM 按业务标准打分判定。
5. **执行动作**:通过的人按任务执行打招呼或收藏,并记录。

判定整体偏召回:拿不准优先继续看详情,而不是直接拒绝。

## 四、配置(都在界面 / 运行时项目里改,不在代码)

运行时数据按项目存放在 `%AppData%\bossauto-electron\projects\<项目>\`,**不入库**。

- **界面筛选面板**(推荐页 / 搜索页各一套):学历、院校、经验、年龄、薪资、活跃度、跳槽频率、求职状态、**城市**。
- **界面搜索词**:多行输入,一行一个,供搜索页逐个搜索使用。
- **`criteria.yaml`**:业务规则书 —— 硬筛口径、公司偏好、职位**黑/白名单**(`title_block_keywords` / `title_allow_keywords`)、运行计划 `run_plan`(批量大小、任务列表、`confirm_filters` 等)。
- **运行前自动勾 boss**(`run_plan.confirm_filters`,默认开):每个任务开始前,自动把界面筛选项(含城市)勾到 boss 网页筛选上,省去手工。

## 五、关键机制与约束(改代码前必读)

- **详情正文**:加密 canvas 渲染,只能「框选左侧正文区一屏 + Ctrl+C 读剪贴板」,逐屏滚动覆盖工作经历 + 项目经历。框选目标是**左侧正文 iframe**,不是右侧操作侧栏。
- **候选人定位**:推荐页用候选人级 `data-geek`;搜索页卡片无候选人 id,用打开链接上的 `data-lid` 区分人。**严禁用 `data-jid`(职位 id,全列表相同,会导致永远点开第一个人、张冠李戴)**。
- **去重 / 跳过**:按「姓名 + 学校 + 专业」去重;打招呼 / 收藏记录跨项目保护(`contacted.json`),不能误清空。列表显示「已沟通 / 继续沟通」的人直接跳过。
- **失败不挡重看**:详情读取失败、姓名核对不过等「没真正判定过」的记录不计入「已看过」,下次会重新打开看。
- **浏览器**:同账号双登录会顶号,务必复用现有已登录 Chrome,不要另开标签 / 另开浏览器登录。

## 六、目录与重要文件

- `src/main/lib/runner.ts` — 主流程:列表扫描、漏斗筛选、打开详情、执行动作。
- `src/main/lib/browser.ts` — 启动 / 接管真实 Chrome、搜索、页面处理。
- `src/main/lib/judge.ts` — 确定性硬筛、候选人去重 key。
- `src/main/lib/llm.ts` — LLM 调用:公司关 / 职位关 / 详情判定。
- `src/main/lib/seen-log.ts` — 已看 / 已联系 / 已收藏记录(两层:全局 contacted + 项目 seen)。
- `src/main/lib/boss-filter-guard.ts` — 把筛选项同步勾到 boss 网页。
- `src/main/lib/actions.ts` — 详情面板内的打招呼 / 收藏。
- `src/main/lib/criteria.ts` / `filters.ts` / `projects.ts` — 配置与多项目读写。
- `src/renderer/` — 界面(筛选面板、搜索词、配置)。
- `src/shared/ipc.ts` — 配置类型与默认值。
- `config/` — 仓库内默认配置模板(首次部署复制到运行时)。
- `docs/` — 多项目方案、判定方案等设计文档。

## 七、开发

- 提交前至少跑类型检查:`npm run typecheck`(node + web 两套 tsconfig)。
- 每次涉及代码逻辑的提交后跑 codex review,先修 P1 / P2(见 [CLAUDE.md](CLAUDE.md))。
- 默认直接在 `main` 上小步提交并推送。
- 业务规则优先改配置(yaml / 界面),代码只负责稳定执行配置。

## 八、数据与安全

- 运行时数据(`criteria.yaml`、`filters.json`、`contacted.json`、`seen.json`、`detail-dumps/`、运行日志)在 `%AppData%\bossauto-electron`,**一律不入库**。
- 密钥放 `.env`(不入库);仓库只保留 `.env.example`。
- `contacted.json` 是候选人隐私 + 防重复打招呼记录,换机如需沿用单独拷贝,不走 git。
