# 公众号静态发布稿实施说明

独立制作Session：`/root/wechat_layout`。写入范围publish目录及本任务制作/截图产物，无应用代码/依赖变化。

以用户选定Markdown制作两份纯HTML、三张PNG及SVG原稿、README；完整HTML内联CSS和PNG data URI，正文片段相同内容使用相对PNG路径。主管将最终HTML/README/assets按显式路径打包ZIP（10条目）。源Markdown SHA-256保持 `3bc5ac51ccce5e0a7e51f754e38592887f6f1f439894ddee08c67f361fad9e78`，不修改或顺带提交用户未跟踪文件。

发布副本的编辑逐项记录在implementation-checks.json：标题/副题拆排、原始研究URL、适用Test、后端与页面检查路径区别、visual排除共享布局令牌、当前交付文件绑定，以及有依据的关于开明。未新增架构主线或虚构身份、网址/二维码。内容对照为源67正文块、成品69（标题拆分和收尾完善），独立Review另核对这些差异。

图形采用SVG确定性绘制、Chrome导PNG，不使用生成式模型或虚假产品截图：封面1600×680；按需上下文900×720；独立验证900×780。白底/深色正文/青绿强调，17px正文、1.95行高、单栏。

实际运行build-publication.cjs，复用现有markdown-it和Playwright/Chrome，无安装。Chrome在sandbox首次SIGABRT后经正常提权执行生成与截图。375/390/768/1440视口：无横向溢出、69文本块对应、三图解码、无脚本/iframe/远程加载资源；完整记录在implementation-checks.json。截图含四宽全文与首屏、390正文图/研究段/结尾。主管及制作者亲自看过三图和局部页面截图。

两次修复：主管目视发现按需图底部残影，制作改为每图独立Page导航SVG并对SVG元素截图，重建后无裁切/重复；独立Review发现自动linkify吞入中文导致论文href错误，制作改为显式Markdown链接，添加解码后href与精确URL检查，重新生成并查看390研究段截图。最终PNG摘要未因链接修复改变。

本任务visual，无独立Test/全量应用套件。未执行公众号后台导入、上传、微信预览或发布；本地图片不是公众号素材，README已说明手动上传/替换及实际预览边界。
