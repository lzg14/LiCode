# 发布流程

## 版本号规范

遵循 [SemVer](https://semver.org/lang/zh-CN/)：

- `0.x.0`: 大功能新增，可能有破坏性变更
- `0.0.x`: bugfix / 小改进

## 发版步骤

```bash
# 1. 更新 CHANGELOG.md
#    将 [Unreleased] 中的条目移到新版本下

# 2. 更新 package.json 版本号
bun run bump  # 或手动编辑 package.json version 字段

# 3. 提交并打 tag
git add CHANGELOG.md package.json
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
