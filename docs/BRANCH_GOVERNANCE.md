# 分支治理规范

## 稳定基线与命名

本仓库稳定分支为 `main`。不额外创建 `develop`。新功能使用 `feature/*`，缺陷修复使用 `fix/*`，必要时使用 `hotfix/*` 或 `release/*`；Dependabot 分支保留其自动命名。不为凑齐命名类型创建空分支。

## 合并与清理

- 合并前审阅实际提交和文件差异，确认锁文件、运行环境与升级契约。冲突检测成功不等于功能验证通过。
- 在准确的 PR head 或拟合并提交上运行对应检查。缺失、过期、跳过、未完成或无法读取的检查，均不能作为验证通过的证据。
- A：已完成代码及兼容性审核，必要测试与仓库审批策略均满足，可通过 PR 合并。自动扫描器不自行授予 A 类。
- B：有价值，但需补锁、整理、测试或审核；保留已有 PR，不创建重复 PR。
- C：尚在开发、存在冲突/兼容风险、使用中的 worktree、受保护，或活动证据不完整；保留，不自动删除。
- D：所有提交已被基线包含，确认不存在开放 PR、分支保护及开发依赖后可清理。仅文件树相同、名称相似或长时间无更新，不能作为删除依据。
- 本地/远程同名但 tip 不同的分支必须分别检查。删除前保存完整引用与 SHA 清单，复核最新 tip，并确认未被其他 worktree 使用。
- 只使用普通 PR 合并和有条件的分支删除。不强推主线，不重写公共历史，不把当前工作区的未提交业务改动夹带到治理 PR。

## 每周自动审计

`.github/workflows/branch-governance.yml` 在每周一 04:23 UTC（北京时间 12:23）和手动触发时运行。工作流合并进入默认分支后，定时触发才会生效。

扫描器 `scripts/branch-governance-report.mjs` 不安装项目依赖，使用 Git 和 Node。它读取完整本地/远程引用及 tip，检查 ahead/behind、最近独立提交、文件增删改、合并树冲突、相同 tip/相同 tree，标记 90 天未提交及落后 50 个提交的分支，并关联开放 PR、草稿状态、GitHub protected 标记、check-runs 和 combined status。

报告同时写入 Actions Summary 和 Markdown/JSON artifact，保留 90 天。JSON 包含扫描证据，方便逐次比较。API 受限时保留已取得的数据并标注“未知”，不会将失败读成零个 PR，也不会据此建议删除。

此自动化只扫描和报告，不自动合并、删除、创建 PR或更改保护规则。全绿检查仍需代码/兼容性和仓库审批策略审核；存在独立提交的候选不会因为 tree 与其他分支相同而被删除。需要合并的分支若已有 PR，沿用该 PR；新分支由维护者或已授权代理在完成验证后创建 PR。

## 本地运行

```powershell
# 只读取本地 Git 对象，不访问 GitHub。
node scripts/branch-governance-report.mjs --offline --output .runtime/branch-governance/report.md --json .runtime/branch-governance/evidence.json

# 更新远程引用后，结合已有 GITHUB_TOKEN / GH_TOKEN 读取公开/授权的仓库证据。
git fetch origin
node scripts/branch-governance-report.mjs --base origin/main --output .runtime/branch-governance/report.md --json .runtime/branch-governance/evidence.json

# 针对扫描安全边界的回归测试。
npx vitest run scripts/__tests__/branch-governance-report.test.mjs
```

本地运行不会自动 fetch；报告反映当时已获取的 refs。不要将 token 写入仓库或报告。工作流仅授予 `contents`、`pull-requests`、`checks`、`statuses` 的 read 权限；checkout 不持久化凭据。

## 主分支保护

建议仓库管理员要求通过 PR、必要 CI 与相应审核，禁止强推及删除稳定主线，并视实际团队人数设置审批要求。不要在不知道现有规则的情况下覆盖保护设置，也不要把尚未验证的 job 名称设为必需检查。

2026-11-19 本次任务没有修改规则：可用 GitHub MCP 不提供规则配置接口，本机 GitHub CLI 未登录，匿名 REST 请求受限，BrowserSkill 服务启动失败。规则是否已由仓库管理员启用未取得证据，因此状态记为“未核实”，不是“未保护”。允许通过 SSH 推送分支，也不能证明具有 GitHub 管理员权限。
