# Git 分支治理审计报告

审计日期：2026-11-19（Asia/Shanghai）。仓库：`yuchen0x1/Novel-Writer-master`。

## 结果

- 扫描时：本地 2 个分支、远程 13 个分支（包含 main，不计 origin/HEAD）。原始候选分支分类：**A 0、B 5、C 6、D 1**；main 是稳定基线，单列保留。
- 实际删除：本地及远程 `codex/desktop-release-maintenance`。清理后本地 1 个、远程 12 个；随后为本次治理单独创建 `chore/branch-governance-audit`，不把新治理分支算作历史垃圾。
- 未合并任何依赖分支。11 个 Dependabot 分支各有一个有效独立提交，全部保留。没有冲突需要解决，但其中五支缺少锁文件更新，另外六支存在未核实的兼容问题。
- 主线提交仍为 `b48d0442659f6e3081744aada222b8b490f98c7b`。原工作区的业务修复保持未提交；治理文件通过隔离 worktree 提交，不夹带这些修复。
- 新增定期审计工作流、扫描器、安全回归测试与规范。工作流进入默认分支后定时扫描才会生效；在本次治理 PR 合并前，不称为“已上线运行”。

完整清理前引用与 SHA 见 [分支清单](branch-governance-inventory-2026-11-19.json)。该 JSON 是删除后从先前已记录的命令输出转录，未声称文件在删除前已存在。

## 分支实际差异与分类

以下每支均以 `b48d044` 为 merge-base，ahead=1、behind=0，单独 `git merge-tree --write-tree` 均无冲突。没有发现同一升级的重复 patch；共享文件路径不等于代码重复。

| 分支（均以 dependabot/ 开头） | PR | Tip / 最后提交 UTC | 类别 | 实际差异和保留原因 |
|---|---|---|---|---|
| `github_actions/actions/checkout-7.0.1` | #3 | `aec6645` / 2026-11-18 23:52:11Z | C | 12 个 workflow、17 处 action SHA 更新，4.2.2→7.0.1。现有 Windows workflow 契约精确断言旧 pin；需处理契约并核实跨主版本 runner/credential 行为。 |
| `github_actions/actions/upload-artifact-7.0.2` | #4 | `8583f20` / 2026-11-18 23:52:15Z | C | 8 个 workflow、13 处 SHA 更新，4.6.2→7.0.2。旧 pin 断言不匹配，跨平台 promotion 的 artifact-id/digest/下载互操作尚未验证。 |
| `github_actions/actions/setup-node-7.1.0` | #5 | `17d6e20` / 2026-11-18 23:52:19Z | C | 12 个 workflow、14 处 SHA 更新，4.4.0→7.1.0。node-version 未变不能证明 action 自身运行环境兼容；旧 pin 断言及缓存契约待验证。 |
| `npm_and_yarn/plugins/dsh-ai-novel-writer/deepseek-ai/cordis-4.1.0` | #6 | `57d3b2f` / 2026-11-18 23:53:24Z | C | 插件 manifest 和锁均更新；peer/dev 精确版本 4.0.2→4.1.0，排除原 4.0.2 host，需确定目标 host 与装载兼容性。不是缺锁问题。 |
| `npm_and_yarn/plugins/dsh-ai-novel-writer/types/node-26.6.6` | #7 | `d10d86a` / 2026-11-18 23:55:35Z | C | 插件 manifest/锁同步，类型 25→26；既有 CI 仍为 Node 22，支持范围也未同步。需避免类型允许宿主没有的 API。 |
| `npm_and_yarn/plugins/dsh-ai-novel-writer/tsdown-0.23.7` | #8 | `01a66ec` / 2026-11-18 23:56:17Z | C | manifest/锁同步，0.22→0.23，rolldown/dts 工具链变化；其 engines 排除 25.x 而插件仍声明 >=24，自定义 CJS 包装产物需验证。 |
| `npm_and_yarn/vitejs/plugin-react-6.3.0` | #9 | `8a76537` / 2026-11-19 00:07:42Z | B | 仅根 manifest 一行，^6.0.1→^6.3.0，根锁未变；先补锁和 peer resolution，再测 Vite/React/browser/生产构建。 |
| `npm_and_yarn/lucide-react-1.73.0` | #10 | `d2c2525` / 2026-11-19 00:08:07Z | B | 仅根 manifest，^1.8.0→^1.73.0，缺锁；补锁后验证图标导出、类型与 UI 契约。 |
| `npm_and_yarn/radix-ui/react-dialog-1.3.1` | #11 | `f40d0ea` / 2026-11-19 00:08:28Z | B | 仅根 manifest，^1.1.15→^1.3.1，缺锁；补锁后测焦点锁、Escape、portal 与焦点恢复。 |
| `npm_and_yarn/radix-ui/react-tabs-1.2.1` | #12 | `97866ba` / 2026-11-19 00:08:49Z | B | 仅根 manifest，^1.1.13→^1.2.1，缺锁；补锁后测键盘导航、受控 value 和 panel 生命周期。 |
| `npm_and_yarn/playwright-1.65.1` | #13 | `a9d7620` / 2026-11-19 00:09:14Z | B | 仅根 manifest，^1.59.1→^1.65.1，锁和 Vitest peer resolution 均未变；先补锁及浏览器 revision，再测 browser/Electron E2E。 |

这五支根依赖的 manifest specifier 与锁不一致，与既有 `pnpm install --frozen-lockfile` 契约冲突。没有把旧依赖环境的测试成功当作新依赖验证，也没有擅自修改它们的 PR。

每支独立提交均已由 `git show` / `git diff main...<ref>` 审阅。Actions 分支修改的是 `.github/workflows/` 下文件；五个根依赖分支只修改根 `package.json`；三个插件分支修改插件的 `package.json` 和 `pnpm-lock.yaml`。详细文件证据可用扫描器输出 JSON/Markdown 保留。

## 删除依据

`codex/desktop-release-maintenance` 最后提交为 `65276fcb1b5cbbfbb571ab0551e7ff74453e1ae4`，2026-11-19 07:40:33 +08:00，提交信息为“docs: note the hidden assistant entry in the 0.0.2 release drafts”。PR #2 已合并关闭；其 tip 是 `main` 的直接第二父提交，ahead=0、behind=1。源提交仍由 main 可达，没有丢失代码。

已执行普通远程分支删除和本地 `git branch -d`，没有强制推送或重写历史。之后 live `git ls-remote --heads origin` 证实该引用不存在，其余 11 支仍存在。

## 长期治理和权限

实现见 [分支治理规范](BRANCH_GOVERNANCE.md)、[工作流](../.github/workflows/branch-governance.yml)、[扫描器](../scripts/branch-governance-report.mjs)及[测试](../scripts/__tests__/branch-governance-report.test.mjs)。每周一 04:23 UTC（北京时间 12:23）/手动触发，使用只读 token；发布 Actions Summary 和保留 90 天的 Markdown/JSON artifact。识别陈旧、落后、重复 tip/tree、合并状态及开放 PR/checks；不会自动合并、删除或改保护。

A 类需要代码与仓库审批证据，扫描器不因报告全绿就授予 A；D 是清理候选，执行前仍需复核最新 tip、worktree、PR、保护和开发依赖。API 失败保留未知状态，不伪装为零 PR 或检查通过。人工审阅的 B/C 分类比自动扫描有更多兼容性上下文，两者不混用。

主分支保护状态为**未核实**，本次没有修改。GitHub MCP 不提供规则配置接口，gh CLI 未登录，匿名 REST API 受限，BrowserSkill 因守护进程启动失败未能查看页面。SSH 可推送并不证明具备管理员权限。没有宣称主线无保护，也没有宣称新规则已启用。

## 验证

- 新增安全测试：13/13 通过，包含临时 Git 仓库里的冲突、分叉同名分支、工作区/索引不变、保护/开放 PR 保留、API 部分失败及分页检查。
- `node --check` 通过；工作流已用已安装的 js-yaml 解析并检查关键结构；离线审计已成功生成 Markdown 和 JSON。
- `npm run build`（tsc + Vite）在原工作区通过；该结果包含原有未提交业务修复，不等于对远程 main 的纯净构建或对依赖升级分支的验证。构建存在原有 chunk-size 和旧选项等 warning，未修改业务构建配置。
- 之前业务修复的全量测试为 467 文件 / 6,551 passed、13 skipped、5 todo；本次治理新增 13 项单独回归通过，未将两次运行相加伪称新的全量结果。
- combined-status 对 11 个 PR 返回 pending/空列表，只能证明该接口无记录，不能据此认定没有 check-runs 或 CI 未运行；其全部必需检查状态仍未核实。
- 没有达到安全合并门槛的原有分支，不执行合并；没有把“无文本冲突”当作升级可用的证据。
