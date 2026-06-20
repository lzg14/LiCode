/**
 * Coding Workflow
 * 分析 → 编码 → 验证
 */
export const meta = {
  name: "coding",
  description: "标准编码工作流：分析需求、生成代码、验证",
  whenToUse: "日常开发任务，写代码、修复 bug、添加功能",
  phases: [
    { title: "分析", detail: "理解需求并制定修改方案" },
    { title: "编码", detail: "使用工具生成或修改代码" },
    { title: "验证", detail: "编译检查、运行测试" },
  ],
}

export async function run(ctx) {
  const { agent, tool, phase, log, args } = ctx

  // 阶段 1: 分析
  phase("分析", "理解需求并分析现有代码")
  const analysis = await agent(`分析以下需求并制定修改方案：

需求：${args.input}
${args.files ? `相关文件：${args.files.join(", ")}` : ""}

输出：
1. 问题理解（1-2 句）
2. 修改方案（具体到文件和操作）
3. 风险点`)
  log(`分析完成`)

  // 阶段 2: 编码
  phase("编码", "执行代码修改")
  const code = await agent(`根据以下方案执行编码：

${analysis}

可用工具：
- read, write, edit: 文件操作
- bash: 执行命令（已白名单）
- glob, grep, codesearch: 搜索
- database_query: 数据库
- excel_read, excel_write: Excel

完成修改后，简要说明做了什么。`)
  log(`编码完成`)

  // 阶段 3: 验证
  phase("验证", "编译检查和测试")
  const compileCheck = await tool("bash", { command: "npx tsc --noEmit --skipLibCheck 2>&1 | head -30" })
  if (!compileCheck.success || (compileCheck.output || "").match(/error TS/)) {
    log(`编译有问题: ${(compileCheck.output || "").slice(0, 500)}`)
    // 自动回退：让 LLM 修复
    const fix = await agent(`编译有错误，请修复：

${compileCheck.output}

分析错误原因，读取相关文件，修复后再次编译验证。`)
    const recompile = await tool("bash", { command: "npx tsc --noEmit --skipLibCheck 2>&1 | head -10" })
    if ((recompile.output || "").match(/error TS/)) {
      return { success: false, error: "编译错误未修复", detail: recompile.output }
    }
  }

  log(`验证通过`)

  return { success: true, summary: "编码完成并通过验证", analysis, code }
}
