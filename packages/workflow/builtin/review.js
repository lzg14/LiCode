/**
 * Code Review Workflow
 * 获取变更 → 审查 → 报告
 */
export const meta = {
  name: "review",
  description: "代码审查：审查未提交的变更或指定 commit",
  whenToUse: "提交前审查、review 别人的代码",
  phases: [
    { title: "获取变更", detail: "获取 diff" },
    { title: "审查", detail: "逐文件审查" },
    { title: "报告", detail: "输出审查意见" },
  ],
}

export async function run(ctx) {
  const { agent, tool, phase, log, args } = ctx

  phase("获取变更", "获取 git diff")
  const range = args.range ?? ""  // 例如 HEAD~1..HEAD
  const diffResult = await tool("bash", {
    command: range ? `git diff ${range}` : "git diff",
    timeout: 15000,
  })

  if (!diffResult.success || !(diffResult.output || "").trim()) {
    return { success: false, error: "没有代码变更可审查" }
  }

  const diff = diffResult.output
  log(`变更大小：${diff.length} 字符`)

  phase("审查", "逐文件审查")
  const files = [...new Set(diff.match(/^diff --git a\/(.+?) b\//gm) || [])]
    .map(m => m.replace(/^diff --git a\//, "").replace(/ b\/.*$/, ""))

  log(`变更文件数：${files.length}`)

  // 一次性让 LLM 审查所有 diff（避免多轮调用）
  const review = await agent(`请审查以下代码变更：

变更文件：
${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}

完整 diff：
\`\`\`diff
${diff.slice(0, 30000)}
\`\`\`

审查维度：
1. **正确性**：逻辑是否正确？边界情况？
2. **安全性**：注入、敏感信息泄露？
3. **性能**：N+1、不必要的循环？
4. **可读性**：命名、注释、函数粒度？
5. **一致性**：与项目风格一致？

输出格式：
## 通过 / 不通过
## 问题列表（按严重程度排序）
## 建议（可选）`)

  log(`审查完成`)

  return { success: true, review, filesChanged: files, diffSize: diff.length }
}
