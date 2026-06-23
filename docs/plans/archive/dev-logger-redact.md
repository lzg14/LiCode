> ⚠️ **本文档已完成（2026-06-21）**
>
> 阻止 API key / token / 密码写入 `~/.licode/logs/dev/`，同时降低日志噪声。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# devLogger 安全修复计划

**目标**：阻止敏感信息（API key、token、密码）写入 `~/.licode/logs/dev/` 日志文件，同时降低日志噪音。

**日期**：2026-06-21
**优先级**：P0（已确认 key 泄露）

---

## 问题

`C:\Users\lzg14\.licode\logs\dev\dev-*.log` 实际包含真实 API key：

```
"apiKey": "sk-c784f95657e641a0a836116b5b869805",
```

### 漏洞链路

1. LLM 调 `read({path: "C:/Users/lzg14/licode.config.json"})`
2. config 里的 `"apiKey"` 字段被读进 `execResult.output`
3. `packages/core/dev-logger.ts:114` 的 `logToolCall` 把整个 result 写日志
4. 日志文件暴露明文 key

### 风险

- 日志被云盘同步（OneDrive 等）→ key 上云
- 日志纳入 git 历史 → key 长期泄露
- 用户截图分享 → key 公开
- 机器失窃 → key 直接可用

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不替换 devLogger 为生产 logger | 当前阶段重点是 redact，不是架构 |
| 不加日志加密 | 单机工具，引入密钥管理复杂度不值得 |
| 不删日志功能 | debug 价值高，只是不应含敏感数据 |
| 不做日志轮转 | 已有日志清理机制（按 sessionId 分文件）|

---

## 步骤

- [ ] **Step 1：写 redact 工具函数**
  - 新建 `packages/core/dev-logger-redact.ts`（或放在 dev-logger.ts 同文件）
  - 实现：
    ```ts
    const REDACT_KEYS = [
      'apikey', 'api_key', 'api-key',
      'token', 'access_token', 'refresh_token',
      'password', 'passwd', 'pwd',
      'secret', 'client_secret',
      'authorization', 'auth',
    ]

    // 匹配内联 key 字符串
    const INLINE_PATTERNS: RegExp[] = [
      /sk-ant-api[0-9]{2}-[A-Za-z0-9_\-]{20,}/g,  // Anthropic
      /sk-[A-Za-z0-9]{20,}/g,                       // OpenAI 旧
      /sk-proj-[A-Za-z0-9_\-]{20,}/g,                // OpenAI 新
      /sk-[A-Za-z0-9]{32}/g,                        // DeepSeek / MiniMax
      /ghp_[A-Za-z0-9]{36}/g,                        // GitHub PAT
      /xox[abpr]-[0-9]+-[0-9]+-[A-Za-z0-9]+/g,     // Slack
      /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,            // Bearer token
      /ANTHROPIC_API_KEY=[^\s]{10,}/g,              // env-style
      /OPENAI_API_KEY=[^\s]{10,}/g,
    ]

    export function redact(obj: unknown): unknown {
      if (obj == null) return obj
      if (typeof obj === 'string') {
        return INLINE_PATTERNS.reduce((s, p) => s.replace(p, '***REDACTED***'), obj)
      }
      if (Array.isArray(obj)) return obj.map(redact)
      if (typeof obj === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
          if (REDACT_KEYS.some(rk => k.toLowerCase().includes(rk))) {
            out[k] = '***REDACTED***'
          } else {
            out[k] = redact(v)
          }
        }
        return out
      }
      return obj
    }
    ```
  - **verify**：
    ```ts
    redact({ apiKey: 'sk-xxx', name: 'foo' })  // { apiKey: '***REDACTED***', name: 'foo' }
    redact('my key is sk-ant-api03-abc123def456ghi789jkl012mno')  // 'my key is ***REDACTED***'
    redact([{ token: 'x' }, 42, 'plain'])  // [{ token: '***REDACTED***' }, 42, 'plain']
    ```

- [ ] **Step 2：在 logToolCall 应用 redact**
  - `packages/core/dev-logger.ts:114`：
    ```ts
    logToolCall(toolName: string, args: unknown, result?: unknown, duration?: number) {
      const msg = duration !== undefined
        ? `>>> Tool Call | ${toolName} | ${duration}ms`
        : `>>> Tool Call | ${toolName}`
      this.info('TOOL', msg, { args: redact(args), result: redact(result) })
    }
    ```
  - **verify**：
    ```bash
    # 在 TUI 里跑 read ~/.licode/licode.config.json（或类似）
    # 检查日志：apiKey 字段应是 ***REDACTED***
    ```

- [ ] **Step 3：在 logLLMRequest 应用 redact**
  - `packages/core/dev-logger.ts:92-95`：messages 内容可能含用户粘贴的 key
    ```ts
    this.info('LLM', `>>> LLM Request ...`, {
      messageCount: messages.length,
      tools: tools ? 'yes' : 'no',
      messages: messages.map((m: any) => ({
        role: m.role,
        content: redact(typeof m.content === 'string' ? m.content.slice(0, 200) + '...' : '[complex]'),
      })),
    })
    ```
  - 注意：要先 slice 再 redact（避免 redact 太长的内容）
  - **verify**：用户消息包含 `sk-...` 时，日志里应是 `***REDACTED***`

- [ ] **Step 4：在 logLLMResponse 应用 redact**
  - `packages/core/dev-logger.ts:101`：
    ```ts
    logLLMResponse(response: unknown, duration: number) {
      this.info('LLM', `<<< LLM Response | duration=${duration}ms`, redact(response))
    }
    ```
  - 防御性：万一 LLM 在 response 里回显 key
  - **verify**：单元测试 mock LLM 返回含 key 的内容

- [ ] **Step 5：默认 LogLevel 保持 DEBUG**
  - **不改**。用户设置 DEBUG 是为了方便查日志解决问题
  - redact 已足够保护敏感数据，不需要降低日志级别
  - **verify**：跳过此步

- [ ] **Step 6：redact 函数单测**
  - 新建 `packages/core/__tests__/dev-logger-redact.test.ts`
  - 测试用例：
    - `{ apiKey: 'sk-xxx' }` → `{ apiKey: '***REDACTED***' }`
    - `{ name: 'foo', nested: { token: 'x' } }` → `{ name: 'foo', nested: { token: '***REDACTED***' } }`
    - `'sk-ant-api03-abc...'` → `'***REDACTED***'`
    - `'ghp_xxxxxxxxxx...'` → `'***REDACTED***'`
    - `'Authorization: Bearer xxx'` → `'Authorization: ***REDACTED***'`
    - 普通文本不变
    - 数字 / null / undefined 不变
    - 嵌套数组
  - **verify**：`bun test packages/core/__tests__/dev-logger-redact.test.ts` 全过

- [ ] **Step 7：清理已泄露的旧日志**
  - 现有 `C:\Users\lzg14\.licode\logs\dev\dev-*.log` 文件含真实 key
  - 选项 A：直接删（最干净）
  - 选项 B：用 redact 后的内容覆盖原文件（保留 debug 信息但去掉 key）
  - 建议 A：用户需要轮换 API key（因为已经泄露），旧日志没保留价值
  - **verify**：
    ```bash
    ls "C:/Users/lzg14/.licode/logs/dev/" 2>&1 | head
    # 旧文件应被删
    ```
  - **同时提醒用户**：需要到 Anthropic / OpenAI / DeepSeek / MiniMax dashboard 轮换 key

- [ ] **Step 8：文档**
  - `README.md` 加一节"安全和隐私"：
    ```
    ## 安全和隐私
    - 日志位于 `~/.licode/logs/dev/`
    - 自动 redact 敏感字段（apiKey / token / password / 各种 API key 格式）
    - 如需分享日志，先检查 `grep -E "sk-|Bearer|token" ~/.licode/logs/dev/*.log`
    ```
  - `CHANGELOG.md` 加 Unreleased 条目：
    ```markdown
    ### 安全
    - **devLogger 敏感字段 redact**：自动遮蔽 apiKey / token / password 等字段，以及内联 API key 字符串（sk-ant-* / sk-* / ghp_* / xox* 等）
    ```

- [ ] **Step 9：CHANGELOG**
  - 见 Step 8

- [ ] **Step 10：提交**
  - 拆 2 个 commit：
    1. `fix: devLogger redact 敏感字段 + 默认 INFO 级别`
    2. `docs: README + CHANGELOG 同步`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/core/dev-logger.ts` | 加 redact 函数 + 改 logToolCall/logLLMRequest/logLLMResponse + 默认 INFO |
| `packages/core/__tests__/dev-logger-redact.test.ts` | 新建单测 |
| `C:\Users\lzg14\.licode\logs\dev\*.log` | 手动删（用户操作） |
| `README.md` | 加安全和隐私章节 |
| `CHANGELOG.md` | 加 Unreleased 条目 |

---

## 关键技术点

### 1. redact 顺序

```ts
// 错：先 stringify 再 redact，会破坏 JSON 结构
JSON.stringify(redact(JSON.parse(...)))

// 对：递归处理对象 + 字符串正则替换
redact({ apiKey: 'sk-xxx', content: 'use sk-yyy' })
// → { apiKey: '***REDACTED***', content: 'use ***REDACTED***' }
```

### 2. 大对象性能

```ts
// 200 字符截断后再 redact，避免 10MB 字符串正则
content: typeof m.content === 'string' ? redact(m.content.slice(0, 200) + '...') : '[complex]'
```

### 3. 递归终止条件

```ts
function redact(obj: unknown): unknown {
  if (obj == null) return obj          // null / undefined
  if (typeof obj === 'string') { ... } // 字符串
  if (Array.isArray(obj)) return ...    // 数组
  if (typeof obj === 'object') { ... } // 普通对象
  return obj                            // number / boolean / etc.
}
```

### 4. 大小写不敏感匹配

```ts
// 用户可能用 APIKey / apiKey / API_KEY
REDACT_KEYS.some(rk => k.toLowerCase().includes(rk))
```

### 5. 内联 key 正则

Anthropic: `sk-ant-api03-...`（也有 `sk-ant-api02-`、`sk-ant-api01-`）
OpenAI 新：`sk-proj-...`
OpenAI 旧：`sk-...`（至少 20 字符）
MiniMax / DeepSeek：`sk-...`（约 32 字符 hex）

匹配这些前缀 + 字符长度，避免误杀普通文本。

---

## 验收

完成后：

1. ✅ TUI 里读 `licode.config.json`，日志中 apiKey 字段是 `***REDACTED***`
2. ✅ 用户消息含 `sk-xxx` 时，日志中是 `***REDACTED***`
3. ✅ 单测覆盖所有 redact 场景
4. ✅ 默认 log 级别保持 DEBUG（方便调试）
5. ✅ 旧日志已删（含泄露的 key）
6. ✅ README + CHANGELOG 同步

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Step 1（redact 函数） | 20 分钟 |
| Step 2-4（应用 redact） | 15 分钟 |
| Step 5（默认 INFO） | ~~跳过~~ |
| Step 6（单测） | 30 分钟 |
| Step 7（删旧日志 + 提醒用户） | 5 分钟 |
| Step 8-9（文档） | 15 分钟 |
| Step 10（提交） | 5 分钟 |
| **合计** | **约 1.5 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| redact 函数漏掉某种 key 格式 | 单元测试覆盖常见格式；用户提 issue 补正则 |
| 删日志影响调试 | 确认有 `logLLMRequest` 等结构化日志保留在内存/console |
| redact 误杀正常文本（如包含 "Bearer" 单词） | 正则要求 token 后接 20+ 字符 |
| 性能开销（每次 log 都 redact） | 单测跑 benchmark，< 1ms 应该没问题 |

---

## 后续（不在本次范围）

1. 加 `detailed_logging` 配置项，按全局 CLAUDE.md 规范启用
2. 日志自动轮转（按大小或时间）
3. 日志加密（gpg 或 OS keychain）
4. 集成 secret-scanner 工具在 commit 前扫描日志

---

## 关联

- 全局 CLAUDE.md "敏感信息" + "日志规范" 章节
- 当前 PAI 安全规范：`Tools/validate-protected.ts`（参考用的正则集）