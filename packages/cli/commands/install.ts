/**
 * licode install 命令
 * 
 * 安装扩展、技能、主题等包
 * 
 * 用法：
 *   licode install npm:@example/my-tools
 *   licode install git:github.com/user/repo
 *   licode install ./local-extension
 */

import { access, readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join, basename, resolve } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { devLogger } from '../../core/dev-logger'

/** 包来源类型 */
type PackageSource = 
  | { type: 'npm'; name: string; version?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }

/** 安装选项 */
export interface InstallOptions {
  /** 是否本地安装（项目级） */
  local?: boolean
  /** 安装目录 */
  dir?: string
}

/**
 * 解析包来源
 */
function parseSource(source: string): PackageSource {
  if (source.startsWith('npm:')) {
    const name = source.slice(4)
    const atIdx = name.lastIndexOf('@')
    if (atIdx > 0) {
      return { type: 'npm', name: name.slice(0, atIdx), version: name.slice(atIdx + 1) }
    }
    return { type: 'npm', name }
  }

  if (source.startsWith('git:') || source.startsWith('https://') || source.startsWith('ssh://')) {
    const url = source.startsWith('git:') ? `https://${source.slice(4)}` : source
    const atIdx = url.lastIndexOf('@')
    if (atIdx > 0) {
      return { type: 'git', url: url.slice(0, atIdx), ref: url.slice(atIdx + 1) }
    }
    return { type: 'git', url }
  }

  // 本地路径
  return { type: 'local', path: resolve(source) }
}

/**
 * 获取安装目录
 */
function getInstallDir(options: InstallOptions): string {
  if (options.dir) return options.dir
  if (options.local) {
    return join(process.cwd(), '.licode', 'npm')
  }
  return join(homedir(), '.licode', 'npm')
}

/**
 * 安装 npm 包
 */
async function installNpm(source: PackageSource & { type: 'npm' }, targetDir: string): Promise<string> {
  const pkgDir = join(targetDir, source.name)
  
  await mkdir(pkgDir, { recursive: true })
  
  // 创建 package.json
  const pkgJson = {
    name: source.name,
    version: source.version || 'latest',
    pi: {}, // pi package manifest
  }
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2))

  // 使用 npm 安装
  const cmd = `npm install ${source.name}${source.version ? `@${source.version}` : ''} --prefix ${targetDir}`
  devLogger.info('INSTALL', `Running: ${cmd}`)
  
  try {
    execSync(cmd, { stdio: 'inherit', cwd: targetDir })
    return pkgDir
  } catch (e) {
    throw new Error(`Failed to install ${source.name}: ${e}`)
  }
}

/**
 * 安装 git 包
 */
async function installGit(source: PackageSource & { type: 'git' }, targetDir: string): Promise<string> {
  const repoName = basename(source.url).replace(/\.git$/, '')
  const pkgDir = join(targetDir, repoName)
  
  // 克隆仓库
  const refArg = source.ref ? `-b ${source.ref}` : ''
  const cmd = `git clone ${refArg} ${source.url} ${pkgDir}`
  devLogger.info('INSTALL', `Running: ${cmd}`)
  
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch (e) {
    throw new Error(`Failed to clone ${source.url}: ${e}`)
  }

  // 安装依赖
  try {
    execSync('npm install --omit=dev', { stdio: 'inherit', cwd: pkgDir })
  } catch (e) {
    devLogger.warn('INSTALL', `Failed to install dependencies: ${e}`)
  }

  return pkgDir
}

/**
 * 安装本地包
 */
async function installLocal(source: PackageSource & { type: 'local' }, targetDir: string): Promise<string> {
  const pkgDir = join(targetDir, basename(source.path))
  
  // 检查源目录是否存在
  try {
    await access(source.path)
  } catch {
    throw new Error(`Source directory not found: ${source.path}`)
  }

  // 复制目录（使用 cp -r）
  const cmd = `cp -r ${source.path} ${pkgDir}`
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch (e) {
    throw new Error(`Failed to copy ${source.path}: ${e}`)
  }

  return pkgDir
}

/**
 * 执行安装
 */
export async function runInstall(sourceStr: string, options: InstallOptions = {}): Promise<void> {
  const source = parseSource(sourceStr)
  const targetDir = getInstallDir(options)

  await mkdir(targetDir, { recursive: true })

  let pkgDir: string

  switch (source.type) {
    case 'npm':
      pkgDir = await installNpm(source, targetDir)
      break
    case 'git':
      pkgDir = await installGit(source, targetDir)
      break
    case 'local':
      pkgDir = await installLocal(source, targetDir)
      break
  }

  devLogger.info('INSTALL', `Installed to: ${pkgDir}`)
  console.log(`✅ Installed: ${sourceStr}`)
}

/**
 * 列出已安装的包
 */
export async function listPackages(options: InstallOptions = {}): Promise<string[]> {
  const targetDir = getInstallDir(options)
  
  try {
    const entries = await readdir(targetDir)
    return entries.filter(async (entry) => {
      try {
        await access(join(targetDir, entry, 'package.json'))
        return true
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/**
 * 卸载包
 */
export async function uninstallPackage(name: string, options: InstallOptions = {}): Promise<void> {
  const targetDir = getInstallDir(options)
  const pkgDir = join(targetDir, name)

  try {
    await access(pkgDir)
    const { rm } = await import('fs/promises')
    await rm(pkgDir, { recursive: true, force: true })
    console.log(`✅ Uninstalled: ${name}`)
  } catch {
    console.log(`❌ Package not found: ${name}`)
  }
}
