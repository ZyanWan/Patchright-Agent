# BOSS 推荐页候选人详情正文抓取交接

更新时间：2026-06-01

## 目标

在 BOSS 直聘推荐页打开候选人详情后，抓取左侧“工作经历”区的简历正文，用于后续 LLM 筛选。

明确约束：

- 不走鼠标框选复制作为主方案。
- 登录态保留在用户手动打开的 Edge 默认主资料里，不切换 profile。
- 点击必须保持真实用户事件，现有 CDP 鼠标事件路线可用。
- 列表候选人定位和去重继续使用“姓名 + 学校 + 专业”，不能退回 index。

## 当前结论

详情正文位于嵌套子页面 `web/frame/c-resume/?source=recommend` 中，正文不是 DOM 文本，而是 canvas 渲染内容。

现有 DOM 直读拿到的是噪音：相似推荐、右侧经历概览、沟通流水等，不是候选人本人工作经历正文。

目前主卡点不是“找不到详情 iframe”，而是没能在 `c-resume` 的 canvas 第一次绘制之前进入它的新 document 主世界。

## 已验证事实

- 推荐页打开详情后的 frame 结构包含：主页 `web/chat/recommend`、`recommendFrame`、`searchFrame`、`c-resume`、`about:srcdoc`。
- `c-resume` 内 DOM 正文长度约为 0。
- `c-resume` 内有一个 2D canvas，尺寸约 `1556 x 1456`。
- canvas `toDataURL` 长度约 69 万字符，说明画布确实包含内容。
- “工作经历”里的关键词在所有 frame DOM 中都搜不到。
- 事后注入 canvas hook 再滚动，无法捕获正文；页面大概率一次性绘制完成。

## 已尝试路线

1. Playwright / patchright `context.addInitScript`

   结果：`c-resume` 未执行 hook，`__bsaHooked` 始终为空。

2. 主 page CDP session 注入 `Page.addScriptToEvaluateOnNewDocument`

   结果：reload 子页面后，`c-resume` 仍未执行 hook。

3. 给 `c-resume` 单独创建 CDP session

   结果：patchright 拒绝，提示它不是独立 target，而是父 frame session 的一部分。

4. 事后 `frame.evaluate` 注入，再滚动触发重绘

   结果：捕获为 0。判断 canvas 是一次性画完，事后挂钩太晚。

5. 父层 MutationObserver 监听 iframe 插入，借 `contentWindow` 提前挂钩

   结果：能监听到 iframe 插入，也能挂到旧 realm，但 `fillText` 仍为 0。推断 iframe 导航到真实文档后 realm 重建，旧 hook 失效，或者文字并非通过 `fillText` 绘制。

6. 关闭站点隔离后重试 Playwright / CDP 注入

   结果：详情正常打开、登录保留、`c-resume` 出现，但 hook 仍未在新文档执行。说明核心问题不是站点隔离，而是 patchright/connectOverCDP 注入链路没有覆盖 `c-resume` 主世界。

7. 裸 CDP 探针

   已新增脚本：`scripts/cdp-resume-probe.mjs`。

   已验证：裸 CDP 能连接 Edge 的 browser WebSocket，也能发现并附加 BOSS 推荐页 target。

   问题：使用 `Target.setAutoAttach + waitForDebuggerOnStart` 的探测方式会扰动当前 Edge 页面，用户看到页面频繁刷新。因此已经停止继续跑这条实时探测，并清掉残留探针进程。

## 当前代码状态

- 新增裸 CDP 诊断脚本：`scripts/cdp-resume-probe.mjs`。
- 该脚本目标是验证能否早注入，并同时统计 `fillText`、`strokeText`、`drawImage`、`getContext`、Worker、OffscreenCanvas。
- 已提交一次代码提交：`5a228fc Add raw CDP resume canvas probe`。
- `npm run typecheck` 通过。
- `node --check scripts/cdp-resume-probe.mjs` 通过。
- `codex review --commit HEAD` 曾运行但 3 分钟超时，没有拿到 review 结论。
- 当前还有用户侧未跟踪目录 `docs/`，本次未纳入提交。

## 风险

- 裸 CDP `waitForDebuggerOnStart` 会暂停/扰动真实用户正在使用的 Edge 页面，不适合作为常规运行方案直接接入主流程。
- 关闭站点隔离是浏览器安全降级，测试完成后应恢复正常启动参数。
- 如果 `c-resume` 正文实际是预渲染贴图或服务端生成图片，即使早注入成功，`fillText` 方案也可能彻底不可用。
- OCR 兜底确定可行性较高，但需要处理长画布分段、阅读顺序、错字修正、隐私和成本。

## 建议下一步

推荐先走两个并行验证方向，但不要再扰动用户当前主 Edge 会话：

1. 在可控测试窗口中继续裸 CDP 验证

   使用同一登录态前提下，避免对用户当前正在看的页面做 `waitForDebuggerOnStart`。目标是只对新打开的详情窗口/临时页面自动附加，拿到 `c-resume` 首帧绘制统计。

2. 直接做 OCR 兜底原型

   从 `c-resume` canvas 导出完整像素，先离线跑一版 OCR，验证“工作经历”正文可读性和顺序。如果 OCR 质量可接受，就优先把它接成主兜底，避免继续消耗在早注入竞态上。

## 给下一位接手者

- 不要再把 Playwright `addInitScript` 当主攻方向，已多次验证不覆盖 `c-resume`。
- 不要默认 `fillText` 一定存在，必须同时统计 `drawImage`。
- 不要继续使用鼠标框选复制作为主方案，它违背当前目标，也慢且易错位。
- 不要修改用户 Edge profile，不要清登录态，不要清 seen/contacted/collected 记录。
- 如果继续裸 CDP，必须先避免影响用户当前页面；之前用户已经观察到页面约一秒一次刷新。
- 如果进入 OCR 路线，优先只截 `c-resume` canvas，而不是整页截图，减少噪音。
