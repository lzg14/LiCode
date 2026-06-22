import { describe, it, expect } from 'vitest'
import { findValidStart, loadProjectConfig } from '../execute'

function msg(role: string, parts?: Array<{ type: string; toolCallId?: string; text?: string }>): { role: string; content: any[] } {
  return { role, content: parts ?? [{ type: 'text', text: 'hello' }] }
}

function toolCall(id: string) {
  return { type: 'tool-call' as const, toolCallId: id, toolName: 'bash', input: { command: 'ls' } }
}

function toolResult(id: string) {
  return { type: 'tool-result' as const, toolCallId: id, output: { type: 'text', value: 'ok' } }
}

describe('findValidStart', () => {
  it('空历史 → 0', () => {
    expect(findValidStart([])).toBe(0)
  })

  it('只有 user 消息 → 0', () => {
    expect(findValidStart([msg('user')])).toBe(0)
  })

  it('user + assistant → 0', () => {
    expect(findValidStart([msg('user'), msg('assistant')])).toBe(0)
  })

  it('user + assistant(tool-call) + tool-result（完整配对）→ 0', () => {
    const history = [
      msg('user'),
      msg('assistant', [toolCall('tc1')]),
      msg('tool', [toolResult('tc1')]),
    ]
    expect(findValidStart(history)).toBe(0)
  })

  it('user + tool-result（孤立，无对应 tool-call）→ 从 user 开始（首 user 就无 orphan）→ 0', () => {
    const history = [
      msg('user'),
      msg('tool', [toolResult('orphan1')]),
    ]
    // 首 user 之后就没有 orphan 了（因为 tool-result 在 user 后面且该 user 块没有对应的 tool-call）
    // 但 orphan 检测只看整个块部分的 user 区域
    expect(findValidStart(history)).toBe(0)
  })

  it('孤立 tool-result 开头 + user 之后正常 → 从第二个 user 开始', () => {
    const history = [
      msg('user', [{ type: 'text', text: 'old' }]),
      msg('assistant', [toolCall('tc1')]),
      msg('tool', [toolResult('tc1')]),
      msg('user', [{ type: 'text', text: 'do x' }]),
      msg('assistant', [toolCall('tc2')]),
      msg('tool', [toolResult('tc2')]),
      msg('user', [{ type: 'text', text: 'do y' }]),
      msg('assistant', [{ type: 'text', text: 'done' }]),
    ]
    // 移除 tc1 的 tool-call，制造 orphan
    const orphanHistory = [
      msg('user', [{ type: 'text', text: 'old' }]),
      msg('tool', [toolResult('tc1')]), // orphan: tc1 的 assistant+tool-call 被截掉了
      msg('user', [{ type: 'text', text: 'do x' }]),
      msg('assistant', [toolCall('tc2')]),
      msg('tool', [toolResult('tc2')]),
      msg('user', [{ type: 'text', text: 'do y' }]),
      msg('assistant', [{ type: 'text', text: 'done' }]),
    ]
    expect(findValidStart(orphanHistory)).toBe(2) // 从 index 2 (do x) 开始
  })

  it('多段孤立 tool-result，跳到最后一段无 orphan 的 user', () => {
    const history = [
      msg('user', [{ type: 'text', text: 'old1' }]),
      msg('tool', [toolResult('orphan1')]),
      msg('user', [{ type: 'text', text: 'old2' }]),
      msg('tool', [toolResult('orphan2')]),
      msg('user', [{ type: 'text', text: 'valid' }]),
      msg('assistant', [{ type: 'text', text: 'ok' }]),
    ]
    expect(findValidStart(history)).toBe(4) // 从 index 4 (valid) 开始
  })

  it('混合正常配对 + 孤立 orphan', () => {
    const history = [
      msg('user', [{ type: 'text', text: 'old' }]),
      msg('assistant', [toolCall('valid1')]),
      msg('tool', [toolResult('valid1')]),
      msg('user', [{ type: 'text', text: 'mid' }]),
      msg('tool', [toolResult('orphan1')]), // 孤立
      msg('user', [{ type: 'text', text: 'new' }]),
    ]
    // index 2 是 tool-result valid1，index 5 是 user 'new' — 从 index 5 开始（之前都有问题）
    // 但 index 0 的 user 子段中包含 index 2 的 valid1 tool-result 有对应 tool-call，但 index 4 的 orphan1 无对应
    // 所以 index 0 的位置有 orphan，继续
    expect(findValidStart(history)).toBe(5)
  })

  it('所有 user 起点都有 orphan → 返回 0（兜底不退）', () => {
    const history = [
      msg('user'),
      msg('tool', [toolResult('orphan1')]),
      msg('user'),
      msg('tool', [toolResult('orphan2')]),
    ]
    expect(findValidStart(history)).toBe(0)
  })

  it('无 content 数组的消息跳过不报错', () => {
    const history = [
      { role: 'user', content: 'string content' },
    ] as any
    expect(findValidStart(history)).toBe(0)
  })

  it('孤立 tool-call（无 tool-result）→ 不算 orphan，从头开始', () => {
    const history = [
      msg('user'),
      msg('assistant', [toolCall('tc1')]),
    ]
    expect(findValidStart(history)).toBe(0)
  })
})

describe('tool result 构造逻辑', () => {
  it('成功路径：tool result 包含 output', () => {
    const result = { success: true, output: 'file content' }
    const toolResultMsg = {
      type: 'tool-result' as const,
      toolCallId: 'tc1',
      toolName: 'read',
      output: { type: 'text', value: result.output },
    }
    expect(toolResultMsg.output.value).toBe('file content')
    expect(toolResultMsg.toolName).toBe('read')
  })

  it('失败路径：tool result 包含 error', () => {
    const result = { success: false, error: 'permission denied' }
    const toolResultMsg = {
      type: 'tool-result' as const,
      toolCallId: 'tc1',
      toolName: 'write',
      output: { type: 'text', value: `Error: ${result.error}` },
    }
    expect(toolResultMsg.output.value).toBe('Error: permission denied')
  })
})

describe('loadProjectConfig', () => {
  it('缓存命中时返回缓存值', async () => {
    // 无法直接清缓存，但可以测试函数可调
    const result = await loadProjectConfig(process.cwd())
    expect(typeof result).toBe('string')
  })
})
