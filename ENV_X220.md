# 开发环境 — X220T

> 生成日期：2026-06-22
> 用途：另一台电脑出现滚动问题，怀疑是依赖包版本不一致，故记录本机完整环境。

---

## 系统

| 项目 | 值 |
|---|---|
| 主机名 | X220T |
| OS | Microsoft Windows 10 专业版 |
| 版本 | 10.0.19045 (Build 19045) |
| 架构 | AMD64 |
| PowerShell | 7.5.5 |

---

## 运行时

| 工具 | 版本 |
|---|---|
| Bun | 1.3.14 |
| Node.js | v24.14.0 |
| npm | 11.9.0 |
| TypeScript (tsc) | 5.9.3 |

---

## 全局工具

| 工具 | 版本 |
|---|---|
| git | 2.43.0.windows.1 |
| gh (GitHub CLI) | 2.93.0 (2026-05-27) |

### npm 全局包

```
@anthropic-ai/claude-code@2.1.177
@lzg14/deepseek-cli@0.1.3
@mariozechner/pi-coding-agent@0.66.1
@mimo-ai/cli@0.1.1
bip-cli@15.13.19
bun@1.3.14
mmx-cli@1.0.15
oh-my-opencode@4.4.0
opencode-ai@1.17.8
undici@8.5.0
```

---

## PATH 关键路径

```
C:\PROGRAM FILES\GIT\CMD
C:\Program Files\GitHub CLI\
C:\Program Files\nodejs\
C:\Program Files\PowerShell\7
C:\Program Files\PowerShell\7\
C:\Users\lzg14\AppData\Local\Microsoft\WindowsApps
C:\Users\lzg14\AppData\Local\Programs\Python\Python314\
C:\Users\lzg14\AppData\Local\Programs\Python\Python314\Scripts\
C:\Users\lzg14\AppData\Roaming\npm
C:\WINDOWS
D:\software\python314\
D:\software\python314\Scripts\
```

---

## 项目依赖（实际安装版本）

### dependencies

| 包名 | package.json | 实际安装 |
|---|---|---|
| @ai-sdk/anthropic | ^3.0.85 | 3.0.85 |
| @ai-sdk/openai | ^3.0.73 | 3.0.73 |
| @ai-sdk/provider | ^3.0.10 | 3.0.10 |
| @modelcontextprotocol/sdk | ^1.29.0 | 1.29.0 |
| @opentui/core | ^0.4.1 | 0.4.1 |
| @opentui/solid | ^0.4.1 | 0.4.1 |
| ai | ^6.0.208 | 6.0.208 |
| chalk | ^5.3.0 | 5.6.2 |
| glob | ^11.0.0 | 11.1.0 |
| hono | ^4.12.26 | 4.12.26 |
| opentui-spinner | ^0.0.7 | 0.0.7 |
| simple-git | ^3.36.0 | 3.36.0 |
| solid-js | ^1.9.12 | 1.9.13 |
| xlsx | ^0.18.5 | 0.18.5 |
| zod | 4 | 4.4.3 |
| zod-to-json-schema | ^3.25.2 | 3.25.2 |

### devDependencies

| 包名 | package.json | 实际安装 |
|---|---|---|
| @types/better-sqlite3 | ^7.6.13 | 7.6.13 |
| @types/bun | ^1.3.14 | 1.3.14 |
| better-sqlite3 | ^12.11.1 | 12.11.1 |
| typescript | ^5.6.0 | 5.9.3 |
| vitest | ^2.0.0 | 2.1.9 |

### opentui 子依赖（滚动问题重点关注）

```
@opentui/core 0.4.1
  ├── bun-ffi-structs: 0.2.3
  ├── diff: 9.0.0
  ├── marked: 17.0.1
  ├── string-width: 7.2.0
  └── strip-ansi: 7.1.2

@opentui/solid 0.4.1
  ├── @babel/core: 7.28.0
  ├── @babel/preset-typescript: 7.27.1
  ├── @opentui/core: 0.4.1
  ├── babel-plugin-module-resolver: 5.0.2
  ├── babel-preset-solid: 1.9.12
  ├── entities: 7.0.1
  └── s-js: ^0.4.9
```

### 其他关键包

| 包名 | 版本 |
|---|---|
| solid-js | 1.9.13 |
| zod | 4.4.3 |
| vitest | 2.1.9 |
| typescript | 5.9.3 |

---

## 包管理器

使用 **bun** 安装依赖，lock 文件为 `bun.lock`（新版 JSON 格式，非 `bun.lockb` 二进制格式）。

另一台电脑如果滚动异常，建议对比：

1. `bun --version` 是否一致（本机 1.3.14）
2. `@opentui/core` 和 `@opentui/solid` 是否同为 0.4.1（opentui 是滚动问题的直接责任方）
3. `better-sqlite3` 版本（本机 12.11.1）— 不同 VS 运行时版本也可能影响
4. Node.js 版本（本机 v24.14.0）
5. 确保用 `bun install`（不是 `npm install`），否则 lockfile 不一致会导致解析差异
6. 检查 Windows 版本/终端模拟器差异（Windows Terminal vs ConHost 等）
