import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ConfigLoader } from '../loader'
import { writeFile, rm, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `licode-config-test-${Date.now()}`)
const TEST_CONFIG = join(TEST_DIR, 'licode.config.json')

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(TEST_CONFIG, JSON.stringify({
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    },
    security: {
      commandWhitelist: ['git'],
      allowedPaths: ['./'],
      deniedPaths: [],
    },
    memory: {
      path: './test-memory.json',
      retentionDays: 7,
    },
    subagent: {
      maxConcurrent: 2,
      maxDepth: 1,
      timeoutMs: 60000,
      blockedTools: [],
    },
  }, null, 2), 'utf-8')
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('ConfigLoader', () => {
  it('should load config from file', async () => {
    const loader = new ConfigLoader()
    const config = await loader.load(TEST_CONFIG)

    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.model).toBe('claude-sonnet-4-20250514')
    expect(config.security.commandWhitelist).toContain('git')
  })

  it('should throw for non-existent file', async () => {
    const loader = new ConfigLoader()
    await expect(loader.load('/nonexistent/config.json')).rejects.toThrow('not found')
  })

  it('should save and reload config', async () => {
    const loader = new ConfigLoader()
    const savePath = join(TEST_DIR, 'saved-config.json')

    const config = {
      llm: { provider: 'openai' as const, model: 'gpt-4' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './mem.json', retentionDays: 30 },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    }

    loader.save(savePath, config)
    const loaded = await loader.load(savePath)

    expect(loaded.llm.provider).toBe('openai')
    expect(loaded.llm.model).toBe('gpt-4')
  })

  it('should replace environment variables', async () => {
    process.env.TEST_API_KEY = 'test-12345'
    const configPath = join(TEST_DIR, 'env-config.json')

    await writeFile(configPath, JSON.stringify({
      llm: { provider: 'anthropic', model: '${TEST_API_KEY}' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './mem.json' },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    }), 'utf-8')

    const loader = new ConfigLoader()
    const config = await loader.load(configPath)

    expect(config.llm.model).toBe('test-12345')
    delete process.env.TEST_API_KEY
  })

  it('should use default values for subagent config', async () => {
    const configPath = join(TEST_DIR, 'minimal-config.json')
    await writeFile(configPath, JSON.stringify({
      llm: { provider: 'anthropic', model: 'test' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './mem.json' },
      subagent: {},
    }), 'utf-8')

    const loader = new ConfigLoader()
    const config = await loader.load(configPath)

    expect(config.subagent.maxConcurrent).toBe(3)
    expect(config.subagent.maxDepth).toBe(1)
    expect(config.subagent.timeoutMs).toBe(900000)
  })

  it('should load config correctly', async () => {
    const loader = new ConfigLoader()
    const config = await loader.load(TEST_CONFIG)
    expect(config).not.toBeNull()
    expect(config.llm.provider).toBe('anthropic')
  })

  it('should load with overrides', async () => {
    const loader = new ConfigLoader()
    const config = await loader.loadWithOverrides(TEST_CONFIG, {
      llm: { provider: 'openai', model: 'gpt-4o' },
    })

    expect(config.llm.provider).toBe('openai')
    expect(config.llm.model).toBe('gpt-4o')
  })
})
