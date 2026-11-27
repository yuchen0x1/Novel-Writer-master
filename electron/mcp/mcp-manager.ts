/**
 * MCP（Model Context Protocol）连接管理器
 *
 * 运行在 Electron 主进程，通过 stdio/SSE 管理与外部 MCP Server 的连接。
 * 兼容 Claude Desktop 的配置格式 (claude_desktop_config.json)。
 *
 * 架构：
 * - 主进程负责 MCP 连接的生命周期（启动子进程 / 建立 SSE）
 * - 通过 IPC 将可用 Tool 列表暴露给渲染进程
 * - 渲染进程通过 IPC 调用 MCP Tool
 */

import { spawn, type ChildProcess } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { isDeepStrictEqual } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import { VELA_HOME } from '../utils/config-utils'
import { assertGlobalDataReady } from '../services/app-data-locator'
import type {
  MCPConfigLoadResult,
  MCPConnectionStatus,
  MCPResourceDescription,
  MCPServerStatus,
  MCPServerSummary,
  MCPToolDescription,
} from '../../src/shared/ipc-channels'

// ===== 类型定义 =====

/** MCP 服务器配置（兼容 Claude Desktop 格式） */
export interface MCPServerConfig {
  /** 服务器唯一 ID */
  id: string
  /** 显示名称 */
  name: string
  /** 传输协议 */
  transport: 'stdio' | 'sse'
  /** stdio 模式：要执行的命令 */
  command?: string
  /** stdio 模式：命令参数 */
  args?: string[]
  /** stdio 模式：环境变量 */
  env?: Record<string, string>
  /** SSE 模式：服务器 URL */
  url?: string
}

/** MCP 配置文件格式（兼容 Claude Desktop） */
export interface MCPConfig {
  mcpServers: Record<string, {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
  }>
}

/** MCP Tool 描述 */
export interface MCPToolDesc extends MCPToolDescription {
  /** 工具名（MCP 原始名称） */
  name: string
  /** 描述 */
  description: string
  /** 输入 JSON Schema */
  inputSchema: Record<string, unknown>
  /** 所属服务器 ID */
  serverId: string
}

/** MCP 资源描述 */
export interface MCPResourceDesc extends MCPResourceDescription {
  uri: string
  name: string
  description?: string
  mimeType?: string
  serverId: string
}

/** 服务器连接状态 */
/** 服务器运行时状态 */
interface MCPServerRuntime {
  config: MCPServerConfig
  status: MCPConnectionStatus
  process?: ChildProcess
  tools: MCPToolDesc[]
  resources: MCPResourceDesc[]
  error?: string
  /** 消息缓冲区（用于解析 JSON-RPC） */
  buffer: string
  decoder: StringDecoder
  /** 请求 ID 计数器 */
  nextRequestId: number
  /** 待响应的请求回调 */
  pendingRequests: Map<number, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
}

// ===== MCP Manager 实现 =====

class MCPManagerImpl {
  private servers: Map<string, MCPServerRuntime> = new Map()
  private loadedConfigs: Map<string, MCPServerConfig> = new Map()

  /** 状态变更通知回调（通知渲染进程） */
  private onStatusChange?: (serverId: string, status: MCPConnectionStatus, error?: string) => void
  /** Tool 列表变更回调 */
  private onToolsChange?: (tools: MCPToolDesc[]) => void

  /** 设置状态变更回调 */
  setCallbacks(callbacks: {
    onStatusChange?: (serverId: string, status: MCPConnectionStatus, error?: string) => void
    onToolsChange?: (tools: MCPToolDesc[]) => void
  }) {
    this.onStatusChange = callbacks.onStatusChange
    this.onToolsChange = callbacks.onToolsChange
  }

  /** 获取 MCP 配置文件默认路径 */
  getDefaultConfigPath(): string {
    assertGlobalDataReady()
    return join(VELA_HOME, 'mcp_config.json')
  }

  /**
   * 加载 MCP 配置文件
   * 兼容 Claude Desktop 格式
   */
  async loadConfig(): Promise<MCPConfigLoadResult> {
    const path = this.getDefaultConfigPath()
    this.loadedConfigs.clear()
    const revoke = async (result: MCPConfigLoadResult): Promise<MCPConfigLoadResult> => {
      await this.disconnectAll()
      return result
    }
    try {
      const raw = await readFile(path, 'utf-8')
      const parsed: unknown = JSON.parse(raw)

      if (
        !parsed
        || typeof parsed !== 'object'
        || !('mcpServers' in parsed)
        || !parsed.mcpServers
        || typeof parsed.mcpServers !== 'object'
        || Array.isArray(parsed.mcpServers)
      ) {
        return revoke({ status: 'error', servers: [], error: 'MCP_CONFIG_INVALID' })
      }

      const servers: MCPServerSummary[] = []
      const trustedConfigs = new Map<string, MCPServerConfig>()
      for (const [id, value] of Object.entries(parsed.mcpServers)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return revoke({ status: 'error', servers: [], error: 'MCP_CONFIG_INVALID' })
        }
        const cfg = value as MCPConfig['mcpServers'][string]
        if (
          (cfg.command !== undefined && typeof cfg.command !== 'string')
          || (cfg.args !== undefined && (!Array.isArray(cfg.args) || cfg.args.some(arg => typeof arg !== 'string')))
          || (cfg.env !== undefined && (
            !cfg.env
            || typeof cfg.env !== 'object'
            || Array.isArray(cfg.env)
            || Object.values(cfg.env).some(entry => typeof entry !== 'string')
          ))
          || (cfg.url !== undefined && typeof cfg.url !== 'string')
        ) {
          return revoke({ status: 'error', servers: [], error: 'MCP_CONFIG_INVALID' })
        }
        const hasCommand = typeof cfg.command === 'string' && cfg.command.trim().length > 0
        const hasUrl = typeof cfg.url === 'string' && cfg.url.trim().length > 0
        if (hasCommand === hasUrl) {
          return revoke({ status: 'error', servers: [], error: 'MCP_CONFIG_INVALID' })
        }
        const trustedConfig: MCPServerConfig = {
          id,
          name: id,
          transport: hasUrl ? 'sse' : 'stdio',
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          url: cfg.url,
        }
        trustedConfigs.set(id, trustedConfig)
        servers.push({ id, name: id, transport: trustedConfig.transport })
      }
      for (const [id, runtime] of this.servers) {
        const trustedConfig = trustedConfigs.get(id)
        if (!trustedConfig || !isDeepStrictEqual(runtime.config, trustedConfig)) {
          await this.disconnect(id)
        }
      }
      this.loadedConfigs = trustedConfigs
      return { status: 'loaded', servers }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return revoke({ status: 'missing', servers: [] })
      }
      return revoke({ status: 'error', servers: [], error: 'MCP_CONFIG_INVALID' })
    }
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(serverId: string): Promise<void> {
    const config = this.loadedConfigs.get(serverId)
    if (!config) throw new Error('MCP_SERVER_NOT_CONFIGURED')
    if (this.servers.has(config.id)) {
      await this.disconnect(config.id)
    }

    const runtime: MCPServerRuntime = {
      config,
      status: 'connecting',
      tools: [],
      resources: [],
      buffer: '',
      decoder: new StringDecoder('utf8'),
      nextRequestId: 1,
      pendingRequests: new Map(),
    }
    this.servers.set(config.id, runtime)
    this.notifyStatusChange(config.id, 'connecting')

    try {
      if (config.transport === 'stdio') {
        await this.connectStdio(runtime)
      } else {
        throw new Error('MCP_SSE_UNSUPPORTED')
      }

      // 初始化 MCP 会话
      await this.initializeSession(runtime)
      this.assertActiveRuntime(runtime)

      // 发现工具
      await this.discoverTools(runtime)
      this.assertActiveRuntime(runtime)

      // 发现资源
      await this.discoverResources(runtime)
      this.assertActiveRuntime(runtime)

      runtime.status = 'connected'
      this.notifyStatusChange(config.id, 'connected')
      this.notifyToolsChange()
    } catch {
      this.rejectPendingRequests(runtime, 'MCP_CONNECT_FAILED')
      if (this.servers.get(config.id) !== runtime || runtime.status === 'disconnected') {
        runtime.process?.kill()
        throw new Error('MCP_CONNECT_FAILED')
      }
      runtime.status = 'error'
      runtime.process?.kill()
      runtime.error = 'MCP_CONNECT_FAILED'
      this.notifyStatusChange(config.id, 'error', runtime.error)
      throw new Error(runtime.error)
    }
  }

  /** stdio 模式连接 */
  private async connectStdio(runtime: MCPServerRuntime): Promise<void> {
    const { command, args = [], env } = runtime.config
    if (!command) {
      throw new Error('MCP_STDIO_COMMAND_REQUIRED')
    }

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    runtime.process = proc

    // 监听 stdout（JSON-RPC 消息）
    proc.stdout?.on('data', (data: Buffer) => {
      runtime.buffer += runtime.decoder.write(data)
      this.processBuffer(runtime)
    })

    // 监听 stderr（调试日志）
    proc.stderr?.on('data', (data: Buffer) => {
      console.warn(`[MCP:${runtime.config.id}] stderr:`, data.toString())
    })

    // Drain stdout before rejecting requests: exit can precede the final data event.
    proc.on('close', (code) => {
      console.log(`[MCP:${runtime.config.id}] 进程退出，code=${code}`)
      this.rejectPendingRequests(runtime, 'MCP_SERVER_NOT_CONNECTED')
      if (this.servers.get(runtime.config.id) !== runtime || runtime.status === 'error' || runtime.status === 'disconnected') return
      runtime.status = 'disconnected'
      runtime.tools = []
      runtime.resources = []
      this.notifyStatusChange(runtime.config.id, 'disconnected')
      this.notifyToolsChange()
    })

    const onProcessError = () => {
      this.rejectPendingRequests(runtime, 'MCP_CONNECT_FAILED')
      if (this.servers.get(runtime.config.id) !== runtime || runtime.status === 'error' || runtime.status === 'disconnected') return
      runtime.status = 'error'
      runtime.error = 'MCP_CONNECT_FAILED'
      runtime.tools = []
      runtime.resources = []
      this.notifyStatusChange(runtime.config.id, 'error', runtime.error)
      this.notifyToolsChange()
    }
    proc.on('error', onProcessError)
    // A broken pipe is emitted by stdin, not necessarily by ChildProcess.
    proc.stdin?.on('error', onProcessError)
  }

  private assertActiveRuntime(runtime: MCPServerRuntime): void {
    if (this.servers.get(runtime.config.id) !== runtime
      || (runtime.status !== 'connecting' && runtime.status !== 'connected')) {
      throw new Error('MCP_SERVER_NOT_CONNECTED')
    }
  }

  private rejectPendingRequests(runtime: MCPServerRuntime, code: string): void {
    for (const pending of runtime.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(code))
    }
    runtime.pendingRequests.clear()
  }

  /** 处理 JSON-RPC 消息缓冲区 */
  private processBuffer(runtime: MCPServerRuntime): void {
    // MCP 使用 \n 分隔的 JSON-RPC 消息
    const lines = runtime.buffer.split('\n')
    runtime.buffer = lines.pop() ?? '' // 保留最后一行（可能不完整）

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const msg = JSON.parse(trimmed)
        this.handleMessage(runtime, msg)
      } catch {
        // 非 JSON 行，忽略
      }
    }
  }

  /** 处理收到的 JSON-RPC 消息 */
  private handleMessage(runtime: MCPServerRuntime, msg: Record<string, unknown>): void {
    // 响应消息（有 id）
    if ('id' in msg && msg.id != null) {
      const pending = runtime.pendingRequests.get(msg.id as number)
      if (pending) {
        runtime.pendingRequests.delete(msg.id as number)
        clearTimeout(pending.timer)
        if ('error' in msg) {
          const err = msg.error as { message?: string }
          pending.reject(new Error(err?.message ?? 'MCP error'))
        } else {
          pending.resolve(msg.result)
        }
      }
    }
    // 通知消息（无 id）— 暂时只记录日志
  }

  /** 发送 JSON-RPC 请求 */
  private sendRequest(runtime: MCPServerRuntime, method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.assertActiveRuntime(runtime)
      const stdin = runtime.process?.stdin
      if (!stdin || stdin.destroyed || stdin.writableEnded) {
        reject(new Error('MCP_SERVER_NOT_CONNECTED'))
        return
      }
      const id = runtime.nextRequestId++

      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      })

      // 超时 10 秒
      const timer = setTimeout(() => {
        if (runtime.pendingRequests.has(id)) {
          runtime.pendingRequests.delete(id)
          console.warn(`[MCP:${runtime.config.id}] request timed out`, { method })
          reject(new Error('MCP_REQUEST_TIMEOUT'))
        }
      }, 10000)
      runtime.pendingRequests.set(id, { resolve, reject, timer })
      try {
        stdin.write(msg + '\n', (error?: Error | null) => {
          if (!error || !runtime.pendingRequests.has(id)) return
          clearTimeout(timer)
          runtime.pendingRequests.delete(id)
          reject(new Error('MCP_SERVER_NOT_CONNECTED'))
        })
      } catch {
        clearTimeout(timer)
        runtime.pendingRequests.delete(id)
        reject(new Error('MCP_SERVER_NOT_CONNECTED'))
      }
    })
  }

  /** 初始化 MCP 会话 */
  private async initializeSession(runtime: MCPServerRuntime): Promise<void> {
    await this.sendRequest(runtime, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'vela',
        version: '1.0.0',
      },
    })

    // 发送 initialized 通知
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    runtime.process?.stdin?.write(msg + '\n')
  }

  /** 发现可用工具 */
  private async discoverTools(runtime: MCPServerRuntime): Promise<void> {
    try {
      const result = await this.sendRequest(runtime, 'tools/list') as { tools?: MCPToolDesc[] }
      runtime.tools = (result?.tools ?? []).map(t => ({
        ...t,
        serverId: runtime.config.id,
      }))
    } catch {
      runtime.tools = []
    }
  }

  /** 发现可用资源 */
  private async discoverResources(runtime: MCPServerRuntime): Promise<void> {
    try {
      const result = await this.sendRequest(runtime, 'resources/list') as { resources?: MCPResourceDesc[] }
      runtime.resources = (result?.resources ?? []).map(r => ({
        ...r,
        serverId: runtime.config.id,
      }))
    } catch {
      runtime.resources = []
    }
  }

  /**
   * 调用 MCP Tool
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{
    success: boolean
    content: string
    error?: string
  }> {
    const runtime = this.servers.get(serverId)
    if (!runtime || runtime.status !== 'connected') {
      return { success: false, content: '', error: 'MCP_SERVER_NOT_CONNECTED' }
    }

    try {
      const result = await this.sendRequest(runtime, 'tools/call', {
        name: toolName,
        arguments: args,
      }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }

      const textParts = (result?.content ?? [])
        .filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('\n')

      return result?.isError === true
        ? { success: false, content: textParts, error: textParts || 'MCP_TOOL_EXECUTION_FAILED' }
        : { success: true, content: textParts }
    } catch (error) {
      return { success: false, content: '', error: String(error) }
    }
  }

  /** 断开服务器连接 */
  async disconnect(serverId: string): Promise<void> {
    const runtime = this.servers.get(serverId)
    if (!runtime) return

    runtime.status = 'disconnected'
    this.servers.delete(serverId)
    this.rejectPendingRequests(runtime, 'MCP_SERVER_NOT_CONNECTED')
    runtime.process?.kill()
    this.notifyStatusChange(serverId, 'disconnected')
    this.notifyToolsChange()
  }

  /** 断开所有连接 */
  async disconnectAll(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.disconnect(id)
    }
  }

  /** 获取所有 MCP Tool */
  getAllTools(): MCPToolDesc[] {
    const tools: MCPToolDesc[] = []
    for (const runtime of this.servers.values()) {
      if (runtime.status === 'connected') {
        tools.push(...runtime.tools)
      }
    }
    return tools
  }

  /** 获取所有 MCP 资源 */
  getAllResources(): MCPResourceDesc[] {
    const resources: MCPResourceDesc[] = []
    for (const runtime of this.servers.values()) {
      if (runtime.status === 'connected') {
        resources.push(...runtime.resources)
      }
    }
    return resources
  }

  /** 获取所有服务器状态 */
  getServersStatus(): MCPServerStatus[] {
    return Array.from(this.servers.values()).map(r => ({
      id: r.config.id,
      name: r.config.name,
      status: r.status,
      toolCount: r.tools.length,
      error: r.error,
    }))
  }

  private notifyStatusChange(serverId: string, status: MCPConnectionStatus, error?: string) {
    this.onStatusChange?.(serverId, status, error)
  }

  private notifyToolsChange() {
    this.onToolsChange?.(this.getAllTools())
  }
}

/** 全局单例 MCP Manager */
export const mcpManager = new MCPManagerImpl()
