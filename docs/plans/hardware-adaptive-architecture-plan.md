# 硬件自适应架构实施计划

**目标**：为 licode 项目设计并实现硬件自适应架构，根据系统硬件能力自动调整运行时参数，实现零配置优化。

**日期**：2026-07-04

## 背景

licode 项目当前所有配置都是硬编码，完全没有硬件感知能力。不同硬件配置的机器（如 2 核 4GB 内存的笔记本 vs 16 核 32GB 内存的开发机）运行相同代码，无法根据硬件能力优化性能。

## 设计约束

1. 不改现有 Config schema（用户说纯自动）
2. 启动时一次性采集，零运行时开销
3. 模块化设计，方便后续扩展
4. 保持向后兼容（默认值不变，只在特定硬件上做优化）
5. 用户不覆盖，纯自动

## 步骤

### Step 1: 创建硬件信息采集模块
- **文件位置**：`packages/config/hardware.ts`
- **职责**：启动时一次性采集硬件信息，缓存结果
- **采集内容**：
  - CPU 核数（逻辑核心）
  - 总内存大小（GB）
  - 可用内存（GB）
  - 平台（win32/darwin/linux）
  - 架构（x64/arm64）
  - V8 版本
- **输出数据结构**：
```typescript
interface HardwareProfile {
  cpu: {
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
  isSSD: boolean // 磁盘类型检测（Windows 用 PowerShell，Linux/Mac 用系统命令）
  hardwareTier: 'low' | 'medium' | 'high' // 硬件分级
}
```
- **verify**：运行 `bun run packages/config/hardware.ts` 能输出完整硬件信息

### Step 2: 实现硬件分级策略
- **分级规则**：
  - **低 (low)**：CPU ≤ 2 核 或 内存 ≤ 4GB
  - **中 (medium)**：CPU 3-8 核 且 内存 4-16GB
  - **高 (high)**：CPU > 8 核 且 内存 > 16GB
- **平台特殊处理**：
  - Windows：用 PowerShell 检测 SSD（`Get-PhysicalDisk`）
  - Linux：用 `/sys/block/*/queue/rotational` 检测
  - macOS：用 `diskutil` 检测
- **verify**：在不同硬件配置的机器上运行，验证分级正确

### Step 3: 创建硬件自适应配置生成器
- **文件位置**：`packages/config/adaptive.ts`
- **职责**：根据 HardwareProfile 生成优化的配置参数
- **输出数据结构**：
```typescript
interface AdaptiveConfig {
  subagent: {
    maxConcurrent: number
    timeoutMs: number
  }
  compaction: {
    maxMessages: number
    maxTokens: number
    preserveRecent: number
    debounceMs: number
  }
  llm: {
    temperature: number
    maxTokens: number
  }
  tool: {
    batchSize: number // 工具批处理大小
    streamEnabled: boolean // 是否启用流式执行
  }
  memory: {
    cacheSizeMB: number // 内存缓存大小
    retentionDays: number
  }
  disk: {
    ioStrategy: 'batch' | 'stream' // 磁盘 IO 策略
  }
}
```
- **verify**：调用 `generateAdaptiveConfig()` 返回合理的配置值

### Step 4: 实现自适应参数映射规则
- **并发控制**：
  - low: maxConcurrent = 2
  - medium: maxConcurrent = 4
  - high: maxConcurrent = 6
- **缓存策略**：
  - low: maxMessages = 500, maxTokens = 100_000, preserveRecent = 50
  - medium: maxMessages = 1000, maxTokens = 200_000, preserveRecent = 100
  - high: maxMessages = 2000, maxTokens = 400_000, preserveRecent = 200
- **LLM 参数**：
  - low: temperature = 0.5, maxTokens = 4096
  - medium: temperature = 0.7, maxTokens = 8192
  - high: temperature = 0.7, maxTokens = 16384
- **工具执行策略**：
  - low: batchSize = 1, streamEnabled = false
  - medium: batchSize = 3, streamEnabled = true
  - high: batchSize = 5, streamEnabled = true
- **内存缓存**：
  - low: cacheSizeMB = 64
  - medium: cacheSizeMB = 256
  - high: cacheSizeMB = 512
- **磁盘 IO**：
  - SSD + high: ioStrategy = 'stream'
  - SSD + medium: ioStrategy = 'batch'
  - HDD: ioStrategy = 'batch'（保守策略）
- **verify**：验证每个参数在不同硬件配置下的映射正确

### Step 5: 集成到配置加载流程
- **修改文件**：`packages/config/loader.ts`
- **集成点**：在 `discoverAndLoad()` 方法末尾，加载完用户配置后，合并硬件自适应配置
- **合并策略**：硬件自适应配置作为基础层，用户配置可以覆盖（但用户说纯自动，所以实际用户配置优先级更高）
- **缓存机制**：硬件信息在进程生命周期内只采集一次
- **verify**：启动时日志显示 "[config] Hardware adaptive config applied"

### Step 6: 修改硬编码值引用
- **修改文件 1**：`packages/core/phases/execute/main.ts`
  - Line 175: `new SubagentManager({ maxConcurrent: 3, ... })` → 使用自适应配置
  - Line 39: `temperature: 0.7` → 使用自适应配置
  - Line 255: `PRESERVE_RECENT = hasSummary ? 100 : 200` → 使用自适应配置
- **修改文件 2**：`packages/core/subagent.ts`
  - Line 113: `temperature: 0.7` → 使用自适应配置
- **修改文件 3**：`packages/core/session-compactor.ts`
  - Line 47-58: `DEFAULT_CONFIG` → 使用自适应配置
- **verify**：运行 `bun run dev`，验证配置生效

### Step 7: 添加硬件信息日志输出
- **修改文件**：`packages/config/loader.ts`
- **日志格式**：
```
[config] Hardware: 8 cores, 16GB RAM, SSD
[config] Hardware tier: medium
[config] Adaptive config applied: maxConcurrent=4, temperature=0.7
```
- **日志级别**：INFO（启动时输出一次）
- **verify**：启动时看到硬件信息日志

### Step 8: 编写测试用例
- **测试文件**：`packages/config/__tests__/hardware.test.ts`
- **测试内容**：
  - 硬件信息采集功能
  - 硬件分级逻辑
  - 自适应配置生成
  - 参数映射规则
- **verify**：`bun test packages/config/__tests__/hardware.test.ts` 全部通过

### Step 9: 更新文档
- **更新文件**：`CHANGELOG.md`
- **更新内容**：添加硬件自适应功能说明
- **verify**：文档更新完成

## 不做什么

1. **不修改 Config schema**：用户说纯自动，不增加用户可配置的硬件相关字段
2. **不添加运行时动态调整**：启动时一次性采集，运行期间不重新检测
3. **不添加硬件监控**：不监控 CPU/内存使用率，只采集静态硬件信息
4. **不处理特殊情况**：如容器环境、虚拟机等特殊环境的硬件检测
5. **不添加用户覆盖接口**：纯自动，用户无法手动调整硬件自适应参数

## 实施顺序

建议按以下顺序实施：

1. **Phase 1**（基础）：Step 1 + Step 2（硬件采集 + 分级）
2. **Phase 2**（核心）：Step 3 + Step 4（配置生成 + 映射规则）
3. **Phase 3**（集成）：Step 5 + Step 6（配置加载 + 硬编码修改）
4. **Phase 4**（完善）：Step 7 + Step 8 + Step 9（日志 + 测试 + 文档）

## 风险评估

1. **平台兼容性**：不同操作系统的磁盘检测方式不同，需要测试 Windows/Linux/macOS
2. **硬件误判**：某些硬件配置可能被错误分级，需要调整阈值
3. **配置冲突**：自适应配置与用户配置的合并策略需要仔细设计
4. **性能影响**：硬件检测应该快速完成，不影响启动时间

## 验证方法

1. **单元测试**：每个模块独立测试
2. **集成测试**：在不同硬件配置的机器上测试
3. **性能测试**：验证硬件检测的性能影响
4. **兼容性测试**：在 Windows/Linux/macOS 上测试