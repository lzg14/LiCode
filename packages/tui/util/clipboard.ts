import { spawn } from 'child_process'

/**
 * 跨平台剪贴板操作
 * Windows: clip / powershell
 * macOS: pbcopy / pbpaste
 * Linux: xclip
 */

export const copy = copyToClipboard

export async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string
    if (process.platform === 'win32') {
      // Windows: 使用 powershell 的 Set-Clipboard
      cmd = 'powershell -command Set-Clipboard -Value $input'
    } else if (process.platform === 'darwin') {
      cmd = 'pbcopy'
    } else {
      cmd = 'xclip -selection clipboard'
    }

    const proc = spawn(cmd, { shell: true, stdio: 'pipe' })
    proc.stdin.write(text)
    proc.stdin.end()
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Copy failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

export async function readFromClipboard(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let cmd: string
    if (process.platform === 'win32') {
      cmd = 'powershell -command Get-Clipboard'
    } else if (process.platform === 'darwin') {
      cmd = 'pbpaste'
    } else {
      cmd = 'xclip -selection clipboard -o'
    }

    const proc = spawn(cmd, { shell: true, stdio: 'pipe' })
    let data = ''
    proc.stdout.on('data', (chunk) => { data += chunk })
    proc.on('exit', () => {
      const text = data.replace(/\r?\n$/, '')  // 移除末尾换行
      resolve(text || null)
    })
    proc.on('error', () => resolve(null))
  })
}
