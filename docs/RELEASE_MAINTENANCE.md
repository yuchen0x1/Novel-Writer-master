# 桌面发布维护

正式版入口为 [GitHub Releases](https://github.com/yuchen0x1/Novel-Writer-master/releases/latest)。桌面三平台共用一个版本，DeepSeek Harness 插件独立维护。平台范围见[平台矩阵](platforms.md)。

## 分支和日常检查

- `main` 是桌面发布来源。从功能或修复分支提交 PR，合并前检查 Windows 四分片、渲染器测试、生产依赖审计，以及受影响的安装和迁移场景。
- 产品可见改动同步中英文 README、更新记录和发布说明。提交必须明确范围，包含最少的必要变更。热修复从 `main` 建分支，按同一验证流程发后续补丁版本。`pnpm run check:release-docs` 会校验 package 版本、两份 README、更新指南和发布记录的当前版本链接。
- Dependabot 每周检查桌面依赖，每月检查插件和 Actions。依赖 PR 走常规评审。每周从 npm 官方注册表审计生产依赖，开发依赖告警保留在独立步骤中。
- GitHub 的私密安全报告、推送保护和 Dependabot 安全更新由仓库管理员维护。Actions 默认只读；草稿上传任务和手动候选安装包验收任务单独授予 `contents: write`。后者用于读取草稿 API 与下载资产，不修改 Release，且只在 GitHub 托管的临时 Windows runner 上执行。
- 每次大版本前重复[调研](research/ecosystem-2026-11.md)，每月检查重点对象的 Releases、最近提交和高频 Issues。改变第三方引用前核对 SPDX 和分发义务。

## 资格构建与正式发布

1. 在 `main` 上更新 `package.json`、`CHANGELOG.md`、`docs/releases/release-notes.md`、`.release/notes/v版本.md`、中英文 README 和当前更新说明。旧 `1.x` 用户必须被明确告知手动安装一次当前 `0.0.x` 版本；不能声称他们会收到自动更新提示。
2. 推送后确认 `PR CI`、依赖审计和 CodeQL 在同一 `main` 提交成功。安全告警要么由源码修复后复扫关闭，要么在确认为协议限制/误报时留下具体理由。
3. 从同一冻结的完整 `main` 提交 SHA 手动运行 Windows x64、macOS ARM64 和 macOS Intel 三个 cloud qualification 工作流。检查构建、安装启动和平台验收回执都成功，并记录每个运行的 `runId`、`run_attempt`、`artifactId`。
4. 手动运行 `cross-platform-runtime-artifact-promotion.yml`，填写相同 `expected_sha`、`v<version>`、版本号、发布说明路径及三个资格运行的精确 artifact 信息；确认字符串必须为 `PROMOTE_QUALIFIED_DESKTOP_RELEASE`。Promotion 会验证同一来源并提升已验证字节，不重建安装包。
5. 正式发布后用公开资产复核脚本下载并验证完整 Release、`latest.yml`、文件大小、SHA-256 和 latest 状态。保留 Windows 未签名、macOS ad-hoc 签名且未公证等已知限制。
6. 两个正式 Windows 版本可用后运行 `Windows official in-app update E2E`。本版本默认输入为 `v0.0.3` → `v2.0.0`；后续发布应同步更新输入。只有应用内发现更新、下载正确字节、安装并重启到指定版本、数据保留检查都通过，才记录验收通过。

旧的初始发布工作流和旧 Windows 资格工具保留历史证据，不作为当前资格或 promotion 流程。新流程的全新安装证据不能替代旧项目迁移或正式应用内升级。

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
| Windows 资格构建 | [Windows](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/windows-cloud-build-test.yml) |
| macOS 资格构建 | [ARM64](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/macos-arm64-cloud-build.yml)、[Intel](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/macos-x64-cloud-build.yml) |
| 正式发布提升 | [Promotion](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/cross-platform-runtime-artifact-promotion.yml) |
| 公开下载校验 | [每周校验](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/verify-public-desktop-release.yml) |
| 依赖审计 | [依赖安全](https://github.com/yuchen0x1/Novel-Writer-master/actions/workflows/dependency-security.yml) |
| 最近已核验版本的安装、回退与原生更新实证 | [0.0.3 证据](releases/v0.0.3-verification.md) |
| 原始安装资格和实际范围 | [0.0.1 证据](releases/v0.0.1-verification.md) |
