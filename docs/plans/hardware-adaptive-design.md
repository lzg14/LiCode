# 硬件自适应架构设计文档

**目标**：为 licode 项目设计硬件自适应架构，根据系统硬件能力自动调整运行时参数。

**日期**：2026-07-04

## 1. 新模块设计

### 1.1 文件位置
```
packages/config/hardware.ts      # 硬件信息采集
packages/config/adaptive.ts      # 自适应配置生成
```

### 1.2 接口设计

#### HardwareProfile（硬件信息）
```typescript
export interface HardwareProfile {
  cpu: {
    cores: number           // 逻辑核心数
    model: string           // CPU 型号
    speed: number           // CPU 频率 (MHz)
  }
  memory: {
    totalGB: number         // 总内存 (GB)
    freeGB: number          // 可用内存 (GB)
    usedPercent: number     // 内存使用率 (%)
  }
  platform: NodeJS.Platform // 操作系统平台
  arch: string              // 系统架构 (x64/arm64)
  v8Version: string         // V8 版本
  isSSD: boolean            // 是否为 SSD
  hardwareTier: 'low' | 'medium' | 'high'  // 硬件分级
}
```

#### AdaptiveConfig（自适应配置）
```typescript
export interface AdaptiveConfig {
  subagent: {
    maxConcurrent: number   // 最大并发数
    timeoutMs: number       // 超时时间 (ms)
  }
  compaction: {
    maxMessages: number     // 触发压缩的消息数阈值
    maxTokens: number       // 触发压缩的 token 数阈值
    preserveRecent: number  // 压缩后保留的最近消息数
    debounceMs: number      // 防抖间隔 (ms)
  }
  llm: {
    temperature: number     // 温度参数
    maxTokens: number       // 最大 token 数
  }
  tool: {
    batchSize: number       // 工具批处理大小
    streamEnabled: boolean  // 是否启用流式执行
  }
  memory: {
    cacheSizeMB: number     // 内存缓存大小 (MB)
    retentionDays: number   // 记忆保留天数
  }
  disk: {
    ioStrategy: 'batch' | 'stream'  // 磁盘 IO 策略
  }
}
```

## 2. 硬件分级策略

### 2.1 分级规则

| 硬件等级 | CPU 核心数 | 内存大小 | 适用场景 |
|---------|-----------|---------|---------|
| **低 (low)** | ≤ 2 核 | ≤ 4 GB | 老旧笔记本、低配云服务器 |
| **中 (medium)** | 3-8 核 | 4-16 GB | 普通开发机、中配云服务器 |
| **高 (high)** | > 8 核 | > 16 GB | 高配开发机、工作站 |

### 2.2 磁盘类型检测

| 平台 | 检测方法 | 命令示例 |
|-----|---------|---------|
| **Windows** | PowerShell | `Get-PhysicalDisk \| Select MediaType` |
| **Linux** | 读取系统文件 | `cat /sys/block/*/queue/rotational` |
| **macOS** | diskutil | `diskutil info disk0 \| grep "Solid State"` |

### 2.3 平台特殊处理

- **Windows**：使用 `os.cpus()[0].model` 获取 CPU 型号
- **Linux**：使用 `/proc/cpuinfo` 获取详细信息
- **macOS**：使用 `sysctl` 获取硬件信息
- **容器环境**：检测 `/proc/1/cgroup` 判断是否在容器中

## 3. 自适应参数映射规则

### 3.1 并发控制

| 硬件等级 | maxConcurrent | timeoutMs | 说明 |
|---------|--------------|-----------|------|
| low | 2 | 120000 | 保守策略，避免资源争抢 |
| medium | 4 | 900000 | 平衡性能与资源 |
| high | 6 | 900000 | 充分利用多核优势 |

### 3.2 缓存策略（Session Compactor）

| 硬件等级 | maxMessages | maxTokens | preserveRecent | debounceMs |
|---------|------------|-----------|---------------|------------|
| low | 500 | 100,000 | 50 | 300,000 (5min) |
| medium | 1000 | 200,000 | 100 | 600,000 (10min) |
| high | 2000 | 400,000 | 200 | 600,000 (10min) |

**设计理由**：
- 低配机内存小，减少缓存避免 OOM
- 高配机内存大，增加缓存提升用户体验
- 低配机防抖间隔短，避免频繁压缩消耗 CPU

### 3.3 LLM 参数

| 硬件等级 | temperature | maxTokens | 说明 |
|---------|------------|-----------|------|
| low | 0.5 | 4096 | 保守生成，减少 token 消耗 |
| medium | 0.7 | 8192 | 平衡创造性与资源消耗 |
| high | 0.7 | 16384 | 充分利用模型能力 |

**设计理由**：
- 低配机降低 temperature 减少随机性，提高确定性
- 高配机增加 maxTokens 支持更复杂的推理

### 3.4 工具执行策略

| 硬件等级 | batchSize | streamEnabled | 说明 |
|---------|----------|--------------|------|
| low | 1 | false | 串行执行，避免并发压力 |
| medium | 3 | true | 小批量并行 + 流式 |
| high | 5 | true | 大批量并行 + 流式 |

**设计理由**：
- 低配机 CPU 核心少，并行收益低，串行更稳定
- 高配机充分利用多核，并行提升吞吐量

### 3.5 内存缓存

| 硬件等级 | cacheSizeMB | retentionDays | 说明 |
|---------|------------|---------------|------|
| low | 64 | 30 | 小缓存，节省内存 |
| medium | 256 | 30 | 中等缓存，平衡性能 |
| high | 512 | 60 | 大缓存，提升体验 |

**设计理由**：
- 缓存大小与可用内存成正比
- 高配机 retentionDays 更长，减少重复计算

### 3.6 磁盘 IO 策略

| 硬盘类型 | 硬件等级 | ioStrategy | 说明 |
|---------|---------|-----------|------|
| SSD | low | batch | SSD 速度快，但 CPU 限制并发 |
| SSD | medium | batch | 平衡性能与稳定性 |
| SSD | high | stream | 充分利用 SSD 速度优势 |
| HDD | any | batch | HDD 速度慢，避免频繁 IO |

**设计理由**：
- SSD 随机读写快，适合流式处理
- HDD 顺序读写快，批量处理更高效
- 低配机即使有 SSD，也用 batch 避免 CPU 成为瓶颈

## 4. 集成点

### 4.1 配置加载流程修改

**文件**：`packages/config/loader.ts`

**修改位置**：`discoverAndLoad()` 方法末尾（约第 85 行）

**修改内容**：
```typescript
// 在 return this.config 之前添加
import { getHardwareProfile, generateAdaptiveConfig } from './adaptive'

// 合并硬件自适应配置
const hardwareProfile = getHardwareProfile()
const adaptiveConfig = generateAdaptiveConfig(hardwareProfile)
this.config = mergeAdaptiveConfig(this.config, adaptiveConfig)

// 日志输出
process.stderr.write(`[config] Hardware: ${hardwareProfile.cpu.cores} cores, ${hardwareProfile.memory.totalGB}GB RAM, ${hardwareProfile.isSSD ? 'SSD' : 'HDD'}\n`)
process.stderr.write(`[config] Hardware tier: ${hardwareProfile.hardwareTier}\n`)
```

### 4.2 硬编码值修改

#### 文件 1：`packages/core/phases/execute/main.ts`

**修改 1**：Line 175（SubagentManager 初始化）
```typescript
// 修改前
const subagentManager = new SubagentManager({ maxConcurrent: 3, timeoutMs: 120000, blockedTools: ["subagent"] })

// 修改后
import { getAdaptiveConfig } from '../../../config/adaptive'
const adaptiveConfig = getAdaptiveConfig()
const subagentManager = new SubagentManager({
  maxConcurrent: adaptiveConfig.subagent.maxConcurrent,
  timeoutMs: adaptiveConfig.subagent.timeoutMs,
  blockedTools: ["subagent"]
})
```

**修改 2**：Line 39（temperature 参数）
```typescript
// 修改前
temperature: 0.7,

// 修改后
temperature: getAdaptiveConfig().llm.temperature,
```

**修改 3**：Line 255（PRESERVE_RECENT 常量）
```typescript
// 修改前
const PRESERVE_RECENT = hasSummary ? 100 : 200

// 修改后
const adaptiveConfig = getAdaptiveConfig()
const PRESERVE_RECENT = hasSummary
  ? adaptiveConfig.compaction.preserveRecent
  : adaptiveConfig.compaction.preserveRecent * 2
```

#### 文件 2：`packages/core/subagent.ts`

**修改位置**：Line 113（temperature 参数）

```typescript
// 修改前
temperature: 0.7,

// 修改后
import { getAdaptiveConfig } from '../config/adaptive'
// ... 在 spawn 方法中
temperature: getAdaptiveConfig().llm.temperature,
```

#### 文件 3：`packages/core/session-compactor.ts`

**修改位置**：Line 47-58（DEFAULT_CONFIG）

```typescript
// 修改前
const DEFAULT_CONFIG: CompactionConfig = {
  maxMessages: 1000,
  maxTokens: 200_000,
  unknownModelThreshold: 100_000,
  preserveRecent: 100,
  debounceMs: 600_000,
  dataDir: '',
}

// 修改后
import { getAdaptiveConfig } from '../config/adaptive'

const DEFAULT_CONFIG: CompactionConfig = {
  maxMessages: getAdaptiveConfig().compaction.maxMessages,
  maxTokens: getAdaptiveConfig().compaction.maxTokens,
  unknownModelThreshold: 100_000,  // 保持不变
  preserveRecent: getAdaptiveConfig().compaction.preserveRecent,
  debounceMs: getAdaptiveConfig().compaction.debounceMs,
  dataDir: '',
}
```

### 4.3 硬件信息缓存机制

**文件**：`packages/config/hardware.ts`

**实现**：
```typescript
let cachedProfile: HardwareProfile | null = null

export function getHardwareProfile(): HardwareProfile {
  if (cachedProfile) return cachedProfile
  
  cachedProfile = collectHardwareInfo()
  return cachedProfile
}

function collectHardwareInfo(): HardwareProfile {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  
  const profile: HardwareProfile = {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model ?? 'unknown',
      speed: cpus[0]?.speed ?? 0,
    },
    memory: {
      totalGB: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10,
      freeGB: Math.round((freeMem / 1024 / 1024 / 1024) * 10) / 10,
      usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    platform: os.platform(),
    arch: os.arch(),
    v8Version: process.versions.v8 ?? 'unknown',
    isSSD: detectSSD(),
    hardwareTier: 'medium', // 默认值，下面计算
  }
  
  // 计算硬件分级
  profile.hardwareTier = calculateTier(profile)
  
  return profile
}
```

## 5. 实施步骤

### Step 1: 创建硬件信息采集模块
- 创建 `packages/config/hardware.ts`
- 实现 `collectHardwareInfo()` 函数
- 实现 `detectSSD()` 函数（支持 Windows/Linux/macOS）
- 实现 `calculateTier()` 函数
- **verify**：运行 `bun run packages/config/hardware.ts` 输出完整硬件信息

### Step 2: 创建自适应配置生成器
- 创建 `packages/config/adaptive.ts`
- 实现 `generateAdaptiveConfig()` 函数
- 实现 `mergeAdaptiveConfig()` 函数
- 实现 `getAdaptiveConfig()` 单例函数
- **verify**：调用 `getAdaptiveConfig()` 返回合理的配置值

### Step 3: 集成到配置加载流程
- 修改 `packages/config/loader.ts`
- 在 `discoverAndLoad()` 末尾合并自适应配置
- 添加硬件信息日志输出
- **verify**：启动时日志显示硬件信息

### Step 4: 修改硬编码值引用
- 修改 `packages/core/phases/execute/main.ts`
- 修改 `packages/core/subagent.ts`
- 修改 `packages/core/session-compactor.ts`
- **verify**：运行 `bun run dev` 验证配置生效

### Step 5: 编写测试用例
- 创建 `packages/config/__tests__/hardware.test.ts`
- 测试硬件信息采集
- 测试硬件分级逻辑
- 测试自适应配置生成
- **verify**：`bun test packages/config/__tests__/hardware.test.ts` 通过

### Step 6: 更新文档
- 更新 `CHANGELOG.md`
- 更新 `README.md`（如有必要）
- **verify**：文档更新完成

## 6. 验证方法

### 6.1 单元测试
```bash
# 测试硬件采集
bun test packages/config/__tests__/hardware.test.ts

# 测试配置生成
bun test packages/config/__tests__/adaptive.test.ts
```

### 6.2 集成测试
```bash
# 启动应用，观察日志
bun run dev

# 预期日志：
# [config] Hardware: 8 cores, 16GB RAM, SSD
# [config] Hardware tier: medium
# [config] Adaptive config applied: maxConcurrent=4, temperature=0.7
```

### 6.3 性能测试
```bash
# 测量启动时间
time bun run dev

# 预期：硬件检测增加的启动时间 < 100ms
```

### 6.4 兼容性测试
- Windows 10/11
- Linux (Ubuntu 20.04+)
- macOS 12+

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 磁盘检测失败 | 无法判断 SSD/HDD | 默认假设为 HDD，使用保守策略 |
| 硬件误判 | 参数不匹配 | 提供日志输出，便于调试 |
| 配置冲突 | 自适应配置被覆盖 | 明确合并策略，用户配置优先 |
| 启动时间增加 | 用户体验下降 | 优化检测逻辑，控制在 100ms 内 |

## 8. 扩展性考虑

### 8.1 未来扩展点
- 支持 GPU 检测（用于 AI 推理加速）
- 支持网络带宽检测（用于远程工具调用）
- 支持动态调整（运行时监控硬件使用率）
- 支持用户覆盖（通过配置文件手动调整）

### 8.2 模块化设计
- `hardware.ts`：独立模块，可单独测试
- `adaptive.ts`：独立模块，可单独测试
- 配置生成逻辑与采集逻辑分离
- 映射规则可配置化（未来可从配置文件读取）