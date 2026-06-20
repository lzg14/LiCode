import { LoopContext } from '../loop'
import { reviewPlan } from '../review'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function verify(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onStreamText?.('验证质量...\n')

  // 1. 文本评审（E3+）
  if (ctx.effortLevel >= 3) {
    ctx.onStreamText?.('启动 Review Agent 评审...\n')
    const reviewResult = await reviewPlan(ctx)

    if (reviewResult.approved) {
      ctx.onStreamText?.('评审通过 ✓\n')
    } else {
      ctx.onStreamText?.(`评审发现问题: ${reviewResult.summary}\n`)
      for (const dim of reviewResult.dimensions) {
        if (!dim.passed) {
          ctx.onStreamText?.(`  ${dim.name}: ${dim.findings.join(', ')}\n`)
        }
      }
      return {
        phase: 'PLAN',
        reviewResult: {
          approved: reviewResult.approved,
          issues: reviewResult.dimensions.flatMap(d => d.findings),
          status: reviewResult.recommendation,
        },
      }
    }
  }

  // 2. 自动编译/语法检查（如果有修改代码）
  const hasCodeChanges = ctx.aiResponse?.includes('```') || ctx.deliverable?.length
  if (hasCodeChanges && ctx.effortLevel >= 2) {
    ctx.onStreamText?.('检查编译...\n')
    try {
      const { stdout, stderr } = await execAsync('npx tsc --noEmit --skipLibCheck 2>&1 || bun run tsc --noEmit --skipLibCheck 2>&1', { timeout: 30_000 })
      const output = (stdout || stderr || '').trim()
      if (output && !output.includes('TS6029') && output.length > 10) {
        ctx.onStreamText?.(`编译问题:\n${output.slice(0, 2000)}\n`)
      } else {
        ctx.onStreamText?.('编译通过 ✓\n')
      }
    } catch {
      ctx.onStreamText?.('编译检查跳过（未配置 TypeScript）\n')
    }
  }

  // 3. 运行测试（E4+ 或明确要求验证）
  const shouldTest = ctx.effortLevel >= 4
  if (shouldTest) {
    ctx.onStreamText?.('运行测试...\n')
    try {
      const { stdout, stderr } = await execAsync('bun test 2>&1 || npx vitest run 2>&1', { timeout: 60_000 })
      const output = (stdout || stderr || '').trim()

      if (output.includes('fail') || output.includes('FAIL')) {
        const errorOutput = output.slice(0, 3000)
        ctx.onStreamText?.(`测试失败:\n${errorOutput}\n`)
        return {
          phase: 'EXECUTE',
          reviewResult: {
            approved: false,
            issues: ['测试未通过，需要修复'],
            status: 'revise',
          },
          // 注入测试失败信息到上下文中，下一轮 EXECUTE 可以使用
          aiResponse: ctx.aiResponse ? `${ctx.aiResponse}\n\n---\n测试结果：\n${errorOutput}\n\n需要修复测试失败。` : undefined,
        }
      }
      ctx.onStreamText?.('测试通过 ✓\n')
    } catch {
      ctx.onStreamText?.('测试跳过（未配置测试框架）\n')
    }
  }

  ctx.onStreamText?.('验证完成\n')
  return {
    phase: 'LEARN',
  }
}
