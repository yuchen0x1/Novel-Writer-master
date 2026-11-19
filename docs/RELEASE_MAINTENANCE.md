# 桌面发布维护

正式版入口为 [GitHub Releases](https://github.com/yuchen0x1/Novel-Writer-master/releases/latest)。桌面三平台共用一个版本，DeepSeek Harness 插件独立维护。平台范围见[平台矩阵](platforms.md)。

## 分支和日常检查

- `main` 是桌面发布来源。从功能或修复分支提交 PR，合并前检查 Windows 四分片、渲染器测试、生产依赖审计，以及受影响的安装和迁移场景。
- 产品可见改动同步中英文 README、更新记录和发布说明。提交必须明确范围，包含最少的必要变更。热修复从 `main` 建分支，按同一验证流程发后续补丁版本。`pnpm run check:release-docs` 会校验 package 版本、两份 README、更新指南和发布记录的当前版本链接。
- Dependabot 每周检查桌面依赖，每月检查插件和 Actions。依赖 PR 走常规评审。每周从 npm 官方注册表审计生产依赖，开发依赖告警保留在独立步骤中。
- GitHub 的私密安全报告、推送保护和 Dependabot 安全更新由仓库管理员维护。Actions 默认只读。发布草稿只有上传任务获得写权限。
- 每次大版本前重复[调研](research/ecosystem-2026-11.md)，每月检查重点对象的 Releases、最近提交和高频 Issues。改变第三方引用前核对 SPDX 和分发义务。

## 从标签构建同一版本

1. 更新 `package.json`、`CHANGELOG.md`、`docs/releases/release-notes.md` 和 `.release/notes/v版本.md`。确认 README 下载仍指向已发布资产。
2. 合并后确认 `Desktop PR CI (Windows)` 在将发版的提交上成功。生产依赖和变更涉及的安全检查必须通过。
3. 在该提交创建并推送稳定格式的标签 `vMAJOR.MINOR.PATCH`。`Qualify desktop release` 拒绝已有 Release、版本不一致、未过 CI 或不在默认分支历史的提交。修复可恢复的 runner 问题后可在同一标签手动重试。
4. 在 Windows x64、macOS Intel 和 ARM64 对应 runner 构建。Windows 检查安装、启动、卸载和更新文件，macOS 分别挂载 DMG 并运行原生检查。三者都通过后，同一运行上传已检查的资产到 Release 草稿并对照 GitHub 回传的大小与 SHA-256。
5. 核对签名、公证、Windows 旧版数据保留、明确的更新及回滚验收。满足目标平台的正式验收后，从 GitHub 将草稿转为正式版。公开后 `Verify public desktop release` 下载全部资产并复算校验值；CI 还会每周复查最新正式版。
6. 两个正式 Windows 版本可用后运行 `Windows official in-app update E2E`。当前仓库默认输入为 `v0.0.1` → `v0.0.3`，发布后应在手动运行时覆盖为实际相邻稳定版本（如 `v0.0.2` → `v0.0.3`）。只有看到旧版发现更新、下载正确字节、安装并重启到指定版本，以及数据保留证据，才记为应用内更新验收通过。

旧的初始发布工作流和旧资格工具保留历史证据。旧 Windows 资格流程固定使用已不可从当前官方仓库取回的 v0.2.5/v1.1.0 资产，后续版本按上述标签流程制作候选包。新流程的全新安装证据不能替代旧项目迁移或正式应用内升级。

## 出现故障时

- 机器检查失败时修复其首个失败边界，并复验受影响的用例和完整门禁。
- 草稿上传失败时，保留该运行的资产和诊断。由维护者核对现有草稿及资产字节，避免重跑覆盖同一版本。
- 更新前从旧客户端导出作品归档。若新版启动或迁移失败，保持原作品副本，使用旧版配合受支持的归档恢复方式。当前运行时没有自动二进制回滚。
- 变更更新信任根前保留既有客户端引导。应用内更新签名、公证和回滚资格需要先在旧客户端与目标客户端之间验证。

## 查阅状态

| 项目 | 证据 |
| --- | --- |
| 正式下载、资产和历史 | [发布页](https://github.com/yuchen0x1/Novel-Writer-master/releases) |
| 主分支与候选测试 | [PR CI](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/pr-ci.yml) |
| 桌面构建和草稿 | [资格工作流](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/desktop-release.yml) |
| 公开下载校验 | [每周校验](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/verify-public-desktop-release.yml) |
| 依赖审计 | [依赖安全](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/dependency-security.yml) |
| 原始安装资格和实际范围 | [0.0.1 证据](releases/v0.0.1-verification.md) |
