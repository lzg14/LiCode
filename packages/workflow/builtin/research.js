/**
 * Research Workflow
 * 搜索 → 阅读 → 总结
 */
export const meta = {
  name: "research",
  description: "研究模式：搜索网络、阅读文档、总结输出",
  whenToUse: "调研未知技术、查 API 用法、查最佳实践",
  phases: [
    { title: "搜索", detail: "搜索相关信息" },
    { title: "阅读", detail: "阅读关键页面" },
    { title: "总结", detail: "输出总结报告" },
  ],
}

export async function run(ctx) {
  const { agent, tool, phase, log, parallel, args } = ctx

  phase("搜索", "搜索网络 + 查找相关文件")
  const [searchResults, localFiles] = await parallel([
    () => tool("websearch", { query: args.input, numResults: 8 }),
    () => tool("glob", { pattern: `**/*${args.localPattern ?? ""}*` }),
  ])

  log(`搜索到 ${(searchResults.output || "").split("\n").filter(Boolean).length} 个结果，本地文件 ${(localFiles.output || "").split("\n").filter(Boolean).length} 个`)

  phase("阅读", "深入阅读关键资源")
  const links = (searchResults.output || "").match(/https?:\/\/[^\s)]+/g) || []
  const topLinks = links.slice(0, 3)

  const pages = await parallel(
    topLinks.map((url) => () => tool("webfetch", { url, format: "text" }))
  )
  const pageContents = pages.map((p) => p.output || "").join("\n\n---\n\n")

  log(`已阅读 ${pages.length} 个页面`)

  phase("总结", "整合信息输出报告")
  const summary = await agent(`基于以下信息回答用户问题：

用户问题：${args.input}

搜索结果：
${searchResults.output || "无"}

${pageContents ? `页面内容：\n${pageContents.slice(0, 5000)}` : ""}

${localFiles.output ? `本地相关文件：\n${localFiles.output}` : ""}

要求：
1. 简洁清晰，2-4 段
2. 列出关键点和来源链接
3. 如果有冲突信息，明确说明`)
  log(`总结完成`)

  return { success: true, summary, sources: topLinks }
}
