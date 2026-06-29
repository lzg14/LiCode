# Code Quality Audit — licode v0.3.0

**Date**: 2026-06-25
**Scope**: Repository-wide (root + `.github/` + `packages/` + `docs/` + `scripts/` + top-level config)
**Version audited**: 0.3.0 (CHANGELOG Unreleased)
**Method**: Static inspection + `git log` + workflow review (no live build/test executed)
**Reviewer**: Claude (automated audit)

---

## TL;DR

**Rating**: ⭐⭐⭐⭐ (4/5) — Solid engineering, missing ecosystem glue.

The codebase is **remarkably clean**: zero TODO/FIXME/HACK markers, full TS strict mode, 30 test files across 9 of 10 packages, working 3-platform CI. The weak spots are **project hygiene tooling** (no linter, no formatter), **CI gaps** (no lint step, no version pin, no coverage upload), and **contributor-facing docs** (no CONTRIBUTING, no issue/PR templates). Most gaps are cheap, mechanical, and high-ROI.

---

## 1. Strengths (no action needed)

| Area | Evidence |
|---|---|
| No tech-debt markers | `rg -n 'TODO\|FIXME\|XXX\|HACK\|TBD'` → **0 matches** |
| TypeScript strict | `tsconfig.json`: `strict: true`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `target: ESNext`, `module: ESNext`, `moduleResolution: bundler` |
| Test breadth | 30 `__tests__` files across `tools`, `tui`, `skills`, `security`, `session`, `memory`, `llm`, `integration`, `core`, `config` |
| CI matrix | `.github/workflows/ci.yml`: ubuntu-latest + windows-latest + macos-latest, `bun install --frozen-lockfile` |
| Changelog discipline | `CHANGELOG.md` follows Keep-a-Changelog, with explicit Unreleased section listing P0 sprint items |
| Security | `SECURITY.md` present, `apiKey` auto-redacted in logs, command-execution whitelist, `.gitignore` covers `.env`, `*.key`, `*.pem` |
| Documentation | `README.md` (150+ lines), `CLAUDE.md` (project-specific AI guide), `docs/{modules,plans,reference,archive}` |
| Config sample | `licode.config.json.example` well-commented |

---

## 2. P0 — High ROI, do this sprint

### 2.1 No linter, no formatter (the biggest gap)

There is **no ESLint, no Biome, no Oxlint, no Prettier, no dprint**. Code style is enforced by human review only. This is the single highest-leverage missing piece.

**Risk**
- Style debates in PRs waste reviewer time
- No automated catch for obvious bugs (unused vars already caught by tsc, but not by e.g. `no-shadow`, `consistent-type-imports`)
- No formatter means diffs are noisy

**Recommendation — Biome** (single tool, zero-config, fast)

```bash
bun add -d @biomejs/biome
bunx @biomejs/biome init
```

`biome.json`:
```json
{
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

### 2.2 CI missing lint + format check

`.github/workflows/ci.yml` runs install + typecheck + test + build, but **no style gate**. Bad code can land.

**Add to the workflow** (before `Test`):
```yaml
- name: Lint & Format
  run: bun run check
```

### 2.3 CI does not pin Bun version

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest   # ❌ drifts
```

**Fix**:
```yaml
bun-version: 1.3.14
```
(matches `engines.bun >= 1.3.14` in `package.json`)

### 2.4 Missing standard npm scripts

Current `scripts` in `package.json`: `build`, `test`, `test:coverage`, `test:watch`, `cli`, `dev`, `logs`.

**Add**:
```jsonc
{
  "typecheck":      "tsc --noEmit --skipLibCheck",
  "format":         "biome format --write .",
  "format:check":   "biome format .",
  "lint":           "biome lint .",
  "lint:fix":       "biome lint --write .",
  "check":          "bun run typecheck && bun run format:check && bun run lint",
  "clean":          "rm -rf dist",
  "verify":         "bun install --frozen-lockfile && bun run check && bun test --run && bun run build"
}
```

This lets contributors reproduce CI locally with one command.

### 2.5 CONTRIBUTING.md missing

PR contributors have no guide for: how to file PRs, run tests, format commits, whether an issue is required first.

**Recommendation** — create `CONTRIBUTING.md` covering:
- Dev setup (Bun ≥ 1.3.14, Node ≥ 18)
- `bun install --frozen-lockfile`
- `bun run verify` before pushing
- Commit message style (currently mixed: `feat:` / `fix:` / `chore:` / `docs:` — see §3.13)
- PR checklist (typecheck, test, build green)

---

## 3. P1 — Medium ROI, 1-2 day effort

### 3.1 `vitest` vs `bun test` dual-track inconsistency

| Where | Runner |
|---|---|
| `package.json` `test` | `vitest` |
| `package.json` `test:watch` | `vitest --watch` |
| CI `.github/workflows/ci.yml` | `bun test --run` |
| README recommendation | `bun test` |

Three runners, three potentially different behaviors (path resolution, alias application, reporter format). Pick one and align everywhere.

**Recommendation**: standardize on `bun test` (fast, no extra deps). If you keep vitest for its reporter/coverage UX, at least make CI run vitest too.

### 3.2 `.github/` is nearly empty

Only `workflows/ci.yml` exists. Missing:
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`

### 3.3 `packages/cli/` has zero tests

`packages/cli/` contains `index.ts` and `logs.ts` but no `__tests__/`. Every other package is tested. Even a smoke test for `logs.ts` would close the gap.

### 3.4 No coverage upload in CI

`test:coverage` script exists (vitest), but CI doesn't run it and nothing is uploaded to Codecov/Coveralls. Track coverage drift over time.

**Add** to CI:
```yaml
- name: Coverage
  if: matrix.os == 'ubuntu-latest'
  run: bun run test:coverage
- uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
```

### 3.5 `package.json` lacks publish fields

For future npm publishing:
```jsonc
{
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" }
}
```

### 3.6 Docs plans lack a status index

`docs/plans/production-gaps-2026-q3.md` and friends are marked with ⚠️ in `docs/README.md`, but there is no central status table. Consider frontmatter:
```yaml
---
title: Production gaps Q3 2026
status: in-progress | draft | abandoned | completed
last-reviewed: 2026-06-25
---
```

---

## 4. P2 — Long-term ecosystem

### 4.1 No release workflow
No `release.yml`. Tag → changelog → npm publish is all manual.
**Recommendation**: [`googleapis/release-please`](https://github.com/googleapis/release-please) (conventional-commits driven).

### 4.2 No conventional-commits enforcement
Commits are loosely formatted (mix of `feat:`, `fix:`, `chore:`, `docs:`). Add `commitlint` + `husky` + `lint-staged` to lock the format and auto-format staged files.

### 4.3 No `.nvmrc` / `.node-version`
`engines.node` is `>=18` but no specific version is pinned. Add `.nvmrc` with the current LTS (e.g. `20.18.0`).

### 4.4 No CodeQL / security scanning
**Recommendation**: add `.github/workflows/codeql.yml` (free for public repos).

### 4.5 CHANGELOG automation potential
The Unreleased section is long and manually maintained. `release-please` (4.1) would auto-generate it.

### 4.6 `bunfig.toml` could grow
Currently only `preload` and `[test] preload`. Add:
```toml
[install]
exact = true
```

---

## 5. Improvement Matrix

| # | Priority | Item | Effort | Value |
|---|---|---|---|---|
| 1 | P0 | Add Biome (lint + format) | 30 min | ⭐⭐⭐⭐⭐ |
| 2 | P0 | CI lint + format step | 10 min | ⭐⭐⭐⭐⭐ |
| 3 | P0 | Pin Bun version in CI | 2 min | ⭐⭐⭐⭐ |
| 4 | P0 | Add 8 standard npm scripts | 20 min | ⭐⭐⭐⭐ |
| 5 | P0 | Write CONTRIBUTING.md | 30 min | ⭐⭐⭐ |
| 6 | P1 | Unify vitest / bun test | 1 h | ⭐⭐⭐ |
| 7 | P1 | Add .github templates + dependabot | 1 h | ⭐⭐⭐ |
| 8 | P1 | Add tests for `packages/cli` | 2-3 h | ⭐⭐⭐ |
| 9 | P1 | CI coverage upload | 30 min | ⭐⭐⭐ |
| 10 | P1 | Add publish fields to package.json | 10 min | ⭐⭐ |
| 11+ | P2 | release-please, commitlint, husky, CodeQL, .nvmrc | 3-5 h | ⭐⭐⭐ |

---

## 6. Recommended Next Sprint (~2 hours)

A high-value, low-risk batch that can ship in one PR:

1. Install Biome + write `biome.json`
2. Run `biome format --write .` + `biome lint --write .` on the codebase
3. Add the 8 npm scripts (`typecheck`, `format`, `format:check`, `lint`, `lint:fix`, `check`, `clean`, `verify`)
4. Update `.github/workflows/ci.yml` to add `bun run check` step and pin `bun-version: 1.3.14`
5. Write `CONTRIBUTING.md`
6. Verify locally: `bun run verify` → all green
7. Commit: `chore: add Biome, standard scripts, CI gates, and CONTRIBUTING`
8. Push & open PR

**Expected outcome**:
- Zero future style-debate PRs (format auto)
- One more CI gate catches obvious issues
- Contributors have a clear onboarding path
- `bun run verify` reproduces CI locally

---

## Appendix A — Files reviewed

- Root: `package.json`, `tsconfig.json`, `bunfig.toml`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `bun.lock`, `licode.config.json.example`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `SECURITY.md`
- `.github/`: `workflows/ci.yml`
- `packages/`: `cli/`, `config/`, `core/`, `integration/`, `llm/`, `memory/`, `security/`, `session/`, `skills/`, `tools/`, `tui/`, `__mocks__/`
- `docs/`: `README.md`, `archive/`, `modules/`, `plans/`, `reference/`
- `.claude/skills/`: 13 project-specific skills

## Appendix B — Commands run

```bash
rg -n 'TODO|FIXME|XXX|HACK|TBD'        # 0 matches
ls -la .github/                          # only ci.yml
ls scripts/                              # does not exist
ls packages/                             # 10 packages + __mocks__
git log --oneline -20                    # recent commit style
```

## Appendix C — Related documents

- `docs/plans/production-gaps-2026-q3.md` — prior 7.5/10 readiness assessment
- `docs/plans/shortcuts-test-coverage.md` — unimplemented test upgrade plan
- `docs/plans/tui-render-optimization.md` — unimplemented render optimization
- `docs/plans/architecture-refactor-plan.md` — draft refactor plan
- `CHANGELOG.md` — Unreleased section lists P0 sprint items already in flight
