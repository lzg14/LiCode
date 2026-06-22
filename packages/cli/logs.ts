import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEV_LOG_DIR = join(homedir(), '.licode', 'logs', 'dev')

function listLogFiles(): string[] {
  try {
    const files = readdirSync(DEV_LOG_DIR)
      .filter(f => f.startsWith('dev-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        time: statSync(join(DEV_LOG_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time)
      .map(f => f.name)
    return files
  } catch {
    return []
  }
}

function printHelp() {
  console.log(`用法:
  bun run logs                          列出最近日志文件
  bun run logs --file <name>            查看指定日志文件
  bun run logs --level ERROR            查看最近日志中 ERROR 级别的条目
  bun run logs --tail 20                查看最近日志最后 20 行
  bun run logs --search "关键词"         搜索日志内容
  bun run logs --help                   显示帮助

示例:
  bun run logs --level ERROR --tail 10  最近 10 条 ERROR
  bun run logs --search "session"       搜索 session 相关日志`)
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }

  const files = listLogFiles()
  if (files.length === 0) {
    console.log('暂无日志文件（未找到 ' + DEV_LOG_DIR + '）')
    return
  }
  const latestFile = files[0]

  const fileIdx = args.indexOf('--file')
  const levelIdx = args.indexOf('--level')
  const tailIdx = args.indexOf('--tail')
  const searchIdx = args.indexOf('--search')

  const targetFile = fileIdx !== -1 && fileIdx + 1 < args.length
    ? args[fileIdx + 1]
    : latestFile
  const levelFilter = levelIdx !== -1 && levelIdx + 1 < args.length
    ? args[levelIdx + 1].toUpperCase()
    : null
  const tailCount = tailIdx !== -1 && tailIdx + 1 < args.length
    ? parseInt(args[tailIdx + 1], 10)
    : null
  const searchText = searchIdx !== -1 && searchIdx + 1 < args.length
    ? args[searchIdx + 1].toLowerCase()
    : null

  // 如果没有额外参数，仅列出文件
  if (fileIdx === -1 && levelIdx === -1 && tailIdx === -1 && searchIdx === -1) {
    console.log(`日志目录: ${DEV_LOG_DIR}\n`)
    console.log(`最近文件: ${targetFile}\n`)
    console.log('所有日志文件（按时间倒序）:')
    for (const f of files) {
      const isLatest = f === latestFile
      console.log(`  ${isLatest ? '→' : ' '} ${f}`)
    }
    console.log('\n使用 --help 查看过滤选项')
    return
  }

  // 读取文件内容
  const filePath = join(DEV_LOG_DIR, targetFile)
  let lines: string[]
  try {
    const content = readFileSync(filePath, 'utf-8')
    lines = content.split('\n').filter(l => l.trim())
  } catch {
    console.error(`无法读取日志文件: ${targetFile}`)
    console.error(`路径: ${filePath}`)
    return
  }

  // 应用过滤
  if (levelFilter) {
    lines = lines.filter(l => {
      const match = l.match(/\[(\w+)\]/)
      return match && match[1] === levelFilter
    })
  }

  if (searchText) {
    lines = lines.filter(l => l.toLowerCase().includes(searchText))
  }

  if (tailCount !== null && tailCount > 0) {
    lines = lines.slice(-tailCount)
  }

  // 输出
  console.log(`文件: ${targetFile}`)
  if (levelFilter) console.log(`级别: ${levelFilter}`)
  if (searchText) console.log(`搜索: ${searchText}`)
  if (tailCount !== null) console.log(`行数: ${lines.length}/${lines.length}`)
  console.log('')

  for (const line of lines) {
    console.log(line)
  }
}

main()
