import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CheckpointManager } from '../checkpoint'
import { rm, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `licode-checkpoint-test-${Date.now()}`)

let manager: CheckpointManager

beforeAll(() => {
  manager = new CheckpointManager(TEST_DIR, { maxCheckpoints: 3, autoCleanup: true })
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('CheckpointManager', () => {
  it('should save and restore checkpoint', async () => {
    const saved = await manager.save('session-1', {
      phase: 'EXECUTE',
      context: { effortLevel: 2 },
      timestamp: Date.now(),
    })

    expect(saved.sessionId).toBe('session-1')
    expect(saved.version).toBe(1)
    expect(saved.phase).toBe('EXECUTE')

    const restored = await manager.restore('session-1')
    expect(restored).not.toBeNull()
    expect(restored!.version).toBe(1)
  })

  it('should increment version on multiple saves', async () => {
    await manager.save('session-2', { phase: 'OBSERVE', context: {}, timestamp: Date.now() })
    const v2 = await manager.save('session-2', { phase: 'THINK', context: {}, timestamp: Date.now() })
    const v3 = await manager.save('session-2', { phase: 'PLAN', context: {}, timestamp: Date.now() })

    expect(v2.version).toBe(2)
    expect(v3.version).toBe(3)

    const restored = await manager.restore('session-2')
    expect(restored!.version).toBe(3)
    expect(restored!.phase).toBe('PLAN')
  })

  it('should return null for non-existent session', async () => {
    const result = await manager.restore('non-existent')
    expect(result).toBeNull()
  })

  it('should list checkpoints', async () => {
    await manager.save('session-list', { phase: 'OBSERVE', context: {}, timestamp: Date.now() })
    await manager.save('session-list', { phase: 'BUILD', context: {}, timestamp: Date.now() })

    const list = await manager.list('session-list')
    expect(list.length).toBe(2)
  })

  it('should get specific version', async () => {
    await manager.save('session-ver', { phase: 'OBSERVE', context: {}, timestamp: Date.now() })
    await manager.save('session-ver', { phase: 'EXECUTE', context: {}, timestamp: Date.now() })

    const v1 = await manager.getVersion('session-ver', 1)
    expect(v1!.phase).toBe('OBSERVE')

    const v2 = await manager.getVersion('session-ver', 2)
    expect(v2!.phase).toBe('EXECUTE')
  })

  it('should delete session checkpoints', async () => {
    await manager.save('session-del', { phase: 'OBSERVE', context: {}, timestamp: Date.now() })
    await manager.delete('session-del')

    const result = await manager.restore('session-del')
    expect(result).toBeNull()
  })

  it('should auto-cleanup when exceeding maxCheckpoints', async () => {
    const mgr = new CheckpointManager(TEST_DIR, { maxCheckpoints: 2, autoCleanup: true })
    const sid = 'session-cleanup'

    await mgr.save(sid, { phase: 'OBSERVE', context: {}, timestamp: Date.now() })
    await mgr.save(sid, { phase: 'THINK', context: {}, timestamp: Date.now() })
    await mgr.save(sid, { phase: 'BUILD', context: {}, timestamp: Date.now() })

    const list = await mgr.list(sid)
    expect(list.length).toBe(2)
    expect(list[0].phase).toBe('THINK')
    expect(list[1].phase).toBe('BUILD')
  })

  it('should persist to disk', async () => {
    const mgr2 = new CheckpointManager(TEST_DIR, { maxCheckpoints: 5 })
    const sid = 'session-persist'

    await mgr2.save(sid, { phase: 'OBSERVE', context: { test: true }, timestamp: Date.now() })

    const sessionDir = join(TEST_DIR, '.checkpoints', sid)
    const files = await readdir(sessionDir)
    expect(files.some(f => f.startsWith('checkpoint-v') && f.endsWith('.json'))).toBe(true)
  })
})
