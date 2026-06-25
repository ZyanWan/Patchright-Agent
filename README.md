# Patchright-Agent

> 面向 AI Agent 的真实浏览器自动化技能层。  
> 让 Agent 能在授权场景下，以接近真实用户的方式操作复杂 Web 应用。

Patchright-Agent 是一个可复用的 Agent Skills 项目，用于真实浏览器自动化。它封装了基于 Patchright 的浏览器控制、持久化会话、页面探测、受控操作、证据采集、任务脚本和工作流参考文档，使 AI Agent 能够以可重复、可检查的方式操作真实 Web 应用。

它不是单一用途的自动化脚本，而是一套可分发、可组合、可扩展的 Agent Skill 基础设施。你可以在此之上为不同业务场景构建专用技能，例如招聘系统、运营后台、CRM、客服后台、内容管理系统或企业 SaaS 平台。

---

## 核心定位

Patchright-Agent 关注的是：

- **真实浏览器操作**：基于真实 Chromium 环境，而不是简化的接口或静态脚本。
- **持久化会话复用**：支持保存登录态、Cookie、本地存储和浏览器配置。
- **复杂页面任务执行**：适合弹窗、抽屉、动态加载、多步骤表单等真实 Web 场景。
- **Agent 实时决策**：让 Agent 根据页面状态观察、判断、操作，而不是只执行固定流程。
- **证据链留存**：支持截图、日志、页面文本、结构化 JSON 和任务报告输出。
- **技能化分发**：每个领域工作流都可以封装为独立 Agent Skill。

---

## 为什么需要 Patchright-Agent

传统网页自动化通常面向测试脚本，强调确定性流程；而 AI Agent 面对的是真实业务页面，往往存在更多不确定性：

- 页面结构经常变化
- 内容动态加载
- 登录态需要复用
- 操作需要人工审核
- 页面信息需要截图留证
- 任务流程可能存在分支
- Agent 需要根据页面实时判断下一步

Patchright-Agent 的目标是把真实浏览器自动化整理成一套可复用的 Agent 能力，让 Agent 不只是“生成脚本”，而是能够在真实网页中观察、理解、操作和记录。

---

## 能力概览

| 能力 | 说明 |
| --- | --- |
| 真实浏览器控制 | 使用真实 Chromium 执行页面访问、点击、输入、滚动、截图等操作 |
| 持久化 Profile | 保存登录态、Cookie、本地存储和浏览器上下文 |
| 页面探测 | 获取页面标题、URL、文本、截图和结构化诊断信息 |
| 证据采集 | 输出截图、JSON、日志、下载文件和任务记录 |
| 受控操作 | 对可能改变网站状态的动作进行显式授权和日志记录 |
| 领域技能扩展 | 可为招聘、运营、销售、客服等业务场景封装专用 Skill |
| 可分发安装 | 通过 npm 安装器分发到 Codex、Claude 或自定义目录 |

---

## 真实模拟能力

Patchright-Agent 的重点是“真实模拟”。

它通过真实浏览器、持久化用户环境和页面级操作，让 Agent 能够以更接近真实用户的方式完成网页任务。相比只调用接口、只读取 DOM、或通过简化浏览器控制协议完成操作，这种方式更适合处理复杂的现代 Web 应用。

典型能力包括：

- 打开真实网页并等待页面加载完成
- 复用已有登录态进入业务后台
- 处理按钮、输入框、菜单、浮层、弹窗和抽屉
- 在页面中滚动、查找、点击、输入和提交
- 下载文件并保存到指定目录
- 截图记录关键页面状态
- 输出结构化诊断结果，方便人工复核
- 在失败时保留现场信息，便于定位问题

---

## 与其他自动化方式的区别

### 相比 Playwright

Playwright 是优秀的浏览器自动化框架，适合测试、脚本化流程和确定性场景。

Patchright-Agent 则更偏向 Agent 使用场景。它在浏览器自动化之上补充了技能结构、运行约定、持久化 Profile、证据输出、工作流参考和受控操作边界。

更适合：

- AI Agent 驱动的网页操作
- 复杂页面中的实时判断
- 授权后的登录态复用
- 多步骤业务流程
- 需要截图和日志留证的任务
- 可复用、可分发的 Agent Skill

### 相比 Chrome MCP 自动化

Chrome MCP 自动化通常关注“如何控制浏览器”。

Patchright-Agent 更关注“如何把浏览器控制变成可复用的 Agent 工作流”。它不仅提供浏览器操作能力，还组织了技能目录、脚本规范、证据目录、运行参数、Profile 管理和领域参考文档。

### 相比接口自动化

接口自动化适合稳定、明确、开放的 API 场景。

但很多真实业务系统没有完整开放接口，或者关键操作只能通过网页后台完成。Patchright-Agent 适合这类授权网页操作场景，让 Agent 可以通过真实页面完成任务，而不是依赖不存在或不可用的 API。

---

## 适用场景

Patchright-Agent 适合用于：

- AI Agent 操作真实 Web 应用
- 企业后台自动化
- 招聘、销售、运营、客服等业务系统辅助操作
- 页面信息采集与证据留存
- 登录态复用的网页任务
- 多步骤复杂页面流程
- 需要人工审核和可追溯记录的自动化任务
- 为不同业务领域封装专用 Agent Skill

---

## 安全与边界

Patchright-Agent 面向授权场景下的浏览器自动化。使用时应遵守目标网站的服务条款、访问权限、频率限制和数据合规要求。

对于可能改变网站状态的操作，例如提交表单、收藏、联系候选人、发送消息、修改配置等，应当明确区分“观察模式”和“执行模式”，并在执行前获得用户授权。

原则上应遵守：

- 不绕过登录、验证码、多因素认证或访问控制
- 不规避网站限制或滥用服务资源
- 不执行未经授权的数据访问或批量抓取
- 不在未确认的情况下修改线上数据
- 对关键操作保留日志和证据

---

## 技能目录

可复用技能位于 `skills/` 目录下。分发本项目时，每个子目录都会被安装为一个 Agent Skill。

```text
skills/
  patchright-browser/
    SKILL.md
  bossauto-recruiting/
    SKILL.md
```

### patchright-browser

通用真实浏览器自动化 Skill，提供页面探测、截图、诊断、持久化 Profile、文件下载、页面文本提取等能力。

适合用于任意授权 Web 应用的浏览器级 Agent 操作。

### bossauto-recruiting

面向 BOSS 招聘相关页面的领域 Skill，封装了招聘场景下的页面检查、候选人信息提取、筛选辅助、证据记录和受控操作流程。

该 Skill 针对具体业务页面提供更高层的工作流能力。

---

## 项目结构

```text
skills/
  patchright-browser/      # 通用浏览器自动化 Skill
  bossauto-recruiting/     # 招聘场景专用 Skill

installer/                 # npm 安装器与分发包
docs/                      # 分发与架构文档
labs/                      # 实验性子项目
runtime/                   # 运行时目录，保存 Profile、截图、日志和下载文件
```

---

## 安装

### 推荐方式：使用公开 npm 安装器

npm 包已内置所有技能。请使用下面固定的 `0.2.0` 命令，并保留明确的 `--source` 参数，确保安装过程从包内置的技能目录读取内容，而不是克隆 GitHub 仓库。

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills
```

### 支持的安装目标

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills

npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install claude --source patchright-agent-installer/skills

npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install --target <path> --source patchright-agent-installer/skills
```

如需更新已有安装，请添加 `--force`：

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills --force
```

### 从本地仓库安装

如果你已经在本地克隆了该仓库，可以在仓库根目录运行安装器：

```bash
npx -y . install codex
```

完整参数说明请查看 `installer/README.md`，例如 `--ref`、`--force`、`--dry-run` 等；发布细节请查看 `docs/distribution.md`。

---

## 运行示例

### 探测页面并输出截图与诊断信息

```bash
python skills/patchright-browser/scripts/probe_page.py \
  --workspace . \
  --url https://example.com \
  --profile runtime/profiles/patchright-profile \
  --screenshot runtime/artifacts/shot.png \
  --json runtime/artifacts/diag.json
```

### 打开持久化浏览器用于人工登录

```bash
python skills/patchright-browser/scripts/open_persistent.py \
  --workspace . \
  --url https://example.com \
  --profile runtime/profiles/patchright-profile
```

---

## 设计目标

Patchright-Agent 的目标不是做一个单一自动化脚本，而是为 Agent 提供一套可复用的真实浏览器操作能力。

它希望解决的问题是：

- 让 Agent 能操作真实网页，而不仅是生成脚本
- 让网页自动化过程可观察、可复查、可追踪
- 让登录态和任务上下文可以安全复用
- 让不同业务领域可以独立封装自己的 Skill
- 让复杂 Web 应用的操作更接近真实用户行为

通过这种方式，Patchright-Agent 可以成为 AI Agent 连接真实 Web 应用的一层通用能力基础。
