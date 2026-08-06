#!/usr/bin/env bun

/**
 * licode CLI 入口
 * 
 * 支持多种运行模式：
 *   - 交互式 TUI（默认）
 *   - Print 模式（-p）
 *   - JSON 模式（--mode json）
 */

import { runTUI } from '../tui/app'
import { runPrint, readStdin, parseFileRefs } from './modes/print'
import { runJSON } from './modes/json'
import { runInstall, listPackages, uninstallPackage } from './commands/install'

// 解析命令行参数
function parseArgs(args: string[]): {
  mode: 'tui' | 'print' | 'json'
  prompt: string
  files: string[]
  provider?: string
  model?: string
  apiKey?: string
  help?: boolean
  version?: boolean
} {
  const result: ReturnType<typeof parseArgs> = {
    mode: 'tui',
    prompt: '',
    files: [],
  }

  const positionalArgs: string[] = []
  let i = 2 // 跳过 node/bun 和脚本路径

  while (i < args.length) {
    const arg = args[i]

    switch (arg) {
      case '-p':
      case '--print':
        result.mode = 'print'
        i++
        break

      case '--mode':
        if (args[i + 1] === 'json') {
          result.mode = 'json'
        } else if (args[i + 1] === 'print') {
          result.mode = 'print'
        } else if (args[i + 1] === 'tui') {
          result.mode = 'tui'
        } else {
          console.error(`Unknown mode: ${args[i + 1]}`)
          process.exit(1)
        }
        i += 2
        break

      case '--provider':
        result.provider = args[i + 1]
        i += 2
        break

      case '--model':
        result.model = args[i + 1]
        i += 2
        break

      case '--api-key':
        result.apiKey = args[i + 1]
        i += 2
        break

      case '-h':
      case '--help':
        result.help = true
        i++
        break

      case '-v':
      case '--version':
        result.version = true
        i++
        break

      default:
        positionalArgs.push(arg)
        i++
        break
    }
  }

  // 处理位置参数（文件引用和 prompt）
  const parsed = parseFileRefs(positionalArgs)
  result.files = parsed.files
  result.prompt = parsed.prompt

  return result
}

function showHelp(): void {
  console.log(`
licode - Terminal-native AI coding agent

Usage:
  licode [options] [messages...]
  licode <command> [args...]

Commands:
  install <source>  Install a package (npm, git, or local)
  list              List installed packages
  remove <name>     Remove an installed package

Modes:
  (default)         Interactive TUI mode
  -p, --print       Print mode (non-interactive)
  --mode json       JSON output mode

Options:
  --provider <name> Provider (anthropic, openai, deepseek, etc.)
  --model <id>      Model ID
  --api-key <key>   API key
  -l, --local       Install to project directory
  -h, --help        Show help
  -v, --version     Show version

Examples:
  licode                              # Interactive TUI
  licode -p "summarize this code"     # Print mode
  licode install npm:@example/tools   # Install npm package
  licode install git:github.com/user/repo  # Install from git
  licode list                         # List packages
  cat README.md | licode -p "summarize"  # Pipe stdin
`)
}

function showVersion(): void {
  // 从 package.json 读取版本
  try {
    const pkg = require('../../package.json')
    console.log(`licode v${pkg.version}`)
  } catch {
    console.log('licode (version unknown)')
  }
}

async function main() {
  const args = parseArgs(process.argv)

  // 处理帮助和版本
  if (args.help) {
    showHelp()
    process.exit(0)
  }

  if (args.version) {
    showVersion()
    process.exit(0)
  }

  // 检查是否为子命令
  const firstArg = process.argv[2]
  if (firstArg === 'install' || firstArg === 'add') {
    const source = process.argv[3]
    if (!source) {
      console.error('Error: Package source required')
      console.log('Usage: licode install <source>')
      process.exit(1)
    }
    const local = process.argv.includes('-l') || process.argv.includes('--local')
    await runInstall(source, { local })
    return
  }

  if (firstArg === 'list' || firstArg === 'ls') {
    const packages = await listPackages()
    if (packages.length === 0) {
      console.log('No packages installed')
    } else {
      console.log('Installed packages:')
      for (const pkg of packages) {
        console.log(`  - ${pkg}`)
      }
    }
    return
  }

  if (firstArg === 'remove' || firstArg === 'uninstall') {
    const name = process.argv[3]
    if (!name) {
      console.error('Error: Package name required')
      console.log('Usage: licode remove <name>')
      process.exit(1)
    }
    await uninstallPackage(name)
    return
  }

  // 根据模式执行
  switch (args.mode) {
    case 'print': {
      // 从 stdin 读取（如果有）
      let stdin = ''
      if (!process.stdin.isTTY) {
        stdin = await readStdin()
      }

      await runPrint({
        prompt: args.prompt,
        files: args.files.length > 0 ? args.files : undefined,
        stdin: stdin || undefined,
        provider: args.provider,
        model: args.model,
        apiKey: args.apiKey,
      })
      break
    }

    case 'json': {
      // 对于 JSON 模式，将 prompt 和文件作为参数
      const jsonArgs: string[] = []
      if (args.files.length > 0) {
        // 读取文件内容并包含
        const { readFile } = await import('fs/promises')
        const { resolve } = await import('path')
        for (const file of args.files) {
          try {
            const content = await readFile(resolve(file), 'utf-8')
            jsonArgs.push(`## ${file}\n\n${content}`)
          } catch (e) {
            console.error(`Warning: Could not read file ${file}`)
          }
        }
      }
      jsonArgs.push(args.prompt)

      await runJSON(jsonArgs)
      break
    }

    case 'tui':
    default:
      // 交互式 TUI 模式
      await runTUI()
      break
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
