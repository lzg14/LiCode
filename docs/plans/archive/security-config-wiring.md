# Security 配置接线修复计划

**目标**：让 `licode.config.json` 的 `security.*` 字段真正生效（不再被忽略），同时解决 powershell 等白名单扩展需求。

**日期**：2026-06-21
**优先级**：P0（用户配置失效 = 安全策略假象）

---

## 现状问题

### 三层白名单都是死代码

| 层级 | 文件 | 状态 |
|---|---|---|
| 1. `whitelist.ts:DEFAULT_WHITELIST` | 写死 24 个 Unix 命令 | **securityLayer 实际用** |
| 2. `defaults.ts:DEFAULT_CONFIG.security.commandWhitelist` | 写死 14 个命令 | ❌ 无效 |
| 3. `defaults.ts:DEV_CONFIG.security.commandWhitelist = ['*']` | 写死 | ❌ 无效 |
| 4. `defaults.ts:PROD_CONFIG.security.commandWhitelist` | 写死 8 个 | ❌ 无效 |
| 5. `licode.config.json:security.commandWhitelist` | 用户配置 | ❌ 无效 |

### 根因

```ts
// packages/security/index.ts:219
export const securityLayer = new SecurityLayer()
//                                        ↑ 空 config，spread 不覆盖任何东西
```

```ts
// packages/security/index.ts:76-78
constructor(config: Partial<SecurityConfig> = {}) {
  this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
  //                                        ↑ 用户 config 字段从未传进来
}
```

### 后果

- 用户改 `licode.config.json` 安全配置完全无效
- 修复 powershell 白名单只能改源码
- 假象"安全可控"，实际只受 `whitelist.ts` 写死的常量约束

---

## 设计原则

1. **单一真实源**：所有安全配置最终从 `licode.config.json` 读
2. **平台默认合理**：Windows 默认包含 powershell，Unix 不包含
3. **用户可完全覆盖**：用户写的 `licode.config.json` 覆盖平台默认
4. **向后兼容**：保留 `whitelist.ts:DEFAULT_WHITELIST` 作为兜底
5. **死亡代码清除**：`defaults.ts` 的安全配置块移除

---

## 步骤

### Phase 1：P0 接线修复（必须）

- [ ] **Step 1：让 SecurityLayer 接受外部 config**
  - `packages/security/index.ts` 改为：
    ```ts
    export function createSecurityLayer(config?: Partial<SecurityConfig>): SecurityLayer {
      return new SecurityLayer(config)
    }
    // 保留单例 export（向后兼容），但标记 deprecated
    export const securityLayer = createSecurityLayer()
    ```
  - **verify**：`grep "createSecurityLayer" packages/security/index.ts` 有匹配

- [ ] **Step 2：在 app.tsx 启动时构造带 config 的 securityLayer**
  - `packages/tui/app.tsx:31` 已经构造了 fallback security config
  - 改为：
    ```ts
    import { createSecurityLayer } from '../security'
    
    async function loadConfig() {
      try {
        const homeDir = process.env.HOME || process.env.USERPROFILE || ''
        return await configLoader.discoverAndLoad(homeDir)
      } catch {
        return DEFAULT_CONFIG  // 用 defaults 的 fallback
      }
    }
    
    export async function tui(config: any) {
      const securityLayer = createSecurityLayer(config.security)
      // 把 securityLayer 通过 context 传给工具调用方
      // ... 或通过 module 重导出覆盖单例
    }
    ```
  - **关键**：`createSecurityLayer(config.security)` 替换默认 `securityLayer`
  - **verify**：app.tsx 启动时打印实际生效的白名单（debug 日志）

- [ ] **Step 3：工具调用方使用构造的实例**
  - `packages/tools/builtin.ts:273` 和 `packages/tools/registry.ts:99` 都用 `import { securityLayer }`
  - 改为从 context 拿（或通过 prop 注入）
  - **简化方案**：保留单例 export，但用 `Object.assign(securityLayer, ...)` 在启动时覆盖 config
  - **推荐方案**：用 `setSecurityLayer(instance)` 单点替换
  - **verify**：TUI 启动后 `securityLayer.config.commandWhitelist` 反映用户配置

- [ ] **Step 4：让 `whitelist.ts` 支持平台默认**
  - 改为：
    ```ts
    // packages/security/whitelist.ts
    
    const BASE_WHITELIST = [
      'git', 'cargo', 'npm', 'npx', 'pnpm',
      'ruff', 'mypy', 'eslint', 'prettier', 'biome', 'tsc',
      'psql', 'mysql', 'docker', 'playwright',
      'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'tree',
      'curl', 'wget', 'gh',
      'pip', 'uv',
      'vitest', 'prisma',
      'node', 'next',
    ]
    
    const PLATFORM_WHITELIST: Record<NodeJS.Platform, string[]> = {
      win32: ['powershell', 'pwsh', 'cmd', 'where', 'tasklist'],
      darwin: ['open', 'pbcopy', 'pbpaste'],
      linux: ['xdg-open', 'xclip'],
      freebsd: [],
      openbsd: [],
      sunos: [],
      aix: [],
    }
    
    export function getDefaultWhitelist(platform: NodeJS.Platform = process.platform): string[] {
      return [
        ...BASE_WHITELIST,
        ...(PLATFORM_WHITELIST[platform] ?? []),
      ]
    }
    
    // 向后兼容的 export
    export const DEFAULT_WHITELIST = getDefaultWhitelist()
    
    const BLOCKED_COMMANDS = [...]  // 不变
    ```
  - **verify**：在 Windows 上 `getDefaultWhitelist()` 含 powershell；Mac/Linux 不含

- [ ] **Step 5：用户 config 完全覆盖默认**
  - `packages/security/index.ts` 构造逻辑：
    ```ts
    constructor(config: Partial<SecurityConfig> = {}) {
      // 平台默认 + 用户 config 完全替换（不是 merge）
      const defaultCommandWhitelist = getDefaultWhitelist()
      this.config = {
        commandWhitelist: defaultCommandWhitelist,
        blockedCommands: BLOCKED_COMMANDS,
        allowedPaths: [],
        deniedPaths: this.getDefaultDeniedPaths(),
        maxFileSize: 10 * 1024 * 1024,
        sensitivePatterns: [...],
        ...config,  // 用户 config 覆盖
      }
    }
    
    private getDefaultDeniedPaths(): string[] {
      return process.platform === 'win32'
        ? ['C:\\Windows', 'C:\\Program Files']
        : ['/etc', '/sys', '/proc']
    }
    ```
  - **verify**：在 `licode.config.json` 配 `security.commandWhitelist: ["git"]`，TUI 启动后 `securityLayer.config.commandWhitelist` 应该**只有** `["git"]`，不含默认 24 个
  - 这是预期行为：用户完全控制白名单
  - **如果不想要这个行为**：改为"用户 config 追加到默认"——见下方"决策点"

- [ ] **Step 6：清理 `defaults.ts` 死代码**
  - `packages/config/defaults.ts` 的 `security` 块移除（已通过 `getDefaultWhitelist` 统一管理）
  - `DEV_CONFIG.security.commandWhitelist: ['*']` 移除（不再需要）
  - `PROD_CONFIG.security.commandWhitelist` 移除
  - **verify**：`grep "commandWhitelist" packages/config/defaults.ts` 无输出

- [ ] **Step 7：PowerShell 特定危险模式**
  - `packages/security/index.ts` 加 PowerShell 黑名单：
    ```ts
    const POWERSHELL_DANGEROUS_PATTERNS = [
      { pattern: /Remove-Item\s+(-Recurse|-Force|-rf)\b/gi, description: 'PowerShell 强制删除' },
      { pattern: /Set-ExecutionPolicy\s+Unrestricted/gi, description: '禁用 PowerShell 执行策略' },
      { pattern: /Invoke-Expression\b/gi, description: 'PowerShell 动态执行' },
      { pattern: /\|\s*iex\b/gi, description: 'iex 管道执行' },
      { pattern: /Clear-RecycleBin\s+-Force/gi, description: '清空回收站' },
      { pattern: /Format-Volume\b/gi, description: '格式化磁盘' },
      { pattern: /Stop-Service\s+-Force/gi, description: '强制停止系统服务' },
    ]
    ```
  - 在 `checkDangerousPattern` 里也检查这些
  - **verify**：单元测试 `Remove-Item -Recurse -Force C:\\` 被识别

- [ ] **Step 8：测试覆盖**
  - 新建 `packages/security/__tests__/security-layer.test.ts`：
    - 平台默认白名单包含平台特定命令
    - 用户 config 完全覆盖默认
    - 危险命令模式被识别
    - PowerShell 危险 cmdlet 被识别
    - `createSecurityLayer(config)` 构造的实例生效
  - **verify**：`bun test packages/security` 全过

- [ ] **Step 9：文档**
  - `README.md` 加"安全配置"章节：
    ```
    ## 安全配置
    
    在 licode.config.json 配置：
    ```json
    {
      "security": {
        "commandWhitelist": ["git", "npm", "powershell"],
        "deniedPaths": [".git", ".env"]
      }
    }
    ```
    
    - `commandWhitelist`：完全覆盖平台默认
    - `deniedPaths`：追加到平台默认
    - 危险命令模式始终生效（rm -rf /、sudo 等）
    ```
  - `licode.config.json.example` 加注释说明
  - **verify**：`grep "安全配置\|security.*commandWhitelist" README.md` 有匹配

- [ ] **Step 10：CHANGELOG**
  - Unreleased 条目：
    ```markdown
    ### 修复
    - **Security 配置接线**：用户 `licode.config.json` 的 `security.*` 字段现在真正生效（之前被忽略）
    - **平台默认白名单**：Windows 默认包含 powershell/pwsh/cmd，Mac 包含 open/pbcopy，Linux 包含 xdg-open/xclip
    - **PowerShell 危险 cmdlet 拦截**：Remove-Item -Recurse、Set-ExecutionPolicy Unrestricted、Invoke-Expression 等
    - **清理死代码**：移除 `defaults.ts` 中未被使用的 security.commandWhitelist 三套配置
    ```

- [ ] **Step 11：提交**
  - 拆 2 个 commit：
    1. `fix: Security config 接线生效 + 平台默认白名单 + PowerShell 危险拦截`
    2. `docs: README + CHANGELOG 同步`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/security/index.ts` | 加 createSecurityLayer + PowerShell 危险模式 |
| `packages/security/whitelist.ts` | 改 DEFAULT_WHITELIST 为 getDefaultWhitelist(platform) |
| `packages/security/__tests__/security-layer.test.ts` | 新建单测 |
| `packages/tui/app.tsx` | 启动时调 createSecurityLayer(config.security) |
| `packages/config/defaults.ts` | 清理死代码 |
| `licode.config.json.example` | 加注释 |
| `README.md` | 加安全配置章节 |
| `CHANGELOG.md` | Unreleased 条目 |

---

## 决策点（要先决定）

### 决策 1：用户 config 是否完全覆盖默认？

**选项 A：完全覆盖**（推荐）
```json
"commandWhitelist": ["git"]
// 生效：只有 git
```
- 优点：用户完全控制，可关闭危险命令
- 缺点：新装用户需要手动加 commands

**选项 B：追加到默认**
```json
"commandWhitelist": ["powershell"]
// 生效：默认 24 个 + powershell
```
- 优点：开箱即用
- 缺点：用户难以"关闭"某个默认命令

**建议 A**。生产环境用户应**明确知道**白名单里有什么。

### 决策 2：`deniedPaths` 用覆盖还是追加？

**推荐：追加**。
```json
"deniedPaths": [".ssh"]
// 生效：默认 + .ssh
```
理由：denied paths 是"无论如何都不行"的清单，追加更安全。

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不重写整个安全系统 | 当前架构够用，只缺 wiring |
| 不加交互式权限 prompt（"Allow once?"） | 留作未来增强（Claude Code 那种） |
| 不改 BLOCKED_COMMANDS 黑名单 | 当前合理（rm/sudo/python 都不该走 bash 工具） |
| 不动 `checkPath` 逻辑 | 路径检查已经工作 |

---

## 验收

完成后：

1. ✅ 在 `licode.config.json` 配 `security.commandWhitelist: ["git"]`，TUI 中 `bash("npm install")` 被拒
2. ✅ Windows 用户 `licode.config.json` 配 `["powershell"]`，`bash("powershell -Command echo hi")` 通过
3. ✅ PowerShell 危险 cmdlet（Remove-Item -Recurse -Force 等）被拦截
4. ✅ `defaults.ts` 中无 `commandWhitelist` 残留
5. ✅ tsc 编译通过
6. ✅ tests 全过
7. ✅ README + CHANGELOG 同步

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Step 1-3（接线） | 1.5 小时 |
| Step 4-5（默认 + 覆盖） | 30 分钟 |
| Step 6（清理死代码） | 10 分钟 |
| Step 7（PowerShell 黑名单） | 30 分钟 |
| Step 8（测试） | 1 小时 |
| Step 9-11（文档 + 提交） | 30 分钟 |
| **合计** | **约 4-5 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 接线改动破坏现有 TUI 启动 | Step 3 完整测试后再合并 |
| 用户 config 完全覆盖破坏常见场景 | README + example 加明确警告 |
| PowerShell 危险模式误杀 | 单测覆盖主流 cmdlet |
| 平台检测不准（容器/CI 特殊平台） | 用 process.platform 标准 API |

---

## 关联

- `docs/plans/dev-logger-redact.md` — 已完成
- `docs/plans/prompt-shortcuts.md` — 待做
- `docs/plans/claude-code-skills-integration.md` — 已完成
- `docs/plans/slash-menu-simplification.md` — 已完成

---

## 待用户决策

**决策 1**：用户 config 完全覆盖默认（推荐）还是追加？

如果选追加，Step 5 逻辑要改：
```ts
this.config = {
  commandWhitelist: [
    ...getDefaultWhitelist(),
    ...(config.commandWhitelist ?? []),  // 追加而不是覆盖
  ],
  // ...
}
```

确认后告诉我，发给 agent 跑。