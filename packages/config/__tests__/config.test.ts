import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs'
import { homedir } from 'os'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  watch: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: vi.fn(),
}))

import { join, dirname } from 'path'
import { ConfigLoader } from '../loader'
import { discoverExternalSources, importClaudeCodeConfig } from '../external'
import { LLMConfigSchema, SecurityConfigSchema, SubagentConfigSchema, MemoryConfigSchema, ConfigSchema } from '../schema'

const validConfig = {
  llm: { provider: 'anthropic' as const, model: 'claude-3-opus', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  security: { commandWhitelist: ['ls', 'cat'], allowedPaths: ['/home'], deniedPaths: ['/etc'] },
  memory: { path: './memory.json', retentionDays: 30 },
  subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
}

beforeEach(() => {
  vi.mocked(existsSync).mockReset()
  vi.mocked(readFileSync).mockReset()
  vi.mocked(writeFileSync).mockReset()
  vi.mocked(mkdirSync).mockReset()
  vi.mocked(watch).mockReset()
  vi.mocked(homedir).mockReset()

  vi.mocked(homedir).mockReturnValue('C:\\Users\\testuser')
  vi.spyOn(process, 'cwd').mockReturnValue('C:\\test\\project')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Schema validation', () => {
  it('LLMConfigSchema 通过有效配置', () => {
    const result = LLMConfigSchema.parse({
      provider: 'anthropic',
      model: 'claude-3-opus',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    })
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-3-opus')
    expect(result.apiKeyEnv).toBe('ANTHROPIC_API_KEY')
  })

  it('LLMConfigSchema 拒绝无效 provider', () => {
    const result = LLMConfigSchema.safeParse({ provider: 'invalid', model: 'test' })
    expect(result.success).toBe(false)
  })

  it('SecurityConfigSchema 通过有效配置', () => {
    const result = SecurityConfigSchema.parse({
      commandWhitelist: ['ls'],
      allowedPaths: ['/home'],
      deniedPaths: ['/etc'],
    })
    expect(result.commandWhitelist).toEqual(['ls'])
  })

  it('SubagentConfigSchema 默认值正确 (maxConcurrent=3, maxDepth=1)', () => {
    const result = SubagentConfigSchema.parse({})
    expect(result.maxConcurrent).toBe(3)
    expect(result.maxDepth).toBe(1)
    expect(result.timeoutMs).toBe(900000)
    expect(result.blockedTools).toEqual([
      'delegate_task',
      'clarify',
      'memory_write',
      'send_message',
      'execute_code',
    ])
  })

  it('MemoryConfigSchema retentionDays 默认值为 30', () => {
    const result = MemoryConfigSchema.parse({ path: './mem.json' })
    expect(result.path).toBe('./mem.json')
    expect(result.retentionDays).toBe(30)
  })

  it('ConfigSchema 通过完整有效配置', () => {
    const result = ConfigSchema.parse(validConfig)
    expect(result.llm.provider).toBe('anthropic')
    expect(result.security.commandWhitelist).toEqual(['ls', 'cat'])
    expect(result.memory.path).toBe('./memory.json')
    expect(result.subagent.maxConcurrent).toBe(3)
  })

  it('ConfigSchema 拒绝缺少必填字段', () => {
    const result = ConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('Loader - 环境变量替换', () => {
  it('replaceEnvVars 用 process.env 替换 ${VAR}', async () => {
    vi.stubEnv('MY_KEY', 'sk-secret')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      llm: { ...validConfig.llm, apiKey: '${MY_KEY}' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.llm.apiKey).toBe('sk-secret')
  })

  it('replaceEnvVars 对 ${VAR:-default} 使用默认值', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      memory: { ...validConfig.memory, path: '${NOT_SET:-./fallback.json}' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.memory.path).toBe('./fallback.json')
  })

  it('replaceEnvVars 对 ${VAR} 未设置时返回空字符串', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      llm: { ...validConfig.llm, apiKey: '${NONEXISTENT_VAR}' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.llm.apiKey).toBe('')
  })

  it('replaceEnvVarsInObj 递归替换嵌套对象', async () => {
    vi.stubEnv('BASE', 'http://localhost:8080')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      llm: { ...validConfig.llm, baseUrl: '${BASE}/v1' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.llm.baseUrl).toBe('http://localhost:8080/v1')
  })

  it('replaceEnvVarsInObj 替换数组中的值', async () => {
    vi.stubEnv('PATH_WHITELIST', '/data')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      security: { ...validConfig.security, allowedPaths: ['${PATH_WHITELIST}'] },
    }))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.security.allowedPaths).toEqual(['/data'])
  })

  it('replaceEnvVarsInObj 非字符串原始类型不变', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.memory.retentionDays).toBe(30)
    expect(result.subagent.maxConcurrent).toBe(3)
  })
})

describe('ConfigLoader 类', () => {
  it('load() 文件不存在时抛出异常', async () => {
    const loader = new ConfigLoader()
    await expect(loader.load('/nonexistent/config.json')).rejects.toThrow(
      'Config file not found: /nonexistent/config.json'
    )
  })

  it('load() 解析 JSON 并通过 schema 验证', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig))

    const loader = new ConfigLoader()
    const result = await loader.load('/fake/config.json')

    expect(result.llm.provider).toBe('anthropic')
    expect(result.llm.model).toBe('claude-3-opus')
    expect(result.security.commandWhitelist).toEqual(['ls', 'cat'])
    expect(result.memory.path).toBe('./memory.json')
    expect(result.subagent.blockedTools).toEqual([])
  })

  it('loadWithOverrides 在基础配置之上合并覆盖项', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig))

    const loader = new ConfigLoader()
    const result = await loader.loadWithOverrides('/fake/config.json', {
      llm: { provider: 'openai', model: 'gpt-4' },
    })

    expect(result.llm.provider).toBe('openai')
    expect(result.llm.model).toBe('gpt-4')
    expect(result.memory.path).toBe('./memory.json')
    expect(result.security.commandWhitelist).toEqual(['ls', 'cat'])
  })

  it('discoverAndLoad 加载本地配置 licode.config.json', async () => {
    const localPath = join('C:\\test\\project', 'licode.config.json')
    vi.mocked(existsSync).mockImplementation((p: string) => p === localPath)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig))

    const loader = new ConfigLoader()
    const result = await loader.discoverAndLoad('C:\\Users\\testuser')

    expect(result.llm.provider).toBe('anthropic')
    expect(readFileSync).toHaveBeenCalledWith(localPath, 'utf-8')
  })

  it('discoverAndLoad 回退到全局配置 ~/.licode/config.json', async () => {
    const globalPath = join('C:\\Users\\testuser', '.licode', 'config.json')
    vi.mocked(existsSync).mockImplementation((p: string) => p === globalPath)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      ...validConfig,
      llm: { ...validConfig.llm, model: 'global-model' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.discoverAndLoad('C:\\Users\\testuser')

    expect(result.llm.model).toBe('global-model')
    expect(readFileSync).toHaveBeenCalledWith(globalPath, 'utf-8')
  })

  it('discoverAndLoad 回退到 Claude Code 配置', async () => {
    const claudePath = join('C:\\Users\\testuser', '.claude', 'settings.json')
    vi.mocked(existsSync).mockImplementation((p: string) => p === claudePath)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-ant-token' },
    }))

    const loader = new ConfigLoader()
    const result = await loader.discoverAndLoad('C:\\Users\\testuser')

    expect(result.llm.provider).toBe('anthropic')
    expect(result.llm.apiKey).toBe('sk-ant-token')
    expect(result.security.commandWhitelist).toEqual([])
  })

  it('discoverAndLoad 无配置文件时使用默认配置', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const loader = new ConfigLoader()
    const result = await loader.discoverAndLoad('C:\\Users\\testuser')

    expect(result.llm.provider).toBe('anthropic')
    expect(result.llm.model).toBe('claude-sonnet-4-20250514')
    expect(result.llm.apiKeyEnv).toBe('ANTHROPIC_API_KEY')
    expect(result.memory.path).toBe('./licode-memory.json')
    expect(result.memory.retentionDays).toBe(30)
    expect(result.security.commandWhitelist).toEqual([])
    expect(result.subagent.blockedTools).toEqual([])
  })

  it('save() 将 JSON 写入文件', () => {
    vi.mocked(existsSync).mockReturnValue(true)

    const loader = new ConfigLoader()
    loader.save('/fake/path/config.json', validConfig)

    expect(mkdirSync).not.toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalledWith(
      '/fake/path/config.json',
      JSON.stringify(validConfig, null, 2),
      'utf-8'
    )
  })

  it('save() 目录不存在时自动创建', () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const loader = new ConfigLoader()
    loader.save('/fake/path/config.json', validConfig)

    const expectedDir = dirname('/fake/path/config.json')
    expect(mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true })
    expect(writeFileSync).toHaveBeenCalledOnce()
  })

  it('getConfig 在加载之前返回 null', () => {
    const loader = new ConfigLoader()
    expect(loader.getConfig()).toBeNull()
  })

  it('getConfig 在 discoverAndLoad 后返回配置', async () => {
    const localPath = join('C:\\test\\project', 'licode.config.json')
    vi.mocked(existsSync).mockImplementation((p: string) => p === localPath)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig))

    const loader = new ConfigLoader()
    await loader.discoverAndLoad('C:\\Users\\testuser')

    expect(loader.getConfig()).not.toBeNull()
    expect(loader.getConfig()!.llm.provider).toBe('anthropic')
  })

  it('watch 注册监听器, unwatch 移除监听器', () => {
    const closeFn = vi.fn()
    vi.mocked(watch).mockImplementation((_path: any, _cb: any) => ({ close: closeFn } as any))

    const loader = new ConfigLoader()
    const onChange = vi.fn()

    loader.watch('/fake/path', onChange)
    expect(watch).toHaveBeenCalledWith('/fake/path', expect.any(Function))

    loader.unwatch('/fake/path')
    expect(closeFn).toHaveBeenCalled()
  })
})

describe('外部配置发现', () => {
  it('discoverExternalSources 返回 3 个来源', () => {
    const sources = discoverExternalSources('/home/user')
    expect(sources).toHaveLength(3)
    expect(sources[0].type).toBe('claude-code')
    expect(sources[1].type).toBe('opencode')
    expect(sources[2].type).toBe('hermes')
  })

  it('discoverExternalSources 正确标记文件存在状态', () => {
    vi.mocked(existsSync).mockImplementation((p: string) => p.includes('claude'))
    const sources = discoverExternalSources('/home/user')
    expect(sources[0].exists).toBe(true)
    expect(sources[1].exists).toBe(false)
    expect(sources[2].exists).toBe(false)
  })

  it('importClaudeCodeConfig settings.json 不存在返回 null', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const result = importClaudeCodeConfig()
    expect(result).toBeNull()
  })

  it('importClaudeCodeConfig 解析 env.ANTHROPIC_AUTH_TOKEN', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-ant-auth-token' },
    }))

    const result = importClaudeCodeConfig()
    expect(result).not.toBeNull()
    expect(result!.apiKey).toBe('sk-ant-auth-token')
    expect(result!.model).toBe('claude-sonnet-4-20250514')
    expect(result!.baseUrl).toBe('https://api.anthropic.com')
  })

  it('importClaudeCodeConfig 回退到 ANTHROPIC_API_KEY', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_API_KEY: 'sk-ant-api-key' },
    }))

    const result = importClaudeCodeConfig()
    expect(result).not.toBeNull()
    expect(result!.apiKey).toBe('sk-ant-api-key')
  })

  it('importClaudeCodeConfig 无 API key 时返回 null', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://example.com' },
    }))

    const result = importClaudeCodeConfig()
    expect(result).toBeNull()
  })
})
