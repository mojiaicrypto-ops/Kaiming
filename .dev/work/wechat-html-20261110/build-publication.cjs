// Reproducible static publication build. Run from repository root with Node 24.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = process.cwd();
const TASK = path.join(ROOT, '.dev/work/wechat-html-20261110');
const OUT = path.join(ROOT, 'articles/publish');
const ASSETS = path.join(OUT, 'agent-delivery-assets');
const MarkdownIt = require(path.join(ROOT, 'kaiming/node_modules/markdown-it'));
const { chromium } = require(path.join(ROOT, 'kaiming/node_modules/@playwright/test'));
const font = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const svgText = (x,y,txt,size=40,fill='#263532',weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(txt)}</text>`;
const svg = (w,h,inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f1f6f4"/><g font-family='PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif'>${inner}</g></svg>`;
const arrow = (x1,y1,x2,y2,color='#137b66',width=8) => `<path d="M${x1} ${y1}H${x2-16}" fill="none" stroke="${color}" stroke-width="${width}"/><path d="M${x2-28} ${y2-15}L${x2} ${y2}L${x2-28} ${y2+15}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const assets = [
{ id:'cover', width:1600,height:680, alt:'AI 说完成了，然后呢？完成声明需要经过核对，走向可核对的交付。', caption:'从一句完成声明，走向能打开、能核对、能继续的交付。', content:svg(1600,680,
`<rect x="0" y="0" width="18" height="680" fill="#137b66"/>`+
svgText(88,140,'AI 说完成了，',94,'#20312c',600)+svgText(88,255,'然后呢？',94,'#20312c',600)+
svgText(92,350,'从会写代码，到可交付的 Agent',52,'#4b635a')+
`<rect x="96" y="426" width="430" height="154" fill="#fff"/>`+
svgText(143,528,'完成声明',80,'#4b635a',500)+arrow(565,503,770,503)+
`<rect x="822" y="426" width="682" height="154" fill="#137b66"/>`+
svgText(880,528,'可核对的交付',80,'#fff',600)) },
{ id:'context-on-demand',width:900,height:720,alt:'按需读取资料：项目入口到模块地图，再到目标规格与共享规则、本次计划和相关代码测试；无关模块不必一次加载，缺口再补读。',caption:'入口负责指路，权威规格负责定义；缺口再补读，相关资料逐层进入当前工作。',content:svg(900,720,
svgText(52,76,'让相关资料进入当前工作',45,'#20312c',600)+
`<rect x="52" y="116" width="796" height="92" fill="#fff"/>`+svgText(84,175,'项目入口  →  模块地图',42,'#263532',500)+
`<path d="M450 218V250" stroke="#137b66" stroke-width="7"/><path d="M437 238L450 255L463 238" fill="none" stroke="#137b66" stroke-width="7"/>`+
`<rect x="52" y="272" width="796" height="160" fill="#137b66"/>`+svgText(84,331,'目标模块规格 ＋ 共享规则',42,'#fff',600)+svgText(84,391,'本次计划 ＋ 相关代码与测试',40,'#fff',500)+
`<path d="M450 442V476" stroke="#137b66" stroke-width="7"/><path d="M437 464L450 481L463 464" fill="none" stroke="#137b66" stroke-width="7"/>`+
svgText(52,538,'足以独立理解 → 推进 → 检查',40,'#263532',600)+
`<rect x="52" y="582" width="796" height="86" fill="#e0ebe6"/>`+svgText(84,637,'无关模块不必全载；遇到缺口再补读。',34,'#37554a')) },
{ id:'independent-verification',width:900,height:780,alt:'自证循环中，实现输出成为测试期望，二者一致仍可能有错。独立验证从已确认验收与独立数据出发，既检查实际结果，也让已知坏输入因预期原因失败。',caption:'检查的期望来自验收与独立事实；已知坏输入必须因预期原因被拒绝，才能说明检查有区分力。',content:svg(900,780,
svgText(52,76,'全绿，也可能仍在自证',45,'#20312c',600)+
`<rect x="52" y="116" width="796" height="166" fill="#e2e9e6"/>`+
svgText(84,173,'实现输出  →  测试期望',42,'#37554a',600)+
svgText(84,238,'共享一个假设，彼此一致仍可能错。',34,'#4b635a')+
svgText(52,365,'让检查有机会推翻实现',45,'#20312c',600)+
`<rect x="52" y="405" width="796" height="96" fill="#137b66"/>`+svgText(84,467,'已确认验收 ＋ 独立数据',42,'#fff',600)+
`<path d="M450 511V540" stroke="#137b66" stroke-width="7"/><path d="M437 528L450 545L463 528" fill="none" stroke="#137b66" stroke-width="7"/>`+
svgText(84,603,'实际结果：是否满足要求？',40,'#263532',500)+svgText(84,665,'已知坏输入：能否正确拒绝？',40,'#263532',500)+svgText(84,731,'拒绝原因要对，报错本身不够。',34,'#137b66',600)) }
];
const edits = [
['《Lost in the Middle》（TACL 2024）','《Lost in the Middle》（TACL 2024，原文：[https://aclanthology.org/2024.tacl-1.9/](https://aclanthology.org/2024.tacl-1.9/)）'],
['通过之后，再由独立的 Test 验证用户结果与相关回归；发现缺陷，返回修复，重新审核和测试，不能改了成果还借用旧报告。','Review 通过之后，适用的工作再由独立 Test 验证用户结果与相关回归；发现缺陷，返回修复，重新审核并执行适用测试。交付文件变化后，旧结论不再证明当前成果。'],
['程序能检查计划里有没有验收一节，却不知道验收写得是否充分；能确认测试报告存在，却不知道测试有没有按用户要求设计。所以我们让审阅结论绑定被审阅的交付物，交付物一变，旧结论就不再算数。','程序能检查计划里有没有验收一节，却不知道验收写得是否充分；能确认测试报告存在，却不知道测试有没有按用户要求设计。所以我们让审阅结论绑定被审阅的交付文件；这些文件变化后，旧结论就不再证明当前成果。'],
['所以我们按影响选择验证强度：纯展示变化，独立 Review 后结算即可；局部行为变化，增加定向检查和一条聚焦的浏览器路径，由独立 Test 覆盖本次验收与相关回归；涉及共享契约、迁移、权限或状态机的高风险变化，才扩大到跨模块验证。导出功能涉及权限，就不能因为界面只多了一个按钮，算成轻量修改。','所以我们按影响选择验证强度：纯展示变化，在不改变事件、状态、请求、数据，也不触及公共布局或共享设计令牌的前提下，独立 Review 后结算即可；局部后端行为变化，增加定向单元和接口集成检查；页面交互变化，再加一条聚焦的真实浏览器路径。适用的独立 Test 覆盖本次验收与相关回归；涉及共享契约、迁移、权限、状态机或公共布局等高风险变化，才扩大到跨模块验证。导出功能涉及权限，就不能因为界面只多了一个按钮，算成轻量修改。'],
['【发布前请补充】关于开明：一两句话说明项目是什么、谁在做、读者怎么了解（文末引导）。','## 关于开明\n\n开明是一个持续推进软件项目的 AI 工作台，面向个人开发者和软件项目负责人。它围绕主管协作、待办与规格、任务交付和项目知识组织工作，目标是让成果经过适用的独立检查，并让下一次工作接得上。本文介绍其中的设计思路与已有验证边界。']
];
const styles = {
 h1:`margin:0 0 12px;color:#20312c;font-size:29px;line-height:1.45;font-weight:700;letter-spacing:-0.02em;overflow-wrap:anywhere;`,
 h2:`margin:48px 0 22px;color:#20312c;font-size:22px;line-height:1.55;font-weight:700;overflow-wrap:anywhere;`,
 p:`margin:0 0 22px;color:#293732;font-size:17px;line-height:1.95;text-align:left;overflow-wrap:anywhere;`,
 strong:`font-weight:700;color:#137b66;`,
 ul:`padding:0 0 0 1.35em;margin:4px 0 26px;color:#293732;font-size:17px;line-height:1.95;`,
 li:`margin:0 0 13px;padding-left:3px;`,
 a:`color:#137b66;text-decoration:underline;overflow-wrap:anywhere;`,
 section:`box-sizing:border-box;max-width:680px;margin:0 auto;padding:0;color:#293732;font-family:${font};font-size:17px;line-height:1.95;word-wrap:break-word;`,
 img:`display:block;width:100%;height:auto;margin:0;max-width:100%;`,
 figcaption:`margin:11px 0 0;color:#607269;font-size:14px;line-height:1.8;text-align:left;`,
 figure:`margin:30px 0 36px;padding:0;`,
 subtitle:`margin:0 0 28px;color:#607269;font-size:18px;line-height:1.8;`
};
function build(mdSource, imageMode) {
 const md = new MarkdownIt({html:false,linkify:true,typographer:false});
 const source = mdSource.replace(/^# AI 说“完成了”，然后呢？从会写代码到可交付的 Agent\n/,'# AI 说“完成了”，然后呢？\n\nSUBTITLEPLACEHOLDER\n');
 const tokens = md.parse(source,{});
 const expected = [];
 for (let i=0;i<tokens.length;i++) if (tokens[i].type==='inline') expected.push(tokens[i].content==='SUBTITLEPLACEHOLDER'?'从会写代码到可交付的 Agent':tokens[i].children.filter(t=>t.type==='text'||t.type==='code_inline'||t.type==='softbreak').map(t=>t.type==='softbreak'?'\n':t.content).join(''));
 for (const [token,tag] of Object.entries({heading_open:'',paragraph_open:'p',strong_open:'strong',bullet_list_open:'ul',list_item_open:'li',link_open:'a'})) {
   md.renderer.rules[token] = (ts,idx,opts,env,self)=>{ts[idx].attrSet('style',styles[ts[idx].tag] || styles[tag]);return self.renderToken(ts,idx,opts);};
 }
 md.renderer.rules.hr = ()=>'';
 let body = md.renderer.render(tokens,md.options,{});
 body=body.replace(`<p style="${styles.p}">SUBTITLEPLACEHOLDER</p>`,`<p style="${styles.subtitle}">从会写代码到可交付的 Agent</p>`);
 function fig(id) { const a=assets.find(a=>a.id===id); const src=imageMode==='embedded'?`data:image/png;base64,${a.png}`:`agent-delivery-assets/${id}.png`;return `<figure style="${styles.figure}"><img src="${src}" width="${a.width}" height="${a.height}" alt="${esc(a.alt)}" style="${styles.img}"><figcaption style="${styles.figcaption}">${a.caption}</figcaption></figure>`; }
 const introEnd=body.indexOf('</p>',body.indexOf('你让 AI 补一个功能。'))+4;
 body=body.slice(0,introEnd)+fig('cover')+body.slice(introEnd);
 const contextEnd=body.indexOf('</p>',body.indexOf('开发者只需沿着'))+4;
 body=body.slice(0,contextEnd)+fig('context-on-demand')+body.slice(contextEnd);
 const testEnd=body.indexOf('</p>',body.indexOf('这就是<strong'))+4;
 if (testEnd<4) throw Error('negative-control insertion anchor missing');
 body=body.slice(0,testEnd)+fig('independent-verification')+body.slice(testEnd);
 return { body:`<section style="${styles.section}">${body}</section>`, expected };
}
(async()=>{
 await fs.mkdir(ASSETS,{recursive:true});await fs.mkdir(path.join(TASK,'screenshots'),{recursive:true});
 const original=await fs.readFile(path.join(ROOT,'articles/agent-delivery-system-wechat.md'),'utf8');
 let copy=original;
 for(const [before,after] of edits){if(copy.split(before).length!==2)throw Error(`edit anchor not unique: ${before.slice(0,30)}`);copy=copy.replace(before,after);}
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
 for(const a of assets){
  const sourcePath=path.join(ASSETS,a.id+'.svg');
  await fs.writeFile(sourcePath,a.content);
  // Give each SVG its own compositor surface; reusing a resized Page caused a
  // visible stale strip in a Chrome screenshot despite correct SVG geometry.
  const assetPage=await browser.newPage({viewport:{width:a.width,height:a.height},deviceScaleFactor:1});
  await assetPage.goto(pathToFileURL(sourcePath).href,{waitUntil:'load'});
  await assetPage.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const p=path.join(ASSETS,a.id+'.png');
  await assetPage.locator('svg').screenshot({path:p,animations:'disabled'});
  await assetPage.close();
  a.png=(await fs.readFile(p)).toString('base64');
 }
 const page=await browser.newPage({deviceScaleFactor:1});
 const embedded=build(copy,'embedded');const fragment=build(copy,'relative');
 const head=`<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>AI 说“完成了”，然后呢？从会写代码到可交付的 Agent</title></head><body style="box-sizing:border-box;margin:0;background:#fff;padding:30px 18px 64px;">`;
 const previewPath=path.join(OUT,'agent-delivery-system-wechat.html');
 await fs.writeFile(previewPath,head+embedded.body+'</body></html>\n');
 await fs.writeFile(path.join(OUT,'agent-delivery-system-wechat-body.html'),fragment.body+'\n');
 const previewURL=pathToFileURL(previewPath).href;
 const findings=[];
 for (const width of [375,390,768,1440]) {
  await page.setViewportSize({width,height:900});await page.goto(previewURL,{waitUntil:'load'});await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  const result=await page.evaluate(expected=>{
   const normalized=s=>s.replace(/\s+/g,' ').trim();
   const blocks=[...document.querySelectorAll('h1,h2,p,li')].filter(e=>e.tagName!=='LI'||!e.querySelector('p')).map(e=>normalized(e.textContent));
   const expectedBlocks=expected.map(normalized);
   const overflows=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.left<-.5||b.right>innerWidth+.5;}).map(e=>({tag:e.tagName,text:e.textContent.slice(0,40)}));
   const links=[...document.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.getAttribute('href')}));
   const linksWithoutChineseTail=links.every(a=>!/[\u3400-\u9fff]/u.test(decodeURIComponent(a.href)));
   const paperLinkExact=links.filter(a=>a.text==='https://aclanthology.org/2024.tacl-1.9/').length===1&&links.some(a=>a.text==='https://aclanthology.org/2024.tacl-1.9/'&&a.href==='https://aclanthology.org/2024.tacl-1.9/');
   return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,overflow:overflows,allParagraphs:JSON.stringify(blocks)===JSON.stringify(expectedBlocks),blockCount:blocks.length,expectedBlockCount:expectedBlocks.length,images:[...document.images].map(i=>({decoded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight})),scripts:document.scripts.length,iframes:document.querySelectorAll('iframe').length,externalResources:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(v=>!v.startsWith('data:')),links,linksWithoutChineseTail,paperLinkExact,font:getComputedStyle(document.querySelector('p[style*="font-size:17px"]')).fontSize,lineHeight:getComputedStyle(document.querySelector('p[style*="font-size:17px"]')).lineHeight};
  },embedded.expected);
  if(!result.allParagraphs||result.overflow.length||result.documentWidth!==width||result.images.some(i=>!i.decoded)||!result.linksWithoutChineseTail||!result.paperLinkExact)throw Error(JSON.stringify(result));
  findings.push(result);
  await page.screenshot({path:path.join(TASK,'screenshots',`article-${width}-full.png`),fullPage:true});
  await page.screenshot({path:path.join(TASK,'screenshots',`article-${width}-top.png`)});
  if(width===390){for(const id of ['context-on-demand','independent-verification']){const loc=page.locator(`img[alt="${assets.find(a=>a.id===id).alt}"]`).locator('..');await loc.screenshot({path:path.join(TASK,'screenshots',`article-390-${id}.png`)});}await page.locator('p').filter({hasText:'《Lost in the Middle》'}).screenshot({path:path.join(TASK,'screenshots','article-390-research-link.png')});await page.getByRole('heading',{name:'关于开明',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(TASK,'screenshots','article-390-close.png')});}
 }
 const fragWrap=path.join(TASK,'fragment-preview.html');await fs.writeFile(fragWrap,head+fragment.body.replaceAll('src="agent-delivery-assets/','src="../../../articles/publish/agent-delivery-assets/')+'</body></html>');
 await page.setViewportSize({width:390,height:900});await page.goto(pathToFileURL(fragWrap).href);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));const fragCheck=await page.evaluate(()=>{
  const links=[...document.querySelectorAll('a')].map(a=>({text:a.textContent,href:a.getAttribute('href')}));
  return {images:[...document.images].map(i=>({complete:i.complete,width:i.naturalWidth})),styles:[...document.querySelectorAll('section,h1,h2,p,ul,li,strong,a,figure,img,figcaption')].every(e=>e.hasAttribute('style')),externalCSS:document.querySelectorAll('style,link').length,scripts:document.scripts.length,links,linksWithoutChineseTail:links.every(a=>!/[\u3400-\u9fff]/u.test(decodeURIComponent(a.href))),paperLinkExact:links.filter(a=>a.text==='https://aclanthology.org/2024.tacl-1.9/').length===1&&links.some(a=>a.text==='https://aclanthology.org/2024.tacl-1.9/'&&a.href==='https://aclanthology.org/2024.tacl-1.9/')};
 });
 if(!fragCheck.linksWithoutChineseTail||!fragCheck.paperLinkExact)throw Error(JSON.stringify(fragCheck));
 await fs.writeFile(path.join(TASK,'implementation-checks.json'),JSON.stringify({sourceSha256:crypto.createHash('sha256').update(original).digest('hex'),edits:edits.map(([before,after])=>({before,after})),viewports:findings,fragment:fragCheck},null,2)+'\n');
 console.log(JSON.stringify({outputs:[previewPath,path.join(OUT,'agent-delivery-system-wechat-body.html')],viewports:findings.map(x=>({width:x.viewport,blocks:x.blockCount,height:x.height,images:x.images.length,overflow:x.overflow.length,allParagraphs:x.allParagraphs})),fragment:fragCheck},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
