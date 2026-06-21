# Headroom 压缩集成到 licode 计划

> 作者：MiMoCode
> 日期：2026-06-21
> 状态：待评审

---

## 1. 背景

### 问题
licode 当前的上下文管理基于简单截断和规则提取，压缩效果有限：
- `SessionCompactor`: 基于规则的对话历史压缩（意图/文件/命令提取 + LLM 润色）
- 工具输出处理：简单的 truncate，超过限制直接砍断写文件

### 目标
集成 headroom 的智能压缩算法，提升 token 消耗效率 40-60%，同时保证 LLM 理解质量不降。

---

## 2. headroom 压缩算法分析

| 算法 | 功能 | 原理 | 难度 |
|------|------|------|------|
| **SmartCrusher** | JSON 数组智能压缩 | 位置偏差 + 统计异常检测 + 去重 | Rust/PyO3 |
| **CodeCompressor** | 源码 AST 压缩 | tree-sitter 解析，移除注释/空行 | tree-sitter |
| **SearchCompressor** | grep 结果压缩 | 冗余路径裁剪 + 文件分组 | Python |
| **LogCompressor** | 日志/测试输出压缩 | 日志级别过滤 + 相似行去重 | Rust |
| **KompressCompressor** | ML 文本压缩 | ModernBERT 选择语义最重要句子 | HuggingFace |
| **CacheAligner** | 前缀稳定化 | UUID/时间戳/哈希检测 + 日志告警 | Python |

---

## 3. 集成方案：混合架构

```
licode (TypeScript)
├── 内置: SearchCompressor (简单，纯 TS 重写)
├── 内置: CacheAligner (简单，纯 TS 重写)
│
└── Python 进程调用 (复杂算法)
    ├── SmartCrusher (JSON)
    ├── CodeCompressor (AST)
    └── KompressCompressor (ML，可选)
```

### 3.1 为什么选择混合架构

| 算法 | TS 重写 | Python 调用 | 选择 |
|------|---------|-------------|------|
| SearchCompressor | 简单 | - | **TS 内置** |
| CacheAligner | 简单 | - | **TS 内置** |
| SmartCrusher | 困难（已是 Rust） | 调用 headroom 包 | **Python** |
| CodeCompressor | 困难（依赖 tree-sitter） | 调用 headroom 包 | **Python** |
| KompressCompressor | 极难（ML 模型） | 调用 headroom 包 | **Python** |

---

## 4. 实施阶段

### Phase 1: 基础框架 (1-2 天)

**目标**：创建压缩模块的基础结构

- [ ] 创建 `packages/compression/` 包
- [ ] 定义统一的压缩接口 `Compressor`
- [ ] 创建 Python 子进程管理器 `PythonBridge`
- [ ] 实现配置系统

**产出**：
```
packages/compression/
├── src/
│   ├── index.ts           # 入口
│   ├── types.ts           # 接口定义
│   ├── pipeline.ts        # 压缩流水线
│   ├── python-bridge.ts   # Python 进程管理
│   └── config.ts          # 配置
└── package.json
```

**接口定义**：
```typescript
// types.ts
export interface Compressor {
  name: string
  compress(content: string, options?: CompressOptions): Promise<CompressResult>
}

export interface CompressResult {
  content: string
  ratio: number
  strategy: string
  metadata?: Record<string, any>
}

export interface CompressionPipeline {
  compress(content: string, context?: CompressionContext): Promise<CompressResult>
}
```

---

### Phase 2: 简单算法 TS 实现 (2-3 天)

**目标**：用 TypeScript 重写简单的压缩算法

#### 2.1 SearchCompressor

**功能**：压缩 grep/ripgrep 搜索结果

**算法**：
1. 按文件路径分组
2. 移除冗余的路径前缀
3. 合并相邻行的匹配结果
4. 裁剪重复的文件名

**代码量预估**：~200 行 TS

#### 2.2 CacheAligner

**功能**：检测并记录不稳定内容

**算法**：
1. UUID 检测（36 字符格式）
2. ISO 8601 时间戳检测
3. JWT 形状检测（三段 base64）
4. Hex 哈希检测（MD5/SHA1/SHA256 长度）

**代码量预估**：~150 行 TS

**产出**：
```
packages/compression/src/compressors/
├── search.ts
├── cache-aligner.ts
└── index.ts
```

---

### Phase 3: 核心算法 Python 调用 (3-5 天)

**目标**：通过 Python 进程调用 headroom 的复杂压缩算法

#### 3.1 PythonBridge 实现

```typescript
// python-bridge.ts
export class PythonBridge {
  private process: ChildProcess | null = null

  async compress(
    content: string,
    algorithm: 'smart-crusher' | 'code-aware' | 'kompress',
    options?: CompressOptions
  ): Promise<CompressResult>

  async start(): Promise<void>
  async stop(): Promise<void>
}
```

**Python 服务端**：
```python
# headroom_server.py
import sys
import json
from headroom import compress

for line in sys.stdin:
    request = json.loads(line)
    result = compress(
        [{"role": "user", "content": request["content"]}],
        model=request.get("model", "claude-sonnet-4-5-20250929")
    )
    print(json.dumps({
        "content": result.messages[0]["content"],
        "ratio": result.compression_ratio,
        "tokens_saved": result.tokens_saved
    }))
    sys.stdout.flush()
```

#### 3.2 SmartCrusher 集成

**功能**：JSON 数组智能压缩

**应用场景**：
- 工具输出的 JSON 结果
- API 响应的数组数据
- 日志/监控数据

#### 3.3 CodeCompressor 集成

**功能**：源码 AST 感知压缩

**应用场景**：
- Read 工具读取的大文件
- grep 结果中的代码片段

**产出**：
```
packages/compression/src/compressors/
├── smart-crusher.ts
├── code-aware.ts
└── python-bridge.ts

scripts/
└── headroom_server.py  # Python 服务端
```

---

### Phase 4: 集成到 licode 核心 (2-3 天)

**目标**：将压缩流水线接入 licode 的主要流程

#### 4.1 工具输出压缩

修改位置：
- `packages/core/phases/execute.ts` - 工具执行结果压缩
- `packages/tools/bash.ts` - Bash 命令输出压缩
- `packages/tools/grep.ts` - 搜索结果压缩
- `packages/tools/read.ts` - 文件内容压缩

**压缩触发条件**：
```typescript
if (output.length > MIN_TOKENS_THRESHOLD) {
  const result = await compressionPipeline.compress(output, {
    type: detectContentType(output),
    context: { toolName, args }
  })
  output = result.content
}
```

#### 4.2 对话历史压缩增强

修改位置：
- `packages/core/session-compactor.ts` - 增强压缩策略

**新策略**：
1. 保留最近 N 条消息不压缩（活跃对话）
2. 旧消息按类型压缩：
   - 工具输出 → SmartCrusher
   - 代码块 → CodeCompressor
   - 纯文本 → 规则提取（现有）

#### 4.3 配置集成

修改位置：
- `licode.config.json` - 添加压缩配置

```json
{
  "compression": {
    "enabled": true,
    "pythonPath": "python3",
    "algorithms": ["search", "smart-crusher", "code-aware"],
    "thresholds": {
      "minTokens": 250,
      "targetRatio": 0.7,
      "maxLatencyMs": 100
    },
    "cache": {
      "enabled": true,
      "ttlSeconds": 1800
    }
  }
}
```

**产出**：
- 修改 `packages/core/` 相关文件
- 新增配置项

---

### Phase 5: 优化与监控 (2-3 天)

**目标**：性能优化和可观测性

#### 5.1 结果缓存

```typescript
// packages/compression/src/cache.ts
export class CompressionCache {
  private cache = new Map<string, CompressResult>()

  get(contentHash: string): CompressResult | undefined
  set(contentHash: string, result: CompressResult): void
  clear(): void
}
```

#### 5.2 并发处理

- Python 连接池（预启动 2-3 个进程）
- 异步队列处理压缩请求
- 超时降级到简单截断

#### 5.3 性能监控

```typescript
// 添加到 LoopContext
interface CompressionMetrics {
  tokensSaved: number
  compressionRatio: number
  latencyMs: number
  strategy: string
}
```

**产出**：
- 缓存模块
- 监控埋点
- 性能测试用例

---

### Phase 6: ML 压缩（可选）(2-3 天)

**目标**：集成 KompressCompressor 用于对话历史

**触发条件**：对话超过 100k tokens

**算法**：基于 ModernBERT 选择语义最重要的句子，保留 ~15% 内容

**注意**：需要安装 `headroom-ai[ml]`，包含 HuggingFace 模型

---

## 5. 关键文件清单

### 新建文件
```
packages/compression/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── pipeline.ts
│   ├── python-bridge.ts
│   ├── cache.ts
│   ├── config.ts
│   └── compressors/
│       ├── index.ts
│       ├── search.ts
│       ├── cache-aligner.ts
│       ├── smart-crusher.ts
│       └── code-aware.ts
├── __tests__/
│   ├── search.test.ts
│   ├── cache-aligner.test.ts
│   └── pipeline.test.ts
├── package.json
└── tsconfig.json

scripts/
└── headroom_server.py
```

### 修改文件
```
packages/core/
├── loop.ts                    # 添加压缩流水线
├── session-compactor.ts       # 增强压缩策略
└── phases/execute.ts          # 工具输出压缩

packages/tools/
├── bash.ts                    # 命令输出压缩
├── grep.ts                    # 搜索结果压缩
├── read.ts                    # 文件内容压缩
└── write.ts                   # 可选：写入前验证

licode.config.json             # 添加压缩配置
```

---

## 6. Python 环境要求

### 最小依赖
```bash
pip install headroom-ai
```

### 完整依赖（含 ML）
```bash
pip install "headroom-ai[ml]"
```

### 可选：使用 venv
```bash
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# 或 .venv\Scripts\activate  # Windows
pip install headroom-ai
```

---

## 7. 配置说明

### 压缩算法选择

| 场景 | 推荐算法 | 说明 |
|------|----------|------|
| grep/搜索结果 | search | TS 内置，无依赖 |
| JSON 工具输出 | smart-crusher | Python 调用 |
| 源码文件 | code-aware | Python 调用 |
| 对话历史 | kompress | 可选，ML |
| 日志/测试输出 | log | Python 调用 |

### 阈值配置

```typescript
interface CompressionConfig {
  // 启用压缩
  enabled: boolean

  // 最小压缩阈值（token 数）
  minTokens: number  // 默认 250

  // 目标压缩比（保留比例）
  targetRatio: number  // 默认 0.7（保留 70%）

  // 最大延迟容忍（ms）
  maxLatencyMs: number  // 默认 100

  // Python 路径
  pythonPath: string  // 默认 "python3"

  // 缓存
  cacheEnabled: boolean  // 默认 true
  cacheTtlSeconds: number  // 默认 1800
}
```

---

## 8. 降级策略

当 Python 进程不可用或压缩失败时，自动降级：

1. **Python 不可用** → 使用 TS 内置的 SearchCompressor
2. **压缩超时** → 使用简单截断
3. **压缩后体积增大** → 保留原文

```typescript
// 降级逻辑
try {
  result = await pythonBridge.compress(content, algorithm)
} catch (error) {
  logger.warn(`Python compression failed, falling back to truncation`)
  result = { content: truncate(content, MAX_LENGTH), ratio: 1.0, strategy: 'truncate' }
}
```

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Python 进程启动慢 | 首次压缩延迟高 | 预启动 + 连接池 |
| 压缩质量下降 | LLM 理解错误 | 测试用例 + 人工 review |
| 性能瓶颈 | 响应变慢 | 异步处理 + 结果缓存 |
| 依赖管理 | 安装复杂 | 可选依赖，降级到截断 |
| Windows 兼容性 | 路径问题 | 跨平台测试 |

---

## 10. 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| Token 消耗减少 | 40-60% | 对比压缩前后 token 数 |
| LLM 理解质量 | 不降 | 测试用例通过率 |
| 延迟增加 | < 100ms | 性能测试 |
| 压缩成功率 | > 95% | 监控埋点 |
| 内存占用 | < 50MB | 运行时监控 |

---

## 11. 测试计划

### 单元测试
- SearchCompressor 算法测试
- CacheAligner 检测测试
- PythonBridge 通信测试

### 集成测试
- 压缩流水线端到端测试
- 工具输出压缩测试
- 对话历史压缩测试

### 性能测试
- 大文件压缩延迟
- 并发压缩吞吐量
- 内存占用监控

---

## 12. 附录

### A. headroom 源码位置
```
D:\ProjectFile\headroom\
├── headroom/transforms/      # Python 压缩算法
├── crates/                   # Rust 核心
└── pyproject.toml            # Python 包配置
```

### B. licode 相关文件
```
D:\ProjectFile\licode\
├── packages/core/loop.ts
├── packages/core/session-compactor.ts
├── packages/tools/
└── licode.config.json
```

### C. 参考资料
- [headroom GitHub](https://github.com/chopratejas/headroom)
- [headroom 源码分析](HEADROOM_ANALYSIS.md)
- [RTK - Rust Token Killer](https://github.com/rtk-ai/rtk)
