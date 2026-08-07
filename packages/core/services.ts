/**
 * 核心服务注册
 *
 * 根据 config 为 CoreLoop 构建依赖注入容器。
 *
 * 注意：每个 CoreLoop 实例必须用独立的 container（而非全局单例），否则多个
 * 实例会共享同一个 SQLite 连接 / Memory 目录，破坏测试隔离与多会话并存。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { GitIntegration } from '../integration/git'
import { Memory } from '../memory/memory'
import { SessionManager } from '../session/session'
import type { Config } from './types'
import { CheckpointManager } from './checkpoint'
import { Projector } from './projector'
import { SessionCompactor } from './session-compactor'
import { Container } from './container'

export const SERVICE_KEYS = {
  memory: 'memory',
  sessionManager: 'sessionManager',
  checkpointManager: 'checkpointManager',
  projector: 'projector',
  sessionCompactor: 'sessionCompactor',
  git: 'git',
} as const

export function createCoreContainer(config: Config): Container {
  const container = new Container()
  const home = homedir()
  const memoryPath = (config.memory?.path ?? './licode-sessions.db').replace(/^~/, home)

  container.register(SERVICE_KEYS.memory, () => new Memory(config.cwd))
  container.register(SERVICE_KEYS.sessionManager, () => new SessionManager(memoryPath))
  container.register(SERVICE_KEYS.checkpointManager, () => new CheckpointManager(config.cwd))
  container.register(SERVICE_KEYS.projector, () => new Projector())

  if (config.cwd) {
    container.register(SERVICE_KEYS.git, () => new GitIntegration(config.cwd!))
  }

  container.register(
    SERVICE_KEYS.sessionCompactor,
    () => new SessionCompactor({ dataDir: join(homedir(), '.licode') }),
  )

  return container
}