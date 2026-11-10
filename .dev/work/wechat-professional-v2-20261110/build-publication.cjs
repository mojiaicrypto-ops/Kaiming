const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const ROOT=process.cwd(), TASK=path.join(ROOT,'.dev/work/wechat-professional-v2-20261110'), OUT=path.join(ROOT,'articles/publish/agent-delivery-system-wechat-v2'), ASSET=path.join(OUT,'assets');
const MarkdownIt=require(path.join(ROOT,'kaiming/node_modules/markdown-it'));
const {chromium}=require(path.join(ROOT,'kaiming/node_modules/@playwright/test'));
const C={bg:'#08121f',panel:'#0d1d2d',line:'#293b4f',ink:'#f2f6fb',muted:'#a9bbce',blue:'#6eb7ff',cyan:'#55dbc9',amber:'#f3c36b',red:'#ff8e90'};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t=(x,y,s,size=36,color=C.ink,weight=500,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
const rect=(x,y,w,h,color=C.line,fill=C.panel,r=10)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" stroke="${color}" stroke-width="2" fill="${fill}"/>`;
const line=(d,color=C.blue,dash=false,arrow=true)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linejoin="round" ${dash?'stroke-dasharray="9 8"':''} ${arrow?`marker-end="url(#${Object.entries(C).find(([k,v])=>v===color)?.[0]||'blue'})"`:''}/>`;
function icon(x,y,kind,color=C.blue,s=1){const parts={doc:'<path d="M4 0H39L54 15V66H4Z M39 0V16H54 M15 29H42 M15 41H42 M15 53H34"/>',code:'<rect x="0" y="5" width="66" height="52" rx="5"/><path d="M23 20L12 31L23 42 M43 20L54 31L43 42 M37 17L29 45"/>',check:'<path d="M6 0H48V63H6Z M15 17L21 23L32 11 M15 37L21 43L32 31 M37 19H43 M37 39H43 M15 53H43"/>',archive:'<rect x="0" y="13" width="63" height="45" rx="4"/><path d="M-2 0H65V14H-2Z M23 30H40 M31 30V43"/>',shield:'<path d="M30 0L56 12V34Q55 52 30 66Q5 52 4 34V12Z M15 32L26 43L46 21"/>',people:'<circle cx="20" cy="13" r="11"/><path d="M0 49V40Q0 27 20 27Q40 27 40 40V49Z M43 5Q60 5 60 20Q60 31 47 32 M47 38Q65 38 65 54"/>',file:'<path d="M5 0H43L58 15V65H5Z M43 0V16H58 M16 31H47 M16 43H47 M16 55H37"/>'};return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${parts[kind]}</g>`;}
function legend(y){return line(`M42 ${y}H798`,C.line,false,false)+[ ['blue','依据'],['cyan','实现'],['amber','验证'],['red','风险/返工'] ].map(([k,l],i)=>`<circle cx="${57+i*199}" cy="${y+46}" r="6" fill="${C[k]}"/>`+t(75+i*199,y+57,l,29,C.muted)).join('');}
function svg(h,n,title,sub,content){return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${h}" viewBox="0 0 840 ${h}" role="img" aria-label="${esc(title)}"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#182738" stroke-width=".7"/></pattern>${['blue','cyan','amber','red'].map(k=>`<marker id="${k}" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="${C[k]}" stroke-width="1.5"/></marker>`).join('')}</defs><rect width="840" height="${h}" fill="${C.bg}"/><rect width="840" height="${h}" fill="url(#grid)"/><g font-family="PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif">${t(42,62,`FIG. ${n}`,25,C.blue,600)}${t(42,122,title,41,C.ink,600)}${t(42,171,sub,29,C.muted)}${content}${legend(h-103)}</g></svg>`;}
function stage(y,num,title,sub,kind,color){return rect(74,y,572,135,color)+icon(100,y+34,kind,color,.9)+t(185,y+53,title,37,C.ink,600)+t(185,y+101,sub,30,C.muted)+t(610,y+45,num,25,color,500,'end');}
const diagrams=[
{id:'01-task-delivery',width:840,height:1580,alt:'代码行为交付主链：Task验收、Plan、开发、独立Review、适用的独立Test、成员停稳、结算；Review或Test发现问题返回开发，再复核。',caption:'图 1｜代码行为修改的交付链。Review 先于适用的 Test；发现问题后返回修复，重新复核并执行适用测试。阶段切换和最终收口都要核对必要成员停稳。设计、文稿与纯展示工作不因此被要求执行 Test。',content:()=>svg(1580,'01','一次代码交付，怎样才闭合','主链向下推进；红线把缺陷送回开发',
stage(224,'01','Task · 目标与验收','先定义用户要拿到什么','doc',C.blue)+
stage(416,'02','Plan · 范围与依据','明确允许修改的边界','doc',C.blue)+
stage(608,'03','开发 · 实际成果','实现代码与开发自查','code',C.cyan)+
stage(800,'04','独立 Review','对照正式依据审查成果','check',C.amber)+
stage(992,'05','独立 Test · 适用','真实入口到用户结果','shield',C.amber)+
rect(74,1186,572,89,C.line)+icon(100,1208,'people',C.muted,.65)+t(185,1242,'必要成员已停稳',36)+
rect(74,1333,572,103,C.cyan)+icon(105,1359,'archive',C.cyan,.65)+t(185,1397,'结算 · 保存与接续',36)+
line('M360 359V411',C.blue)+line('M360 551V603',C.cyan)+line('M360 743V795',C.cyan)+line('M360 935V987',C.amber)+line('M360 1127V1181',C.amber)+line('M360 1275V1328',C.cyan)+
line('M646 865H748V676H652',C.red)+line('M646 1058H748V867',C.red,false,false)+t(746,598,'修复',32,C.red,600,'end')+t(746,638,'后重审',30,C.red,500,'end')+`<circle cx="748" cy="865" r="5" fill="${C.red}"/>`)
},
{id:'02-context-contract',width:840,height:1390,alt:'主管给出目标范围及Plan路径；开发者沿项目入口和模块地图读取权威模块规格与共享契约，把相关代码测试带入必要上下文；缺口继续补读，最终检查组合路径。',caption:'图 2｜主管给目标、范围与 Plan，开发者按需取得足够依据。模块规格完整描述用户能力，共享契约只在一个权威位置定义；遇到缺口继续补读。独立推进后，仍要验证最终组合。',content:()=>svg(1390,'02','上下文要够用，也要有出处','按需读取，不把整段历史交给每个角色',
rect(54,223,732,150,C.blue)+icon(80,264,'people',C.blue)+t(178,279,'主管给出任务入口',37,C.ink,600)+t(178,332,'目标 · 范围 · Plan 路径',32,C.muted)+
line('M420 373V441',C.blue)+t(440,423,'沿入口与模块地图',29,C.blue)+
rect(35,455,770,329,C.line,'#0b1928')+t(64,502,'权威依据 · 通过引用共享',30,C.blue)+
rect(61,534,341,219,C.blue)+icon(83,557,'doc',C.blue,.65)+t(84,664,'模块规格',37,C.ink,600)+t(84,715,'行为 / 异常 / 验收',28,C.muted)+
rect(438,534,341,219,C.blue)+icon(460,557,'shield',C.blue,.65)+t(461,664,'共享契约',37,C.ink,600)+t(461,715,'权限 / 接口 / 约束',28,C.muted)+
line('M230 784V840H420V881',C.blue)+line('M609 784V840H420',C.blue,false,false)+
rect(61,895,652,178,C.cyan)+icon(89,934,'code',C.cyan)+t(186,951,'开发者 · 必要上下文',36,C.ink,600)+t(186,1008,'相关代码 + 相关测试',32,C.muted)+
line('M713 977H778V813H707V784',C.blue,true)+t(741,864,'补读',28,C.blue,500,'end')+
line('M388 1073V1144',C.cyan)+rect(61,1157,718,105,C.amber)+icon(90,1181,'check',C.amber,.65)+t(178,1222,'最终组合 · 完整路径检查',35,C.ink,600))
},
{id:'03-independent-verification',width:840,height:1595,alt:'自证循环把实现当前输出用作测试期望。独立验证从已确认需求和权限事实得到预期集合，用好样本验证结果，再用混入越权订单的坏样本验证检查器因越权原因真实拒绝。局部Mock不等于端到端。',caption:'图 3｜测试期望不能从当前输出复制。假设案例中，预期集合由筛选与权限事实独立确定；故意混入越权订单，检查器必须因越权而拒绝。文件损坏或超时造成的失败，不证明它识别了权限问题。',content:()=>svg(1595,'03','检查，必须有机会推翻实现','订单导出是假设案例，不是产品实测',
rect(42,223,756,366,C.red,'#201a26')+t(68,273,'自证循环 · 同一个假设',35,C.red,600)+
rect(68,309,306,118,C.cyan)+icon(85,340,'code',C.cyan,.65)+t(158,379,'当前输出',35)+
rect(466,309,306,118,C.red)+icon(483,340,'doc',C.red,.65)+t(553,379,'测试期望',35)+
line('M374 367H461',C.red)+line('M620 427V479H221V432',C.red)+t(420,527,'彼此吻合 ≠ 符合用户要求',32,C.ink,500,'middle')+
rect(42,629,756,665,C.line)+t(68,679,'独立验证 · 先有预期，再查结果',34,C.amber,600)+
rect(68,719,704,119,C.blue)+icon(91,748,'doc',C.blue,.7)+t(187,770,'已确认验收 + 权限事实',34,C.ink,600)+t(187,813,'独立确定应导出的订单集合',29,C.muted)+
line('M420 838V882',C.blue)+line('M420 883H221V918',C.blue)+line('M420 883H620V918',C.blue)+
rect(68,930,306,130,C.cyan)+t(92,981,'好样本',36,C.cyan,600)+t(92,1030,'结果符合预期',30,C.muted)+
rect(466,930,306,130,C.red)+t(490,981,'坏样本',36,C.red,600)+t(490,1030,'故意混入越权单',29,C.muted)+
line('M221 1060V1116',C.cyan)+line('M620 1060V1116',C.red)+
rect(68,1128,306,123,C.amber)+t(92,1179,'检查通过',36,C.amber,600)+t(92,1221,'核对集合与内容',29,C.muted)+
rect(466,1128,306,123,C.amber)+t(490,1179,'检查拒绝',36,C.amber,600)+t(490,1221,'原因必须是越权',29,C.muted)+
rect(42,1333,756,128,C.line)+icon(68,1368,'code',C.muted,.65)+t(161,1381,'局部 Mock ≠ 整条路径正确',33,C.ink,600)+t(161,1429,'真实服务 → 浏览器 → 下载文件',29,C.muted))
},
{id:'04-facts-and-judgment',width:840,height:1530,alt:'程序核对身份、报告、成员停稳与保存，模型判断验收、范围和证据。审阅报告绑定代码交付版本，已审路径变化后旧报告不能证明当前，需重新Review及适用Test，未变化才可继续核对结算保存。',caption:'图 4｜程序守住事实，模型判断语义。图中 v1/v2 只是交付状态的说明标记，不是模型需要携带的工具参数。代码交付绑定代码路径，docs 与根 Markdown 属结算输出；文档交付仍绑定其文档。已审交付路径改变后须重审，并执行适用测试。',content:()=>svg(1530,'04','事实可核对，结论仍需判断','报告存在，不等于内容足以支持交付',
rect(42,223,360,360,C.blue)+icon(67,249,'check',C.blue,.8)+t(68,371,'程序核对事实',36,C.blue,600)+t(68,429,'身份 · 报告归属',30,C.muted)+t(68,482,'必要成员停稳',30,C.muted)+t(68,535,'文件与保存回执',30,C.muted)+
rect(438,223,360,360,C.amber)+icon(463,249,'people',C.amber,.8)+t(464,371,'模型判断语义',36,C.amber,600)+t(464,429,'验收是否满足',30,C.muted)+t(464,482,'范围是否合理',30,C.muted)+t(464,535,'证据是否充分',30,C.muted)+
line('M222 583V629H420V673',C.blue)+line('M618 583V629H420',C.amber,false,false)+
rect(68,685,704,152,C.amber)+icon(94,725,'file',C.amber,.8)+t(191,745,'交付 v1 ↔ 有效审阅报告',35,C.ink,600)+t(191,798,'程序记录已审路径与内容摘要',29,C.muted)+
line('M420 837V882',C.amber)+t(420,926,'已审交付路径有变化？',35,C.ink,600,'middle')+
line('M420 945V977H229V1015',C.cyan)+line('M420 977H617V1015',C.red)+t(91,1007,'没有变化',29,C.cyan)+t(485,1007,'有变化',29,C.red)+
rect(68,1027,322,135,C.cyan)+icon(90,1064,'archive',C.cyan,.65)+t(171,1083,'继续核对',34,C.ink,600)+t(171,1131,'结算与保存',29,C.muted)+
rect(450,1027,322,135,C.red)+icon(471,1064,'file',C.red,.65)+t(552,1083,'交付 v2',34,C.ink,600)+t(477,1131,'旧报告不证明当前',29,C.muted)+
line('M611 1162V1206',C.red)+rect(450,1218,322,146,C.amber)+t(477,1273,'重新 Review',34,C.amber,600)+t(477,1323,'再做适用 Test',30,C.muted)+
rect(68,1218,322,146,C.amber)+t(94,1273,'交付 v2',34,C.ink,600)+t(94,1323,'↔ 新有效报告',30,C.amber)+line('M450 1291H396',C.amber))
}
];
const edits=[
['《Lost in the Middle》（TACL 2024）','《[Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)》（TACL 2024）'],
['通过之后，再由独立的 Test 验证用户结果与相关回归；发现缺陷，返回修复，重新审核和测试，不能改了成果还借用旧报告。','Review 通过之后，适用的工作再由独立 Test 验证用户结果与相关回归；发现缺陷，返回修复，重新审核并执行适用测试。已审交付文件变化后，旧结论不再证明当前成果。'],
['所以我们让审阅结论绑定被审阅的交付物，交付物一变，旧结论就不再算数。','所以我们让审阅结论绑定被审阅的交付文件；这些文件变化后，旧结论就不再证明当前成果。代码交付绑定代码路径，`docs/**` 与根目录 Markdown 作为结算输出；文档交付仍绑定其文档。'],
['所以我们按影响选择验证强度：纯展示变化，独立 Review 后结算即可；局部行为变化，增加定向检查和一条聚焦的浏览器路径，由独立 Test 覆盖本次验收与相关回归；涉及共享契约、迁移、权限或状态机的高风险变化，才扩大到跨模块验证。导出功能涉及权限，就不能因为界面只多了一个按钮，算成轻量修改。','所以我们按影响选择验证强度：纯展示变化，在不改变事件、状态、请求、数据，也不触及公共布局或共享设计令牌的前提下，独立 Review 后结算即可；局部后端行为变化，增加定向单元和接口集成检查；页面交互变化，再加一条聚焦的真实浏览器路径。适用的独立 Test 覆盖本次验收与相关回归；涉及共享契约、迁移、权限、状态机或公共布局等高风险变化，才扩大到跨模块验证。导出功能涉及权限，就不能因为界面只多了一个按钮，算成轻量修改。'],
['【发布前请补充】关于开明：一两句话说明项目是什么、谁在做、读者怎么了解（文末引导）。','## 关于开明\n\n开明是一个持续推进软件项目的 AI 工作台，面向个人开发者和软件项目负责人。它围绕主管协作、待办与规格、任务交付和项目知识组织工作，目标是让成果经过适用的独立检查，并让下一次工作接得上。本文介绍其中的设计思路与已有验证边界。']
];
const FONT="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
const style={h1:'margin:0 0 13px;color:#101c2b;font-size:30px;line-height:1.42;font-weight:750;letter-spacing:0;',h2:'margin:0 0 22px;color:#10243a;font-size:26px;line-height:1.5;font-weight:750;',h3:'margin:32px 0 16px;color:#203b54;font-size:21px;line-height:1.55;font-weight:700;',p:'margin:0 0 21px;color:#283644;font-size:17px;line-height:1.9;overflow-wrap:anywhere;',ul:'margin:7px 0 26px;padding-left:1.35em;color:#283644;font-size:17px;line-height:1.9;',li:'margin:0 0 13px;padding-left:3px;',strong:'color:#152d43;font-weight:750;',a:'color:#21689d;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;',code:'padding:1px 4px;background:#edf2f6;color:#34546d;font-size:15px;font-family:ui-monospace,monospace;',fig:'margin:32px 0 38px;padding:0;',img:'display:block;width:100%;max-width:100%;height:auto;margin:0;',cap:'margin:12px 0 0;color:#617181;font-size:14px;line-height:1.8;text-align:left;',label:'margin:0 0 9px;color:#326c98;font-size:12px;line-height:1.6;letter-spacing:1.2px;font-weight:700;',section:'margin:46px 0 0;padding:24px 0 0;border-top:1px solid #cfdbe5;'};
function make(source,mode){const md=new MarkdownIt({html:false,linkify:false});const tokens=md.parse(source,{}), expected=[];for(const tok of tokens)if(tok.type==='inline')expected.push(md.renderer.renderInline(tok.children,md.options,{}).replace(/<[^>]+>/g,''));
 const groupStarts={'先问：最后要拿到什么':['01','交付标准，要先于实现'],'让需求能被独立读懂':['02','依据充分，才能独立推进'],'测试全绿，为什么仍然不够':['03','检查要能推翻实现'],'程序守住事实，模型承担判断':['04','把证据留在项目里']};
 let currentGroup=false;
 for(let i=0;i<tokens.length;i++){const tok=tokens[i];if(tok.type==='heading_open'&&tok.tag==='h2'){tok.tag='h3';tokens[i+2].tag='h3';const title=tokens[i+1].content;if(groupStarts[title]){const [n,name]=groupStarts[title];tok.meta={pre:(currentGroup?'</section>':'')+`<section style="${style.section}"><p style="${style.label}">${n} / ${name}</p><h2 style="${style.h2}">${name}</h2>`};currentGroup=true;}}}
 for(const name of ['heading_open','paragraph_open','strong_open','bullet_list_open','list_item_open','link_open'])md.renderer.rules[name]=(ts,i,o,e,self)=>{ts[i].attrSet('style',style[ts[i].tag]||'');return (ts[i].meta?.pre||'')+self.renderToken(ts,i,o);};
 md.renderer.rules.code_inline=(ts,i)=>`<code style="${style.code}">${esc(ts[i].content)}</code>`;
 md.renderer.rules.hr=()=>'';
 let html=md.renderer.render(tokens,md.options,{});
 html=html.replace('AI 说“完成了”，然后呢？从会写代码到可交付的 Agent</h1>','AI 说“完成了”，然后呢？</h1>'+`<p style="margin:0 0 28px;color:#5a7185;font-size:19px;line-height:1.65;">从会写代码到可交付的 Agent</p>`);
 html=html.replace(/<h1 /,`<p style="${style.label}">开明 · 工程实践</p><h1 `);
 function fig(i){const d=diagrams[i];return `<figure style="${style.fig}"><img src="${mode==='embedded'?'data:image/png;base64,'+d.png:'assets/'+d.id+'.png'}" width="${d.width*2}" height="${d.height*2}" alt="${esc(d.alt)}" style="${style.img}"><figcaption style="${style.cap}">${d.caption}</figcaption></figure>`;}
 for(const [anchor,i] of [['怎样让一次生成，成为可以核对、可以追溯、可以接续的交付？',0],['不能把各自“通过”相加，就当成整体通过。',1],['不能只留下一个通过数量。',2],['仍需要主管与独立 Agent 判断。',3]]){const pos=html.indexOf('</p>',html.indexOf(anchor));if(pos<0)throw Error('Missing figure anchor '+anchor);html=html.slice(0,pos+4)+fig(i)+html.slice(pos+4);}
 const assertion='我们把“执行结束”“检查通过”和“用户目标达成”，当成了同一件事。';html=html.replace(`<p style="${style.p}">这些场景背后有一个共同问题：`,`<p style="${style.p}padding:18px 20px;border-left:3px solid #377dae;background:#f0f5f9;">这些场景背后有一个共同问题：`);
 for(const [start,label,color,bg] of [['假设用户已确认：','案例中的验收','#326c98','#f2f6fa'],['我们也用同样的标准要求自己。','已有运行证据','#286e66','#f1f7f5'],['这只证明了相应程序路径','证据的边界','#93682b','#fbf7ef']])html=html.replace(`<p style="${style.p}">${start}`,`<p style="${style.p}padding:17px 20px;border-left:3px solid ${color};background:${bg};"><span style="display:block;margin:0 0 8px;color:${color};font-size:13px;font-weight:700;">${label}</span>${start}`);
 return {html:`<main style="box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;padding:0;font-family:${FONT};">${html}${currentGroup?'</section>':''}</main>`,expected};
}
async function build(){await fs.mkdir(ASSET,{recursive:true});await fs.mkdir(path.join(TASK,'screenshots'),{recursive:true});const original=await fs.readFile(path.join(ROOT,'articles/agent-delivery-system-wechat.md'),'utf8');let source=original;for(const [a,b]of edits){if(source.split(a).length!==2)throw Error('Edit not unique: '+a);source=source.replace(a,b);}const geometry=[];const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});try{for(const d of diagrams){await fs.writeFile(path.join(ASSET,d.id+'.svg'),d.content());const page=await browser.newPage({viewport:{width:d.width,height:d.height},deviceScaleFactor:2});await page.goto(pathToFileURL(path.join(ASSET,d.id+'.svg')).href);await page.evaluate(()=>document.fonts.ready);const outside=await page.locator('text').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,box:n.getBBox()})).filter(({box:b})=>b.x<10||b.x+b.width>830));if(outside.length)throw Error('SVG text outside canvas '+JSON.stringify(outside));geometry.push({id:d.id,viewBox:[840,d.height],png:[1680,d.height*2],textOutsideCanvas:outside});await page.locator('svg').screenshot({path:path.join(ASSET,d.id+'.png'),animations:'disabled'});await page.close();d.png=(await fs.readFile(path.join(ASSET,d.id+'.png'))).toString('base64');}
 const head='<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>AI 说“完成了”，然后呢？从会写代码到可交付的 Agent</title></head><body style="box-sizing:border-box;margin:0;padding:32px 16px 64px;background:#fff;">';const article=make(source,'embedded'),copy=make(source,'relative');await fs.writeFile(path.join(OUT,'index.html'),head+article.html+'</body></html>\n');await fs.writeFile(path.join(OUT,'wechat-copy.html'),head+copy.html+'</body></html>\n');
 const facts=[],page=await browser.newPage();for(const w of [375,390,768,1440]){await page.setViewportSize({width:w,height:920});await page.goto(pathToFileURL(path.join(OUT,'index.html')).href);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));const check=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflows:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5;}).map(e=>e.tagName),images:[...document.images].map(i=>({width:i.naturalWidth,height:i.naturalHeight,decoded:i.complete&&i.naturalWidth>0})),scriptCount:document.scripts.length,externalResources:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(s=>!s.startsWith('data:')),hrefs:[...document.querySelectorAll('a')].map(a=>a.getAttribute('href')),bodyText:document.querySelector('main').innerText,bodyFont:getComputedStyle(document.querySelector('h3+p')).fontSize,lineHeight:getComputedStyle(document.querySelector('h3+p')).lineHeight}));const sourceTokens=new MarkdownIt().parse(source,{});const strings=sourceTokens.filter(t=>t.type==='inline').map(t=>t.children.filter(c=>c.type==='text'||c.type==='code_inline').map(c=>c.content).join(''));const text=(check.bodyText).replace(/\s+/g,'');const missing=strings.filter(s=>s&&!text.includes(s.replace(/\s+/g,''))).filter(s=>!s.startsWith('AI 说“完成了”'));check.contentBlocks=strings.length;check.missing=missing;delete check.bodyText;check.exactPaperLink=check.hrefs.length===1&&check.hrefs[0]==='https://aclanthology.org/2024.tacl-1.9/';if(check.scrollWidth!==w||check.overflows.length||check.images.some(i=>!i.decoded)||check.scriptCount||check.externalResources.length||!check.exactPaperLink||missing.length)throw Error(JSON.stringify(check));facts.push(check);await page.screenshot({path:path.join(TASK,`screenshots/article-${w}-top.png`)});await page.screenshot({path:path.join(TASK,`screenshots/article-${w}-full.png`),fullPage:true});if(w===390){for(let i=0;i<4;i++)await page.locator('figure').nth(i).screenshot({path:path.join(TASK,`screenshots/article-390-figure-${i+1}.png`)});await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.screenshot({path:path.join(TASK,'screenshots/article-390-ending.png')});}}
 await page.goto(pathToFileURL(path.join(OUT,'wechat-copy.html')).href);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));facts.push({copyImages:await page.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.getAttribute('src'),decoded:i.complete&&i.naturalWidth>0}))),copyScripts:await page.locator('script').count()});await page.close();await fs.writeFile(path.join(TASK,'implementation-checks.json'),JSON.stringify({profile:'visual',scope:'static publication checks, not product Test or WeChat backend verification',geometry,facts,edits:edits.map(([before,after])=>({before,after}))},null,2)+'\n');
 execFileSync('python3',['-c',`import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
files=[root/'index.html',root/'wechat-copy.html',root/'README.md']+sorted((root/'assets').iterdir())
with zipfile.ZipFile(root/'agent-delivery-system-wechat-v2.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in files: z.write(f,f.relative_to(root))
    assert len(z.namelist())==11 and all(not n.endswith('.zip') for n in z.namelist())
`,OUT]);
 }finally{await browser.close();}}
build().catch(e=>{console.error(e);process.exitCode=1;});
