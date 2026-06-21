# CLAUDE.md（bossauto-electron 项目级）

本文件只放本项目特有约定；通用规则见全局 CLAUDE.md。

## 提交后 codex review（每次代码提交必做）

- 每次涉及**代码逻辑**的 `git commit` 之后，自动运行 `codex review --commit HEAD` 复审本次提交。
- codex 报出的 **P1/P2** 等级问题：先修复（必要时追加一次提交）再继续，不要放着。
- **P3/nit**：记录并简要告知用户，不强制修。
- 纯文档、注释、配置模板类提交可跳过 review。
- 每次 review 的结论向用户简要汇报（结论 + 是否已修）。

> 说明：codex review 在本机 Windows 下跑 git 会走内部 fallback，但仍能正常输出审查结论；
> 已多次抓到自查漏掉的真实问题（历史空库覆盖一致性、分片大小小数边界死循环等），值得保留。

## 校验

- 本项目无 `.claude/verify`；提交前至少跑 `npm run typecheck`（node + web 双 tsconfig）。
