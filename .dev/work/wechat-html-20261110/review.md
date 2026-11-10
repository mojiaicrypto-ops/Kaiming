# 独立图文发布稿 Review

Reviewer：`/root/wechat_publish_review`，fork_turns=none，全新只读上下文。未读作者/主管聊天、自评或实施报告，不修改或提交。验证档visual，无Test。

## 首轮 failed

阻断P2：完整HTML第23行及正文片段第22行，论文URL的自动linkify吞入右括号及后续整段中文，链接不正确。要求显式链接到 `https://aclanthology.org/2024.tacl-1.9/`，重建并复核。

其余检查：独立解析源67正文块、成品69块，差异只为标题拆分、授权来源/技术边界校准和关于开明替换占位，无漏段或新增主线。两HTML正文除img.src外相同，无script、事件处理、iframe、外部CSS、类依赖或远程加载资源。内嵌PNG严格解码且与独立图尺寸/摘要一致。

亲自看三PNG、375/390/768/1440顶部、390两解释图/结尾/全长排列。图字手机尺寸可读，无裁切/重叠/残影；全长缩略图只核对排列，细部用原图及局部截图。README明确预览、本地片段与实际公众号素材的区别，不保证上传或后台兼容。validation同样保留边界，无虚构身份/网址/业务证明。

## 复审 passed

两HTML唯一href均精确为论文原始URL，后续中文移出。独立逆向还原链接修补后，两文件均匹配首轮摘要，正文及其他结构未变。亲自看390研究段截图，链接边界/换行正常，无溢出裁切。三PNG、三SVG、README摘要与首轮相同；检查记录新增精确href验证，保持四宽69正文块与无溢出。

ZIP共10条目（9文件、1资源目录项），无额外内容，逐文件字节与发布文件相同。原阻断闭合，无新增问题。

最终SHA-256：

- 完整HTML：`4eb0fcbf1c54f124e24fe1209c4dca3414f23e1afbc8abbd3f45b3212e242289`
- 正文片段：`885a414f6b8beecbe16b8cd35752ffab2d96e94974f24d696afeadfcf70e0a0b`
- ZIP：`2bc9f7d9184a29c073c170e2507999032ced17fbb611b40bfa60c33b2fcefcc5`
- 检查记录：`4376a585adcdc1743af223b28873470ce180d0e0971b944f6ed4659ac1a0dd3d`
- 390研究段截图：`cc85e21b7d4870eee1bbde8d9d9e228e90350fce02eebb241c3cf5aaa9d9a490`
- 原Markdown（未变）：`3bc5ac51ccce5e0a7e51f754e38592887f6f1f439894ddee08c67f361fad9e78`

依据AGENTS、INDEX、Plan、选定Markdown、D/K/G3和validation现有证据。实际执行静态结构/内容对应、图片解码/字节核对、亲自看图、多视口截图阅读及ZIP比较。未执行公众号后台、手机微信预览、素材上传或发布，不能证明其真实兼容性。无应用Test/E2E。
