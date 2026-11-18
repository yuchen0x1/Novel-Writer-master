# 平台与维护范围

以 [GitHub 正式发行记录](https://github.com/yuchen0x1/Novel-Writer-master/releases/latest)为当前下载入口。分级按核心工作流、权限、实机风险、分发和维护成本评估。A 代表纳入发布矩阵，C 代表暂缓，D 代表当前架构下不适用。

| 平台 | 分级 | 核心功能和交互 | 权限、维护与分发 |
| --- | --- | --- | --- |
| Windows 11 x64 | A | 完整桌面写作流程，键鼠、窗口、文件选择与拖入 | 使用 Windows 安全文件句柄和系统密钥库。NSIS 安装，应用内检查、确认下载和重启。正式旧包缺少 Authenticode。 |
| Windows 10 x64 | A | 同一 Windows 产品与安装流程 | 支持声明以发行说明为准。Windows runner 的资格结果不能替代 Windows 10 真机验收。 |
| Windows ARM64 | C | x64 模拟运行和 ARM64 原生包需要分别验收 | 需要 LanceDB、SQLite 原生二进制和安装、更新、兼容验证。 |
| macOS Intel | A | 完整桌面工作流，使用独立的 Intel DMG | 独立 Intel runner、Keychain、原生安全文件帮助程序。手动从官方发行页下载。当前为 ad-hoc 签名。 |
| macOS Apple Silicon | A | 与 Intel 共享工作流，提供原生 ARM64 DMG | 独立 ARM64 runner。Developer ID、公证与同签名更新链需要发布凭据。 |
| Linux（通用） | C | Electron 界面可移植。安全文件验证、凭据回退和内核差异须验证 | 确认 native ABI、密钥库、安全文件语义、安装包和更新后才开放分发。 |
| Ubuntu | C | 可作为将来 Linux 资格构建的首个发行版 | 需在支持的 LTS 核对 AppImage/FUSE、Wayland、GNOME Keyring。 |
| Debian | C | 工作流可共享。较老 glibc 可能影响原生依赖 | 需独立 DEB 和升级验证，不能沿用 Ubuntu 结论。 |
| Fedora | C | 需验收 SELinux、Wayland 和文件选择器 | AppImage 或 RPM 需要单独构建及更新验证。 |
| Arch Linux | C | 滚动发行会提高原生依赖回归频率 | AUR 维护、签名和例行兼容验证成本较高。 |
| Android 手机 | C | 快速笔记、检查蓝图、阅读草稿有价值。长篇全流程需要触控重排 | SAF 权限、沙盒、密钥、暂停恢复和 Play 签名链需独立实现。 |
| Android 平板 | C | 双栏对照有价值，布局及键盘快捷键要验证 | 同 Android 沙盒、权限、备份与商店分配。 |
| Android 折叠屏 | C | 内外屏切换要保住手稿和编辑会话 | 需两种姿态、旋转、多窗口和活动恢复实机 验证。 |
| iOS | C | 可做独立阅读和轻量编辑，完整写作工具链需重新设计 | 文件书签、后台限制、Keychain、签名和 App Store 更新。 |
| iPadOS | C | 多窗格审稿和外接键盘有潜力 | 需 iPad 多窗口、文件权限和长文编辑专项验收。 |
| 桌面 Web | C | 有完整工作区的交互空间，当前渲染进程需要 IPC | 服务版必须新建身份、授权、持久化和任务 API。将作者数据移入服务端会改变信任边界。 |
| 移动 Web | C | 适合只读资料和轻量修改 | 依赖桌面 Web 的数据及授权合同。需触屏、断线和重连设计。 |
| 响应式 Web | C | 布局可共享，路由、编辑器与视口行为需重做 | 需账户、数据恢复、上传下载和缓存发布链。 |
| PWA | C | 独立窗口和离线草稿有价值 | 浏览器存储清理、同步冲突、Service Worker 更新与文件授权须先建立。 |
| Chrome 扩展 | D | 当前产品没有需要访问网页的核心任务 | 增加扩展权限面与商店审核，无法承接本地项目和 native 模块。 |
| Edge 扩展 | D | 同 Chrome | 还需独立商店分发及 Chromium 版本兼容。 |
| Firefox 扩展 | D | 同 Chrome | WebExtensions 接口、自签名与分发均需独立验收。 |
| Docker | C | 适合有明确服务 API 后的部署 | 现有 GUI、Keychain 和项目目录授权不适合作为容器入口。 |
| NAS | C | 私有备份有价值，服务版需适配 ARM、挂载和 UID | 现有 WebDAV 备份可用。SQLite 项目热写入网络盘需单独验证。 |
| 私有化部署 | C | 有写作团队场景时可以评估独立服务 | 需用户隔离、并发租约、凭据托管、审计和迁移回滚。 |
| 云服务器 | C | 适用于独立服务形态 | 运维、TLS、数据责任与账户安全成本高。 |
| CLI | C | 可从离线导出、备份校验或写作 Skill 验证切入 | 需要稳定的项目授权协议及写入锁；现存开发脚本属于工程入口。 |

| 功能 | Windows x64 | macOS Intel | macOS Apple Silicon |
| --- | --- | --- | --- |
| 书房、架构与章节蓝图 | 共享业务行为 | 共享业务行为 | 共享业务行为 |
| 正文生成、差异修订、审稿、定稿、恢复 | 共享业务行为 | 共享业务行为 | 共享业务行为 |
| 离线场景、检索、导出与备份 | 本地目录与 Windows 原生安全层 | 本地目录与 Darwin 原生安全层 | 本地目录与 Darwin 原生安全层 |
| 密钥库 | Windows DPAPI | Keychain | Keychain |
| 更新 | 提醒、确认下载、进度、确认重启 | 提醒并打开官方下载页 | 提醒并打开官方下载页 |
| 资产 | x64 EXE、blockmap、latest.yml | x64 DMG | ARM64 DMG |

跨平台新功能走同一套数据合同和模型工作流测试。涉及窗口、权限、密钥库、用户目录、原生二进制和安装器的变更在对应平台重新验收。
