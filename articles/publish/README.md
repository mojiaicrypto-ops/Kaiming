# 《AI 说“完成了”，然后呢？》发布文件

此目录是本地制作的图文发布材料，尚未进入公众号后台或对外发布。

## 文件

- `agent-delivery-system-wechat.html`：完整离线预览。CSS 写在各元素的 `style` 中，三张 PNG 以 data URI 嵌入；直接用浏览器打开即可，不需要服务、网络、字体下载或 JavaScript。
- `agent-delivery-system-wechat-body.html`：公众号正文素材片段，只有正文 `section`，CSS 同样内联。图片暂用相对路径 `agent-delivery-assets/*.png`；它不是已上传素材，也不是可直接提交公众号 API 的请求内容。
- `agent-delivery-assets/cover.png`：1600 × 680，横向封面。后台如需其他裁切比例，需在实际封面预览中重新检查标题位置。
- `agent-delivery-assets/context-on-demand.png`：900 × 720，按需读取资料解释图。
- `agent-delivery-assets/independent-verification.png`：900 × 780，自证与独立验证解释图。
- 三张同名 `.svg` 是可编辑原稿，发布 HTML 实际使用 PNG。

## 如何入稿

1. 在浏览器打开完整离线预览，通读正文及配图。公众号后台的标题栏可使用“AI 说‘完成了’，然后呢？从会写代码到可交付的 Agent”；正文顶部目前也保留标题和副题，可根据后台预览决定是否保留重复标题。
2. 使用自己的公众号图文编辑流程导入正文样式。若从浏览器复制，请复制渲染后的内容，而非把整份 HTML 源码当文字粘贴；后台是否保留全部样式，需要实际预览确认。
3. 在公众号后台分别上传 `agent-delivery-assets` 中的 PNG；在正文相应位置插入或替换成已上传图片。封面单独选择 `cover.png` 并核对裁切。相对路径和 data URI 都不能当作“已上传到公众号”。
4. 如果通过支持 HTML 的编辑工具处理正文片段，先完成图片上传，再以实际素材地址替换三个 `img src`，按该工具及公众号当前要求提交。这里不提供未经实测的 API 参数或兼容性承诺。
5. 发到手机预览，检查段落、标题、链接换行、三张图的清晰度及封面裁切；确认后再由账号所有者发布。

本次未执行公众号后台粘贴、素材上传、草稿创建、手机微信预览或群发发布。浏览器检查只证明这些本地文件的静态呈现。

## 发布编辑

原始 Markdown `articles/agent-delivery-system-wechat.md` 保持不变；全文结构、案例与论证保留。发布副本只做以下编辑：

- 主标题与副题分开排版，内容不删；增加三幅解释图及图说明。
- 为《Lost in the Middle》增加原始研究 URL：<https://aclanthology.org/2024.tacl-1.9/>。
- “Review 后 Test”明确为适用的工作执行独立 Test。
- 定向后端检查与页面交互浏览器路径分开表述；纯展示排除事件、状态、请求、数据、公共布局与共享设计令牌变化。
- 交付文件变化后，旧结论不能继续证明当前成果。
- 文末待补占位改为依据产品定位撰写的“关于开明”，没有虚构作者、项目网址、联系方式或二维码。

## 重制与检查

在仓库根目录运行（复用仓库现有依赖，不安装新包）：

```sh
node .dev/work/wechat-html-20261110/build-publication.cjs
```

要求 Node 24、仓库 `kaiming/node_modules` 中的 `markdown-it` 与 `@playwright/test`，以及 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。脚本从原始 Markdown 生成两种 HTML，将 SVG 经 Chrome 导出 PNG，并重新生成截图与检查记录。Chrome 需要环境允许启动本机浏览器。其他系统可在脚本中调整 Chrome 路径；字体差异可能影响字形和换行，需重新目视复核。

实施检查记录：`.dev/work/wechat-html-20261110/implementation-checks.json`；截图：同目录 `screenshots/`。375、390、768、1440 像素视口检查了横向溢出、逐块正文对应、PNG 解码与本地资源约束。采用 `visual` 验证档，没有独立 Test 或全量应用测试；独立 Review 与项目结算由主管另行组织。
