# P4-h0 · 渲染库选型试验（markdown / 语法高亮 / ANSI / 长列表虚拟化）

日期：2026-10-09。状态：**完成**。本片只做选型与量测：不写任何 UI，不开始 P4-f 及之后切片。
依据：`plan.md` §3 前端技术形态、§4 切片 `P4-h0`。

- 试验脚本：`devagent/spikes/web-01-renderers.ts`（`node --experimental-strip-types`，与现有 `pi-*.ts` 同风格：PASS/FAIL 逐条、结束时按失败置 `process.exitCode`）。
- 内置产物：`devagent/web/vendor/`，逐文件版本 / 许可证 / 导入路径 / sha256 见 `devagent/web/vendor/README.md`。
- 交付方式：固定版本的**已发布 ESM 构建**原样复制，浏览器直接 `import`，**无构建步骤**。

## 1. 结论（锁定清单）

| 用途 | 选定 | 版本 | 许可证 | 是否需打包器 |
| --- | --- | --- | --- | --- |
| Markdown（GFM 表格/围栏/列表） | `markdown-it` | 14.1.0 | MIT | 否 |
| 代码语法高亮 | `@highlightjs/cdn-assets`（highlight.js 官方浏览器产物） | 11.11.1 | BSD-3-Clause | 否 |
| ANSI / 日志着色 | `ansi_up` | 6.0.6 | MIT | 否 |
| 长列表虚拟化 | `@tanstack/virtual-core` | 3.13.12 | MIT | 否 |

所有四个库均以**原生浏览器 ESM**交付，`devagent/web/` 无需打包步骤，符合 plan §3「交付方式」的默认形态（未动用 esbuild 例外条款）。

## 2. 被拒绝的候选（含理由）

- **`anser` 2.3.2（MIT）**：只有 CJS——入口 `lib/index.js` 以 `module.exports = Anser` 导出，并带 Babel 运行时包装。浏览器无法直接 `import`，需引入打包器。脚本中经 Node 的 CJS 互操作验证它确实能把 ANSI 转成带 `<span>` 的 HTML（说明函数本身可用），但它**不作为浏览器依赖内置**。替代：`ansi_up` 6.0.6（同一功能，原生 ESM，零依赖，单文件）。
- **`highlight.js` 11.11.1 核心包（BSD-3-Clause）**：其官方 `es/` 目录不是浏览器 ESM，而是 CJS 包装——`es/core.js` 的内容就是 `import HighlightJS from '../lib/core.js'`，而 `lib/core.js` 是 `module.exports` 的 CJS。裸浏览器按 ESM 加载会失败（需打包器或 Node 的互操作）。替代：官方预编译浏览器产物 `@highlightjs/cdn-assets`（**同版本 11.11.1**，`es/**` 为纯 ESM），本次内置。

结论：两者被拒的共同原因是**发布物不是浏览器可消费的 ESM**（须打包），与 plan §3「若某库无法以 ESM 直接消费只允许加一条 esbuild 命令」的判断一致；本片选择直接更换为原生 ESM 的等价库，**不必触发 esbuild 例外**。

## 3. 体积（KB；原始 / gzip）

数据来自脚本对内置文件的实测；逐文件明细见 `vendor/README.md`。

| 库 | 文件数 | 原始 | gzip |
| --- | ---: | ---: | ---: |
| markdown-it（`index.mjs` + `lib/**`） | 53 | 161.6 KB | 56.8 KB |
| highlight.js（`es/core.min.js` + 10 个语言 + 主题 CSS + `es/package.json`） | 13 | 61.6 KB | 24.8 KB |
| ansi_up（`ansi_up.js`） | 1 | 22.1 KB | 3.6 KB |
| virtual-core（`index.js` + `utils.js`） | 2 | 27.9 KB | 6.3 KB |
| **合计** | **69** | **273.3 KB** | **91.5 KB** |

高亮的语言包只内置 `bash/css/diff/javascript/json/markdown/python/typescript/xml/yaml`，后续切片按需增补；主题内置 `styles/atom-one-dark.min.css`（mock 为深色控制台）。

## 4. 渲染 / 计算计时（ms）

脚本自制夹具，取 5 次或 20 次平均（同一进程、冷启动后）：

| 项目 | 夹具体量 | 结果 |
| --- | --- | --- |
| markdown-it + highlight.js 渲染围栏代码块 | 2 000 行 `javascript` fence | **32.1 ms/render**（输出 374 762 字符） |
| markdown-it GFM 表格 | 30 行 + 表头 | 渲染出 31 个 `<tr>` |
| ansi_up 着色 | 3 行混合 SGR 日志 | 228 字符带 `ansi-*` 类 HTML |
| virtual-core 区间计算 | 5 000 项 / 24px / 600px 视口 | **0.159 ms/range**；offset 0 → `[0,24]`，offset 1200 → `[50,74]`，总高 120 000 px |

阈值：脚本对单次 markdown 渲染设 250 ms 上限，超出即判失败。实测 32 ms，余量充足。

## 5. 虚拟化取舍（plan §3 的「退化为约 80 行自研窗口化」）

`@tanstack/virtual-core` 的纯 ESM 构建仅 27.9 KB（gzip 6.3 KB），且区间计算在 Node 里可直接验证（无需真实 DOM 即可算出可视区间）。因此**保留该库**，不做自研窗口化：收益（滚动往返、动态高度、lane 支持、边界正确性）大于 6.3 KB 传输成本，也避免 ~80 行手写窗口化再自证。若后续发现仅需「定高日志追加窗口」，可在 P4-h 复查。

## 6. 复现命令与实测输出

```text
cd devagent && node --experimental-strip-types spikes/web-01-renderers.ts
```

```text
# P4-h0 renderer spike
versions: markdown-it 14.1.0 · highlight.js 11.11.1 · ansi_up 6.0.6 · @tanstack/virtual-core 3.13.12

## Vendored browser artifacts
  markdown-it/index.mjs                          raw    0.0 KB  gzip    0.1 KB
  markdown-it/lib/index.mjs                      raw   17.5 KB  gzip    5.3 KB
  highlight.js/es/core.min.js                    raw   20.0 KB  gzip    8.0 KB
  highlight.js/es/languages/javascript.min.js    raw    6.4 KB  gzip    2.7 KB
  highlight.js/es/languages/typescript.min.js    raw    7.7 KB  gzip    3.1 KB
  highlight.js/es/languages/bash.min.js          raw    3.1 KB  gzip    1.6 KB
  highlight.js/styles/atom-one-dark.min.css      raw    0.8 KB  gzip    0.4 KB
  ansi_up/ansi_up.js                             raw   22.1 KB  gzip    3.6 KB
  virtual-core/index.js                          raw   25.8 KB  gzip    5.4 KB
  virtual-core/utils.js                          raw    2.1 KB  gzip    0.9 KB
  (sampled subset)                               raw  105.6 KB  gzip   31.0 KB
PASS  markdown-it + highlight.js load from vendored ESM :: markdown-it 14.1.0, highlight.js 11.11.1, languages: bash,javascript,typescript
PASS  markdown-it renders a 2 000-line fenced block with highlight.js markup :: 32.1 ms/render over 5 runs; 374762 chars output
PASS  markdown-it renders a 30-row GFM table :: 31 <tr> rows (header + 30)
PASS  anser converts an ANSI sample (Node CJS interop) :: rejected as a browser dependency; not vendored
PASS  vendored ansi_up converts an ANSI sample to classed HTML :: ansi_up 6.0.6 output 228 chars
PASS  virtual-core computes the visible range for 5 000 items at a 600px viewport :: offset 0 -> [0, 24], offset 1200 -> [50, 74], total 120000px; 0.159 ms/range

## Verdict
Bundler needed: no — markdown-it, @highlightjs/cdn-assets, ansi_up and @tanstack/virtual-core
all publish plain browser ESM and are vendored byte-identical (see web/vendor/README.md).
Rejected: anser and the highlight.js core `es/` build are CJS-backed (would require a bundler).

6/6 checks passed
```

退出码 0。

## 7. 字节一致性与哈希

内置文件均以 `cmp` 与 `node_modules/` 中的上游发布物逐字节比对，全部一致：

```text
identical=69 mismatches=0
```

逐文件 sha256 记录在 `devagent/web/vendor/README.md`（每库一张表）。库级聚合 sha256（按相对路径排序后拼接文件内容）：

| 库 | 文件数 | 聚合 sha256 |
| --- | ---: | --- |
| markdown-it | 53 | `8b09ae9eaff2d5eaaca2726ef8f82ac471bd3102f7f412b3c87923598ae5a409` |
| highlight.js | 13 | `1c6b52e5d062c46d8bb32091c48193fa69bc286bb48da45c4688ccbfed231c33` |
| ansi_up | 1 | `554a7d9ca4f3721db1f14941f92dc75b254f57d4b7bffeb84eea1174aa160780` |
| virtual-core | 2 | `7f7b28a89559ab75b4cebdcf25f5d6fd8087f956670b319fab35e70cbf4dae5a` |

## 8. 对后续切片的约束

- P4-f/P4-h 只能从 `devagent/web/vendor/` 导入这四个库（或经 `index.html` 的 import map，见 `vendor/README.md` 末尾）；不得新增打包步骤。
- Markdown 的「半截 fence / 半截表格」暂存与完成重排由我们的状态机负责，库只做完整文档解析（plan §3「自研只做增量与状态，不做解析」）。
- 若某个新语言需要高亮，从 `@highlightjs/cdn-assets` 增补对应 `es/languages/<lang>.min.js` 并同步更新 `vendor/README.md`。
