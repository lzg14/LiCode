/**
 * Print 模式 - 非交互式运行
 * 
 * 用法：
 *   licode -p "summarize this code"
 *   cat README.md | licode -p "summarize"
 *   licode -p @prompt.md "Answer this"
 */

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { generateText } from 'ai'
import { configLoader } from '../../config/loader'
import { createModel } from '../../llm/provider'
import { homedir } from 'os'

export interface PrintOptions {
  /** 用户输入的 prompt */
  prompt: string
  /** 要包含的文件列表 */
  files?: string[]
  /** 是否从 stdin 读取 */
  stdin?: string
  /** 指定的 provider */
  provider?: string
  /** 指定的 model */
  model?: string
  /** API key */
  apiKey?: string
}

/**
 * 执行 print 模式
 */
export async function runPrint(options: PrintOptions): Promise<void> {
  const { prompt, files, stdin, provider, model, apiKey } = options

  // 加载配置
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const config = await configLoader.discoverAndLoad(homeDir)

  // 合并命令行参数
  const effectiveProvider = provider || config.llm.provider
  const effectiveModel = model || config.llm.model
  const effectiveApiKey = apiKey || config.llm.apiKey

  // 创建模型
  const { model: llmModel } = await createModel({
    provider: effectiveProvider as any,
    model: effectiveModel,
    apiKey: effectiveApiKey,
    baseUrl: config.llm.baseUrl,
  })

  // 构建完整的 prompt
  let fullPrompt = prompt

  // 包含文件内容
  if (files && files.length > 0) {
    const fileContents: string[] = []
    for (const file of files) {
      try {
        const content = await readFile(resolve(file), 'utf-8')
        fileContents.push(`## ${file}\n\n${content}`)
      } catch (e) {
        console.error(`Warning: Could not read file ${file}: ${e}`)
      }
    }
    if (fileContents.length > 0) {
      fullPrompt = fileContents.join('\n\n---\n\n') + '\n\n---\n\n' + fullPrompt
    }
  }

  // 包含 stdin 内容
  if (stdin) {
    fullPrompt = stdin + '\n\n---\n\n' + fullPrompt
  }

  // 调用 LLM
  try {
    const result = await generateText({
      model: llmModel,
      prompt: fullPrompt,
      temperature: 0.3,
    })

    console.log(result.text)
  } catch (e) {
    console.error(`Error: LLM call failed: ${e}`)
    process.exit(1)
  }
}

/**
 * 从 stdin 读取输入
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    
    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })
    
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    
    process.stdin.on('error', reject)
    
    // 如果 stdin 不是 TTY，开始读取
    if (!process.stdin.isTTY) {
      process.stdin.resume()
    } else {
      // TTY 模式下立即 resolve 空字符串
      resolve('')
    }
  })
}

/**
 * 解析 @ 文件引用
 */
export function parseFileRefs(args: string[]): { files: string[]; prompt: string } {
  const files: string[] = []
  const promptParts: string[] = []

  for (const arg of args) {
    if (arg.startsWith('@')) {
      files.push(arg.slice(1))
    } else {
      promptParts.push(arg)
    }
  }

  return { files, prompt: promptParts.join(' ') }
}
