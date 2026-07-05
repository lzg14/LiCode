# 发布流程

## 版本号规范

遵循 [SemVer](https://semver.org/lang/zh-CN/)：

- `0.x.0`: 大功能新增，可能有破坏性变更
- `0.0.x`: bugfix / 小改进

## 版本号来源（必须同时改这 2 处）

本项目版本号**硬编码在两处**，发版时**两处必须保持一致**：

| # | 文件 | 行 | 内容 |
|---|------|---|------|
| 1 | `package.json` | 3 | `"version": "0.4.0"`（权威来源） |
| 2 | `packages/tui/component/sidebar.tsx` | 8 | `const VERSION = "0.4.0"`（TUI sidebar 显示用） |

> ⚠️ **未来重构建议**：把 sidebar.tsx 的 `VERSION` 改为 `import pkg from "../../../package.json" assert { type: "json" }; const VERSION = pkg.version`，让硬编码收敛到 1 处。
>
> 历史上**漏改 sidebar.tsx** 是 v0.3.0 → v0.4.0 升级时的一个已知问题（commit 不分 master 头，sidebar 显示 `0.2.0` 而 package.json 已到 `0.4.0`），必须人工 grep 校验。
>
> 校验命令：
>
> ```bash
> grep -rn '"0\.4\.0"' package.json packages/tui/component/sidebar.tsx
> # 期望：两处都返回一行匹配
> ```

## 发版步骤

```bash
# 1. 更新 CHANGELOG.md
#    将 [Unreleased] 中的条目移到新版本下，新建空 [Unreleased] 模板

# 2. 更新版本号（两处必须同时改）
#    2a. 编辑 package.json version 字段
#    2b. 编辑 packages/tui/component/sidebar.tsx 的 const VERSION
#    注：当前未提供 bun run bump，等价手动两步
#    （# T13：考虑加 .github/scripts/bump.ts 自动化）

# 3. 提交并打 tag
git add CHANGELOG.md package.json packages/tui/component/sidebar.tsx
git commit -m "chore: release v0.x.0"
git tag v0.x.0

# 4. 推送（CI 自动构建 Release）
git push origin master --tags
```

## CI 自动流程

推送 `v*` tag 后 `.github/workflows/release.yml` 自动：

1. 运行完整测试套件（lint + typecheck + test）
2. 构建产出
3. 创建 GitHub Release 并附加构建产物

## 手动发布

如需绕过 CI 手动发布：

```bash
bun run build
# 将 dist/ 打包上传到 GitHub Releases
```

## 历史问题记录

- **v0.4.0 (2026-07-05)**：sidebar.tsx 没及时同步，commit 顺序（master vs PR）导致 TUI 显示 `0.2.0` 而 package.json 已经 `0.4.0`。正式记录在"版本号来源"小节，后续 bump 步骤加 grep 校验防止再次发生。

