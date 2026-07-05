import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'
import { execFile as execFileCb } from 'node:child_process'

const execFile = promisify(execFileCb)

/**
 * 硬件信息（M1 智能增强 §4.M1）
 *
 * 设计文档：docs/plans/hardware-adaptive-design.md
 * 实施计划：docs/plans/intelligence-enhancement-plan.md §4.M1
 */
export interface HardwareProfile {
  cpu: {
    /** 逻辑核心数（注意：容器环境可能不准，见 isContainer）*/
    cores: number
    model: string
    speed: number
  }
  memory: {
    totalGB: number
    freeGB: number
    usedPercent: number
  }
  platform: NodeJS.Platform
  arch: string
  v8Version: string
  /** 至少一个磁盘是 SSD；检测失败默认 true（乐观）*/
  isSSD: boolean
  /** 是否在容器中（cgroup v1/v2）*/
  isContainer: boolean
  hardwareTier: 'low' | 'medium' | 'high'
}

let cachedProfile: HardwareProfile | null = null

/** 获取硬件信息（启动时一次性采集，缓存复用）*/
export function getHardwareProfile(): HardwareProfile {
  if (cachedProfile) return cachedProfile
  cachedProfile = collectHardwareInfo()
  return cachedProfile
}

/** 重置缓存（仅供测试使用）*/
export function _resetHardwareCache(): void {
  cachedProfile = null
}

function collectHardwareInfo(): HardwareProfile {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  const isContainer = detectContainer()

  const profile: HardwareProfile = {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model ?? 'unknown',
      speed: cpus[0]?.speed ?? 0,
    },
    memory: {
      totalGB: round1(totalMem / 1024 / 1024 / 1024),
      freeGB: round1(freeMem / 1024 / 1024 / 1024),
      usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    platform: os.platform(),
    arch: os.arch(),
    v8Version: process.versions.v8 ?? 'unknown',
    isSSD: detectSSDSync(),
    isContainer,
    hardwareTier: 'medium',
  }

  // 容器环境：cgroup 限制可能远低于 os.cpus() 返回，保守降级
  profile.hardwareTier = calculateTier(profile, isContainer)

  return profile
}

/**
 * 硬件分级
 * @param isContainer 容器环境保守降级（避免按宿主核心数误判 high）
 */
export function calculateTier(
  p: Pick<HardwareProfile, 'cpu' | 'memory'>,
  isContainer = false,
): 'low' | 'medium' | 'high' {
  // 容器环境：cgroup 限制通常为 1-2 核，强制按 medium 起步
  if (isContainer) {
    if (p.cpu.cores <= 1) return 'low'
    if (p.cpu.cores >= 8 && p.memory.totalGB >= 16) return 'high'
    return 'medium'
  }

  if (p.cpu.cores <= 2 && p.memory.totalGB <= 4) return 'low'
  if (p.cpu.cores > 8 && p.memory.totalGB > 16) return 'high'
  if (p.cpu.cores <= 2 || p.memory.totalGB <= 4) return 'low'
  if (p.cpu.cores > 8 || p.memory.totalGB > 16) return 'high'
  return 'medium'
}

/**
 * 检测是否在容器中（cgroup v1/v2 + Docker env）
 */
function detectContainer(): boolean {
  // 1. 环境变量（最可靠）
  if (process.env.DOCKER_CONTAINER || process.env.KUBERNETES_SERVICE_HOST) return true

  // 2. /proc/1/cgroup（Linux）
  if (existsSync('/proc/1/cgroup')) {
    try {
      const cgroup = readFileSync('/proc/1/cgroup', 'utf-8')
      if (cgroup.includes('docker') || cgroup.includes('kubepods') || cgroup.includes('containerd')) {
        return true
      }
    } catch {
      // 忽略读取错误
    }
  }

  // 3. /.dockerenv 存在
  return existsSync('/.dockerenv')
}

/**
 * 同步 SSD 检测（仅 Linux 通过 /sys 同步读，其他平台默认 true）
 *
 * 启动时如果走 macOS/Windows 子命令会卡 100ms+，不划算。
 * SSD 检测失败默认 true（乐观），仅影响 ioStrategy，不影响 tier。
 */
function detectSSDSync(): boolean {
  if (existsSync('/sys/block')) {
    try {
      const disks = readdirSync('/sys/block').slice(0, 20) // 限 20 个
      for (const disk of disks) {
        try {
          const rota = readFileSync(`/sys/block/${disk}/queue/rotational`, 'utf-8').trim()
          if (rota === '0') return true // 找到一个非旋转盘即 SSD
        } catch {
          continue
        }
      }
    } catch {
      // 忽略
    }
  }
  return true // 默认 SSD（多数现代机器）
}

/**
 * 异步 SSD 检测（用于 macOS/Windows，UI 启动后调用更新缓存）
 *
 * 不在启动路径上跑，避免阻塞。
 */
export async function detectSSDAsync(): Promise<boolean> {
  const platform = os.platform()
  try {
    if (platform === 'darwin') {
      const { stdout } = await execFile('diskutil', ['info', 'disk0'], { timeout: 3000 })
      return /Solid State|SSD/i.test(stdout)
    }
    if (platform === 'win32') {
      const { stdout } = await execFile(
        'powershell',
        ['-NoProfile', '-Command', 'Get-PhysicalDisk | Select-Object -ExpandProperty MediaType'],
        { timeout: 5000 },
      )
      return /SSD|Unspecified/i.test(stdout)
    }
  } catch {
    // 失败 fallback
  }
  return detectSSDSync()
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
