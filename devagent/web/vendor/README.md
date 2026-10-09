# 前端渲染库内置产物（vendored ESM）

P4-h0 选定。此处每个文件均从 npm 发布构建**原样复制**：不压缩、不改写、不打包，浏览器经 ES modules 直接加载，`devagent/web/` 无构建步骤。逐文件 sha256 如下；全部 69 个文件已用 `cmp` 与 `node_modules/` 中的上游逐字节核对一致。

文档中的相对路径以 `devagent/web/` 为根（`index.html` 所在目录），例如 `./vendor/markdown-it/index.mjs`。import map 可选，见文末。

## markdown-it — Markdown 解析

- 版本：14.1.0
- 许可证：MIT
- 上游：`node_modules/markdown-it/`（官方 ESM 构建：根 `index.mjs` + `lib/**`）
- 入口：`./vendor/markdown-it/index.mjs`
- 体积：53 个文件，原始 165481 B（161.6 KB），gzip 合计 58180 B（56.8 KB）
- 全库聚合 sha256（按文件名排序后拼接内容）：`8b09ae9eaff2d5eaaca2726ef8f82ac471bd3102f7f412b3c87923598ae5a409`

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `markdown-it/index.mjs` | 42 | `a112fad9f779e8e4d58a76586ec54b5b9fe134d92a670a96749bcb676be2c62b` |
| `markdown-it/lib/common/html_blocks.mjs` | 799 | `5bbdf4ab71bd31461b29d47da1077c600ba941c3e53d74f8d50ce31ac45546a5` |
| `markdown-it/lib/common/html_re.mjs` | 992 | `c3557626e86b451f44d022c2d171f60773d879a7461652002929f8ca349ba648` |
| `markdown-it/lib/common/utils.mjs` | 7897 | `6514ab390da85f15a904677a35632aa4c73cceabbbda8139f6c1ab1c49d32692` |
| `markdown-it/lib/helpers/index.mjs` | 275 | `c5a73b8f46eaa0f027f06a309a362f885ec4467c99a581d798cbb6a3bac14965` |
| `markdown-it/lib/helpers/parse_link_destination.mjs` | 1543 | `31e67e6c3732f4ace5120d281bba3bc31fe718591597953f3a68ead48997513e` |
| `markdown-it/lib/helpers/parse_link_label.mjs` | 985 | `70129adaa86dfd0f99e05971c51f865a3956775c045ccdc2ec8f2f2e0c0893aa` |
| `markdown-it/lib/helpers/parse_link_title.mjs` | 1851 | `c10fc0bd89f11eb982a865dcf525cf6f3bec328958bb4de752e3993b44eb9c7c` |
| `markdown-it/lib/index.mjs` | 17899 | `4e4bf54c022fac5a59179487c98b323570faa39ebba96b1e502ab37a18740c9c` |
| `markdown-it/lib/parser_block.mjs` | 3986 | `77837b8f5ce148a45e0c7e9f0f5bdaad46baaaac61946b0a6d279aaa20b23c90` |
| `markdown-it/lib/parser_core.mjs` | 1509 | `858b03ddfb9b2f36b628a86a0202d51c8cdbdb22e71656c8a706cdd168899c7a` |
| `markdown-it/lib/parser_inline.mjs` | 5434 | `4afdc1b5318aa0eea621ed4d66a66bb8f4560b967b639346b5a827d13b26c5fb` |
| `markdown-it/lib/presets/commonmark.mjs` | 1909 | `0287ae7e457b4a18f049aa81a7ca39bbc543eb2e9b95718476a8fb16dc299eee` |
| `markdown-it/lib/presets/default.mjs` | 1281 | `f8b577995fcde6bd0fcb96524eb32a872d9e82874921956fda81477913a94cc9` |
| `markdown-it/lib/presets/zero.mjs` | 1652 | `d88083cd3b6a87566b63950c99a810fa3228345a41cb1fe441f2d8139bb9e60f` |
| `markdown-it/lib/renderer.mjs` | 8929 | `79a5da48eff423a75a1caf433e4a0713ea6ef02b7a85c4db399f47799ce0904b` |
| `markdown-it/lib/ruler.mjs` | 8478 | `86b94f2a50df56a51ef6ee8bdfb23a6733e83a1efa2f58b3b166aebae84a7ce2` |
| `markdown-it/lib/rules_block/blockquote.mjs` | 6056 | `4253016ffc2a9dff791e68c6d9826ba324fe9b1510d3e9b2a3ca752e636e5ddd` |
| `markdown-it/lib/rules_block/code.mjs` | 686 | `65e90780dcf58ed3e37aa171277e2c397a8a2728f9d9c457fa6f5976561cea44` |
| `markdown-it/lib/rules_block/fence.mjs` | 2412 | `5dc3a8c63b6c7e2e4033a18f89507c8ee2f859581d2f3f868e31fc7557406524` |
| `markdown-it/lib/rules_block/heading.mjs` | 1497 | `aadf2027d34d68afcfa56f9c433c075456555b58fcc60abab34d0ef1b9a3de11` |
| `markdown-it/lib/rules_block/hr.mjs` | 1070 | `50aef3afcd307a28350be104aa51da5714a7500bdf3f79e8060e4a36ad9fe746` |
| `markdown-it/lib/rules_block/html_block.mjs` | 2200 | `485e0fd7d81549f6a9139e8573245b0e5e702e6d12a1e4107c0a89d847e41db9` |
| `markdown-it/lib/rules_block/lheading.mjs` | 2487 | `4a3f451a6b1c931d588b2de0811f405b343dfdcb692e217a41787fcb2edb72b6` |
| `markdown-it/lib/rules_block/list.mjs` | 9103 | `0cce19c6520cd0bd0683021ee333f104ac083bd0602cc23263f9add89aa7e2d9` |
| `markdown-it/lib/rules_block/paragraph.mjs` | 1458 | `c0abae8b490545c16acd0aff24f4fd3aacd6ddccad7417f0659064e9f70e971d` |
| `markdown-it/lib/rules_block/reference.mjs` | 5829 | `ece84dd6c52a8332c9bcb23d07de2ff5a591ea2816f325438efff33cd110cf17` |
| `markdown-it/lib/rules_block/state_block.mjs` | 5895 | `84b7ebc1298a65c896c575b1ea681978cb5a265c0d8f8aaf74ac8d20b112e150` |
| `markdown-it/lib/rules_block/table.mjs` | 7087 | `786996894b84fff0b2c42d7085da36ee942e73de5537317c1f7a444658fd187c` |
| `markdown-it/lib/rules_core/block.mjs` | 333 | `2b346ea2c486428da41b0324bdf5fd796e25ac53ea90549f2649faffa1541167` |
| `markdown-it/lib/rules_core/inline.mjs` | 289 | `0da70e72022dda01deaf6630a772a9c4798b6b6dc1d37144520b872d302b12a3` |
| `markdown-it/lib/rules_core/linkify.mjs` | 4248 | `ee94248071fc07477992f18006cc1f783c3ed979a462582c0998298f7e13d3a4` |
| `markdown-it/lib/rules_core/normalize.mjs` | 351 | `75adcc5e58b94a7802ef1c4862a0c74abc821fb6d76e1b02d51827e22b0a715f` |
| `markdown-it/lib/rules_core/replacements.mjs` | 2633 | `9b3211580c89951bad60aa4550f76ebf2d2b81cc4523849ed34e6b85ed25ba3a` |
| `markdown-it/lib/rules_core/smartquotes.mjs` | 5724 | `b1a6da1dd7de9324f18cc621edd70e44b0604c1ee4130c9c2ac59c0267365659` |
| `markdown-it/lib/rules_core/state_core.mjs` | 325 | `eb68c945733124231b5dc98d480854393b99fc069fd95703f4c36d310572e4f0` |
| `markdown-it/lib/rules_core/text_join.mjs` | 1147 | `d61f0f19e2e49b565564a1537c46828c18da453516226d1637816021d4d68fce` |
| `markdown-it/lib/rules_inline/autolink.mjs` | 2012 | `76b62a06d79b40bd9b4e834697cca85f4ac7b3de6b11c02303eff08adf0f15ff` |
| `markdown-it/lib/rules_inline/backticks.mjs` | 1674 | `8baed32815f895f72b0a01255c3180ba2e72fcffb51fbea7677ccf128dafbc40` |
| `markdown-it/lib/rules_inline/balance_pairs.mjs` | 4084 | `bd2dc3f4e69bfda37022dbe44fe17b02e96f39ff76c7b207bfc252f47a4c9d9a` |
| `markdown-it/lib/rules_inline/emphasis.mjs` | 3520 | `3bf949b999adee96130baa7e48642d872d3b689e43b382ffdba276a271fca8a7` |
| `markdown-it/lib/rules_inline/entity.mjs` | 1488 | `7fa70dc68b8c4681ea0fa7762d5996dd0afe04cf240480a9de34272c14935ef1` |
| `markdown-it/lib/rules_inline/escape.mjs` | 1419 | `f9c44ec930075f0b41f6f3afaef763ee7bc219baa5568d502a69aff535631980` |
| `markdown-it/lib/rules_inline/fragments_join.mjs` | 1267 | `143e477737ce7565af95a6c5dbb854667a07d45e7f3e1b849fb68ba39937014c` |
| `markdown-it/lib/rules_inline/html_inline.mjs` | 1163 | `df364c454b17a52123647579be2143ea801227c2667385d0dbdb8fdd05ea6cc1` |
| `markdown-it/lib/rules_inline/image.mjs` | 3638 | `67e1ad7ba6ce1a2ee0dfaee83653fec3f3e602f8d8841c4b8426c770b03870b4` |
| `markdown-it/lib/rules_inline/link.mjs` | 3724 | `447b3654c5ed967d11216ddfd948128348465a70ed270c7f6384d438d242eeec` |
| `markdown-it/lib/rules_inline/linkify.mjs` | 1674 | `7aa2f3bf668f136cbb76d001c06cdf54747022485ee6f8fb891b2d3fdb12c021` |
| `markdown-it/lib/rules_inline/newline.mjs` | 1199 | `4c51181f46d59ce1d40dfdec014d1eb69937de850eacfdd4fcb759f9f141e990` |
| `markdown-it/lib/rules_inline/state_inline.mjs` | 3493 | `c7f593713b63aa337be485e812ae45a3057eac1b53d08c1bd00450f3d9cc738a` |
| `markdown-it/lib/rules_inline/strikethrough.mjs` | 2935 | `eff53fc6e3b04acb4a5c78f4c6b8d15cb055059b480350e4e6d581ce206a5150` |
| `markdown-it/lib/rules_inline/text.mjs` | 2101 | `63aca7fc12c4e44bbe8edb6b8cf38c8bf01e3aa1ef5dd0feef82aae930b1d0e8` |
| `markdown-it/lib/token.mjs` | 3799 | `44a73c39e2f8c3f919029c59ec18bdf4fc790d316709c8158eb8795ad014a021` |

## highlight.js — 语法高亮

- 版本：11.11.1
- 许可证：BSD-3-Clause
- 上游：`node_modules/@highlightjs/cdn-assets/`（官方预编译浏览器产物；同版本核心包见“被拒绝的候选”）
- 入口：`./vendor/highlight.js/es/core.min.js`
- 体积：13 个文件，原始 63090 B（61.6 KB），gzip 合计 25434 B（24.8 KB）
- 全库聚合 sha256（按文件名排序后拼接内容）：`1c6b52e5d062c46d8bb32091c48193fa69bc286bb48da45c4688ccbfed231c33`

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `highlight.js/es/core.min.js` | 20445 | `bfcca5550cb9d62482162e1d1fb90c822d2d35036b556544817441b795b7103c` |
| `highlight.js/es/languages/bash.min.js` | 3182 | `d2290ecb0b7d522df0d91d54ee216c673e0c504decd48ef15197b3cab5cb7474` |
| `highlight.js/es/languages/css.min.js` | 13284 | `8024c97edb80335f7aded04543de058770eab34939b9b2db8334fb8aa16f0e45` |
| `highlight.js/es/languages/diff.min.js` | 611 | `259e0a75cbaa5ce6769259ac647cec904a4c6b5cdc6e8d66f7820b01213a4492` |
| `highlight.js/es/languages/javascript.min.js` | 6583 | `d893654be08f10fe656739ec83cf2cdeb7ea82a26b332b9fea88d4d215c00d89` |
| `highlight.js/es/languages/json.min.js` | 511 | `7dd0922802ac593d34da3466175377c9efb4612ee2ea97ddafa1fce618a510d9` |
| `highlight.js/es/languages/markdown.min.js` | 2189 | `e8f544abc25490c51ff4bea5687a02ef4a65f1edc83dd208b6664d2672b3e3d5` |
| `highlight.js/es/languages/python.min.js` | 3583 | `4112a5c44dc7a4c56a772347bd318f246aa1ea51e0d6cb6aba78b25c3e60d524` |
| `highlight.js/es/languages/typescript.min.js` | 7858 | `60f542a05921072df100b34ea9a20a765617c518f8ac11d1c2c238ae11d83fcc` |
| `highlight.js/es/languages/xml.min.js` | 2021 | `2d843265c0bdd3e50f107e6473196b5f525c0ea68de83c40f9f30ffbbea6896f` |
| `highlight.js/es/languages/yaml.min.js` | 1947 | `3d227e0d347021b99da5c7b8de86ec8ce647f2f15d3b97100b34f9d2507ec2e7` |
| `highlight.js/es/package.json` | 20 | `b5cc4b082f2065f41c8d38fad0ce5fb1883e504d8d5a64fc3b5cccc69125905e` |
| `highlight.js/styles/atom-one-dark.min.css` | 856 | `4237ffca7ce6aadb438c457e0a675b125c534bbdda5b87f41f3a1495603bcc9b` |

## ansi_up — ANSI/日志着色

- 版本：6.0.6
- 许可证：MIT
- 上游：`node_modules/ansi_up/ansi_up.js`（单一 ESM 文件，零依赖）
- 入口：`./vendor/ansi_up/ansi_up.js`
- 体积：1 个文件，原始 22656 B（22.1 KB），gzip 合计 3709 B（3.6 KB）
- 全库聚合 sha256（按文件名排序后拼接内容）：`554a7d9ca4f3721db1f14941f92dc75b254f57d4b7bffeb84eea1174aa160780`

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `ansi_up/ansi_up.js` | 22656 | `554a7d9ca4f3721db1f14941f92dc75b254f57d4b7bffeb84eea1174aa160780` |

## virtual-core — 长列表虚拟化

- 版本：3.13.12
- 许可证：MIT
- 上游：`node_modules/@tanstack/virtual-core/dist/esm/`（官方 ESM 构建）
- 入口：`./vendor/virtual-core/index.js`
- 体积：2 个文件，原始 28599 B（27.9 KB），gzip 合计 6412 B（6.3 KB）
- 全库聚合 sha256（按文件名排序后拼接内容）：`7f7b28a89559ab75b4cebdcf25f5d6fd8087f956670b319fab35e70cbf4dae5a`

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `virtual-core/index.js` | 26449 | `1557196be55d6f41f5bcb6d3186daf16606e94c778a28f984ab70e94abcdd674` |
| `virtual-core/utils.js` | 2150 | `d512d66a1d59a10ea922f298c50b71e3e86ee213894197059ef9e31e5e3c98b1` |

## 被拒绝的候选

- **anser 2.3.2（MIT）**：仅提供 CJS（`lib/index.js` 以 `module.exports = Anser` 导出，且带 Babel 运行时包装），浏览器无法直接 `import`，需引入打包器。已在 `spikes/web-01-renderers.ts` 中经 Node CJS 互操作验证其可着色，但不作为浏览器依赖。替代：`ansi_up` 6.0.6（原生 ESM、零依赖）。
- **highlight.js 11.11.1 核心包（BSD-3-Clause）**：其 `es/` 构建只是 CJS 包装（`es/core.js` 内容为 `import HighlightJS from '../lib/core.js'`，而 `lib/core.js` 是 CJS），裸浏览器 ESM 加载会失败，需打包器。替代：官方预编译浏览器产物 `@highlightjs/cdn-assets` 11.11.1（`es/**` 为纯 ESM，本次内置）。

## import map（可选）

若在 `index.html` 里用裸说明符，可加入：

```json
{ "imports": {
  "markdown-it": "./vendor/markdown-it/index.mjs",
  "highlight.js/core": "./vendor/highlight.js/es/core.min.js",
  "highlight.js/languages/": "./vendor/highlight.js/es/languages/",
  "ansi_up": "./vendor/ansi_up/ansi_up.js",
  "@tanstack/virtual-core": "./vendor/virtual-core/index.js"
} }
```

语言包说明：`highlight.js/es/languages/` 下内置 `bash/css/diff/javascript/json/markdown/python/typescript/xml/yaml` 十个 `.min.js`（逐个 `registerLanguage`）；主题内置 `styles/atom-one-dark.min.css`。

## 补充（P4-i 浏览器验收）：markdown-it 的传递依赖

P4-i 在真实 Chromium 里加载时发现：markdown-it 官方 ESM（`lib/**`）直接 import 裸说明符
`linkify-it`、`mdurl`、`uc.micro`、`punycode.js`、`entities`。它们既未随 P4-h0 内置，也未在 `index.html`
的 import map 里映射，于是 `app.js` 顶层的 `await import('markdown-it')` 失败、整个模块不执行（无登录框）。
本次按同样规则（原样复制、不压缩、不改写）补齐以下传递依赖，并把这 5 个裸说明符加入 `index.html` 的 import map：

| 裸说明符 | 入口 | 上游 |
| --- | --- | --- |
| `linkify-it` | `vendor/linkify-it/index.mjs` | `node_modules/linkify-it/`（index.mjs + lib/re.mjs） |
| `mdurl` | `vendor/mdurl/index.mjs` | `node_modules/mdurl/`（index.mjs + lib/*.mjs） |
| `uc.micro` | `vendor/uc.micro/index.mjs` | `node_modules/uc.micro/`（index.mjs + properties/** + categories/**） |
| `punycode.js` | `vendor/punycode.js/punycode.es6.js` | `node_modules/punycode.js/` |
| `entities` | `vendor/entities/lib/esm/index.js` | `node_modules/entities/lib/esm/**`（含 generated/**） |

补齐后 `web/vendor/` 共 93 个文件；上面各库的原始 69 文件与方法学不变。
