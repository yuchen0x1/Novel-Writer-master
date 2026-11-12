# 自动更新与正式发布

本文档描述 Novel Writer master 当前已经接入的桌面应用更新系统。更新源是本项目的官方 GitHub Releases：

<https://github.com/yuchen0x1/Novel-Writer-master/releases>

## 已支持的平台和动作

| 平台 | 更新源 | 应用内动作 | 当前限制 |
| --- | --- | --- | --- |
| Windows x64 安装版 | GitHub Releases `latest.yml` | 检查、提示、用户确认下载、真实进度、完整性校验、用户确认重启安装 | 安装程序目前没有 Windows 代码签名 |
| macOS ARM64 / x64 | 官方 GitHub Release 页面 | 检查、提示、打开固定官方下载页 | 应用内不下载、不替换；安装包是 ad-hoc 签名，没有 Developer ID 或公证 |
| Linux / 开发模式 / 解压目录 | 无 | 不启用更新器 | 需要手动构建或安装 |

Windows 自动更新只在已安装的正式应用中启用。开发服务器、解压测试包和缺少 `resources/app-update.yml` 的包不会联网检查更新。

## 运行时流程

主进程使用 `electron-updater` 6.8.9，发布配置位于 [`electron-builder.json5`](../electron-builder.json5)：

1. Electron Builder 把 GitHub provider 写入安装包的 `resources/app-update.yml`。
2. 打包后的 Windows 应用启动后按每小时最多一次的频率自动检查；设置页可以随时手动检查。
3. 只接受比当前版本高的正式语义版本。预发布版本和降级版本不会进入稳定更新流。
4. Windows 发现更新后只进入「有更新」状态，用户点击「下载更新」才开始下载。`autoDownload` 和 `autoInstallOnAppQuit` 都关闭。
5. 下载进度来自 `download-progress` 事件，不能用假进度填充界面。
6. `electron-updater` 在下载前读取 `latest.yml`，并校验安装包的 SHA-512 与文件大小；NSIS 更新同时使用 blockmap 做差分下载。下载失败时保持当前版本可用，并显示可重试的安全错误分类。
7. 下载完成后，只有用户点击「立即重启更新」才会调用 `quitAndInstall(true, true)`。有运行中的创作任务或未保存修改时，安装动作会被拦截。
8. macOS 只从固定的 `https://github.com/yuchen0x1/Novel-Writer-master/releases/latest` 地址打开下载页，渲染进程不能把这个地址替换成任意外部地址。

更新偏好（上次检查时间、已发现版本和稍后提醒时间）写入应用全局配置。偏好读取或写入失败时，自动检查会停止联网，手动检查仍可用；错误原文不会发送到渲染进程，避免日志、路径或 Token 泄露。

## 稳定、Beta 和 Dev 渠道

当前产品只发布稳定版：

- `allowPrerelease = false`。
- GitHub provider 使用 `channel: latest` 和 `releaseType: release`。
- 正式 Release 必须不是 draft，也不能是 prerelease。

Beta / Dev 渠道目前没有客户端配置和发布清单，不能把带 `-beta` 或 `-Preview` 的版本当成稳定更新发布。将来增加渠道时，应为每个渠道单独配置清单、版本比较和测试安装环境，不能复用稳定版的自动安装入口。

## 安全边界

- 更新源固定为本仓库 GitHub Releases，客户端不接受 Release 元数据提供的任意跳转地址。
- 更新下载走 Electron Builder 生成的 `latest.yml` 和 blockmap；下载完成前不会安装。
- CI 发布后运行 [`scripts/verify-github-update-release.mjs`](../scripts/verify-github-update-release.mjs)，使用 GitHub 资产 API 返回的 SHA-256、文件大小和 `latest.yml` 原始字节做回读校验。
- 本地构建校验 [`scripts/verify-win-update-artifacts.mjs`](../scripts/verify-win-update-artifacts.mjs) 会检查 `latest.yml`、安装包 SHA-512、blockmap、嵌入的 `app-update.yml` 和正式 GitHub provider。
- 发布工作流使用 GitHub Actions 内置 `github.token`，仓库不需要把 Token 写进源码或 `electron-builder.json5`。
- Windows 安装包尚未配置代码签名证书。发布页面和 README 必须保留未知发布者提示；不能把未签名安装包描述成已验证的 Windows 签名产物。
- 现用 electron-builder 26.x / electron-updater 6.x，客户端校验的是 Builder 清单中的 SHA-512。GitHub 资产的 SHA-256 是发布后门禁和审计校验；两者职责不同。升级到支持 Ed25519 更新清单的 Builder 版本前，不应声称客户端已经完成更新清单数字签名验证。

## 正式发布流程

正式发布默认需要人工启动和确认，避免普通提交意外创建 Release。所有资格构建必须来自同一个冻结的 `main` 提交 SHA。

1. 在 `main` 上更新 `package.json` 版本、`CHANGELOG.md` 和 `.release/notes/`，提交并推送。
2. 手动运行以下资格工作流，输入同一个完整提交 SHA、`v<version>` 标签和版本号：
   - `.github/workflows/windows-cloud-build-test.yml`
   - `.github/workflows/macos-arm64-cloud-build.yml`
   - `.github/workflows/macos-x64-cloud-build.yml`
3. 检查三个工作流的构建、安装启动、升级数据和平台验收回执均成功。
4. 手动运行 `.github/workflows/cross-platform-runtime-artifact-promotion.yml`，填写：
   - 同一个 `expected_sha`
   - `release_tag = v<version>`
   - `release_version = <version>`
   - `release_notes_path`
   - 三个资格工作流的 `runId`、`run_attempt`、`artifactId`
   - `confirmation = PROMOTE_QUALIFIED_DESKTOP_RELEASE`
5. 发布工作流会重新读取资格产物、检查版本与 SHA、校验 Release 资产，再创建正式 GitHub Release。它不会重建一份可能不同字节的安装包。
6. 发布完成后，运行：

```powershell
pnpm run verify:github-update-release
```

这个命令需要公开的正式 Release 和本地对应的 `release/<version>` 产物；缺少其中任意一项都应报告失败，不能用本地文件代替远端回读。

## GitHub Actions 触发关系

- `pr-ci.yml`：PR 指向 `main` 时运行 Windows 单元测试分片、浏览器测试、类型检查、Lint、国际化检查和构建；推送到 `main` 也运行同一套机器门禁。
- 三个 cloud build 工作流：`workflow_dispatch`，只做冻结 SHA 的平台资格构建，不创建 Release。
- `cross-platform-runtime-artifact-promotion.yml`：`workflow_dispatch`，需要明确确认字符串，校验成功后才写入正式 Release。
- `windows-in-app-update-e2e.yml`：`workflow_dispatch`，使用两个已发布版本做真实 Windows 应用内更新验收。

这个设计把普通 CI、平台资格构建和正式发布分开。标签名只允许使用 `vMAJOR.MINOR.PATCH`，正式发布仍以提升已验证产物的人工流程为准。

## 本地验证

更新核心的单元测试位于：

- `electron/services/__tests__/update-service.test.ts`
- `electron/services/__tests__/update-runtime.test.ts`
- `electron/services/__tests__/electron-updater-adapter.test.ts`
- `electron/services/__tests__/github-release-update-backend.test.ts`
- `src/components/updates/__tests__/use-update-state.test.ts`
- `src/components/updates/__tests__/UpdateNotifier.browser.tsx`

常用检查：

```powershell
pnpm run typecheck
pnpm run lint
pnpm exec vitest run electron/services/__tests__/update-service.test.ts electron/services/__tests__/update-runtime.test.ts electron/services/__tests__/electron-updater-adapter.test.ts electron/services/__tests__/github-release-update-backend.test.ts src/components/updates/__tests__/use-update-state.test.ts
pnpm run build
```

需要真实安装包时，必须在 Windows 资格工作流中运行 `pnpm run build:win`，再使用 `pnpm run verify:win-update-artifacts` 和安装版冒烟测试。开发模式下没有 `app-update.yml`，因此不应把开发窗口里的「更新不可用」当成更新器故障。

## 故障处理

| 情况 | 应用行为 |
| --- | --- |
| GitHub、DNS、代理或 TLS 失败 | 自动检查静默保留当前状态；手动检查显示可重试的安全错误 |
| Release 是 draft、prerelease 或缺少 `latest.yml` | 不接受为稳定更新，发布校验失败 |
| 安装包大小或 SHA-512 不匹配 | `electron-updater` 拒绝该下载，不进入安装 |
| 下载中断或临时网络失败 | 保持当前版本，用户可以从设置页重试 |
| 有运行中的创作任务 | 禁止重启安装，先返回任务面板 |
| 有未保存修改 | 提供返回保存或明确放弃后重启的选择 |
| Windows 安装失败 | 旧版本仍保留；发布前后都不删除旧安装目录 |
| macOS Gatekeeper 拦截 | 先确认来源为官方 Release，再按 README 的系统设置步骤手动允许 |

## 当前需要外部条件的事项

- GitHub 仓库维护权限：启动资格工作流和正式 promotion workflow。
- Windows 代码签名证书及 GitHub Actions Secrets：目前未提供，因此 Windows 安装包保持未签名并在文档中披露。
- macOS Developer ID 证书和公证凭据：目前未提供，因此 macOS 继续使用 ad-hoc 签名，应用内不做自更新。
- 真实 Release 的更新 E2E：需要仓库中存在两个可用的正式 Windows Release，并由 Windows runner 运行 `windows-in-app-update-e2e.yml`。
