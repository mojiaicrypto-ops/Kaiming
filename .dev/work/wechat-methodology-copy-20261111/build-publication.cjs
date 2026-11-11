// Pure copy revision. Reuses the accepted publication layout and PNGs unchanged.
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=process.cwd(),task=path.join(root,'.dev/work/wechat-methodology-copy-20261111'),out=path.join(root,'articles/publish/agent-delivery-system-wechat-v2');
const MarkdownIt=require(path.join(root,'kaiming/node_modules/markdown-it'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const names=['01-complete-delivery-handdrawn','02-context-handdrawn','03-verification-handdrawn','04-evidence-handdrawn'];
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const normalize=s=>s.replace(/\s+/g,'');
async function main(){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check');
 const source=await fs.readFile(path.join(out,'article.md'),'utf8');
 const template=execFileSync('git',['show','e4c2142:articles/publish/agent-delivery-system-wechat-v2/wechat-copy.html'],{encoding:'utf8'});
 const imageManifest=JSON.parse(await fs.readFile(path.join(root,'.dev/work/wechat-inline-figures-20261110/imagegen/provenance.json'),'utf8')).records;
 const assets=await Promise.all(names.map(async(name,i)=>{const bytes=await fs.readFile(path.join(out,'assets',name+'.png'));if(digest(bytes)!==imageManifest[i].sha256)throw Error('Accepted illustration changed '+name);return {name,bytes,sha256:digest(bytes)};}));
 const figures=[...template.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>/g)].map(m=>m[0]);if(figures.length!==4)throw Error('Four accepted figures required');
 const styleFor=tag=>{const m=template.match(new RegExp('<'+tag+'\\b[^>]*style="([^"]*)"'));if(!m)throw Error('Missing accepted style '+tag);return m[1];};
 const styles=Object.fromEntries(['main','h1','h2','h3','p','section','ul','li','strong','a','code'].map(t=>[t,styleFor(t)]));
 styles.p=[...template.matchAll(/<p style="([^"]*)"/g)].map(m=>m[1]).find(s=>s.includes('font-size:17px')&&!s.includes('border-left'));
 const label=styleFor('p');
 const groups={'先问：最后要拿到什么':['01','交付标准，要先于实现'],'让需求能被独立读懂':['02','依据充分，才能独立推进'],'测试全绿，为什么仍然不够':['03','检查要能推翻实现'],'程序守住事实，模型承担判断':['04','把证据留在项目里']};
 const md=new MarkdownIt({html:false,linkify:false});
 for(const name of ['heading_open','paragraph_open','strong_open','em_open','bullet_list_open','ordered_list_open','list_item_open','link_open'])md.renderer.rules[name]=(ts,i,o,e,self)=>{const s=styles[ts[i].tag];if(s)ts[i].attrSet('style',s);return self.renderToken(ts,i,o);};
 md.renderer.rules.code_inline=(ts,i)=>`<code style="${styles.code}">${esc(ts[i].content)}</code>`;
 const chunks=source.trim().split(/^## /m);if(chunks.length!==9)throw Error('Keep eight substantive sections');
 const title=chunks[0].match(/^# (.+)$/m)?.[1];if(title!=='AI 说“完成了”，然后呢？从会写代码到可交付的 Agent')throw Error('Unexpected title');
 const headingTokens=md.parse(chunks[0],{});
 let intro=md.renderer.render(headingTokens,md.options,{}).replace('AI 说“完成了”，然后呢？从会写代码到可交付的 Agent</h1>','AI 说“完成了”，然后呢？</h1><p style="margin:0 0 28px;color:#5a7185;font-size:19px;line-height:1.65;">从会写代码到可交付的 Agent</p>');
 intro=intro.replace(`<p style="${styles.p}">“执行结束”`,`<p style="${styles.p}padding:18px 20px;border-left:3px solid #377dae;background:#f0f5f9;">“执行结束”`);
 const render=mode=>{
  const fig=i=>mode==='relative'?figures[i]:figures[i].replace(/src="[^"]*"/,()=>`src="data:image/png;base64,${assets[i].bytes.toString('base64')}"`);
  let html=`<p style="${label}">工程实践</p>`+intro+fig(0),open=false;
  for(let i=1;i<chunks.length;i++){
   const [name,...body]=chunks[i].split('\n');const group=groups[name];
   if(group){if(open)html+='</section>';html+=`<section style="${styles.section}"><p style="${label}">${group[0]} / ${group[1]}</p><h2 style="${styles.h2}">${group[1]}</h2>`;open=true;}
   let bodyHTML=md.render(body.join('\n'));
   if(name==='测试全绿，为什么仍然不够'){
    const at=bodyHTML.indexOf('负向控制'),end=bodyHTML.indexOf('</p>',at);if(at<0||end<0)throw Error('Missing negative-control explanation');bodyHTML=bodyHTML.slice(0,end+4)+fig(2)+bodyHTML.slice(end+4);
   }
   html+=`<h3 style="${styles.h3}">${esc(name)}</h3>`+bodyHTML;
   if(name==='让需求能被独立读懂')html+=fig(1);
   if(name==='程序守住事实，模型承担判断')html+=fig(3);
  }
  if(open)html+='</section>';
  // Preserve the accepted acceptance-callout style; only its wording changes.
  html=html.replace(`<p style="${styles.p}">假设要给业务系统增加`, `<p style="${styles.p}padding:17px 20px;border-left:3px solid #326c98;background:#f2f6fa;"><span style="display:block;margin:0 0 8px;color:#326c98;font-size:13px;font-weight:700;">案例中的验收</span>假设要给业务系统增加`);
  return template.slice(0,template.indexOf('<main'))+`<main style="${styles.main}">${html}</main></body></html>\n`;
 };
 const publication={ 'index.html':render('embedded'),'wechat-copy.html':render('relative') };
 for(const [name,html] of Object.entries(publication)){if(write)await fs.writeFile(path.join(out,name),html);else if(await fs.readFile(path.join(out,name),'utf8')!==html)throw Error('Publication differs from article source '+name);}
 if(publication['index.html'].replace(/src="[^"]*"/g,'src="IMG"')!==publication['wechat-copy.html'].replace(/src="[^"]*"/g,'src="IMG"'))throw Error('HTML variants diverge');
 const sourceBlocks=md.parse(source,{}).filter(t=>t.type==='inline').map(t=>t.children.filter(c=>c.type==='text'||c.type==='code_inline').map(c=>c.content).join('')).filter(Boolean);
 const {chromium}=require(path.join(root,'kaiming/node_modules/@playwright/test'));
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const pages=[];await fs.mkdir(path.join(task,'screenshots'),{recursive:true});
 try{for(const width of [375,390,768,1440]){
  const p=await browser.newPage({viewport:{width,height:960},deviceScaleFactor:1});await p.goto(pathToFileURL(path.join(out,'index.html')).href);await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await p.evaluate(()=>document.fonts.ready);
  const facts=await p.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.querySelector('main').innerText,scripts:document.scripts.length,resources:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(s=>!s.startsWith('data:')),links:[...document.querySelectorAll('a')].map(a=>a.href),images:[...document.images].map(i=>{const r=i.getBoundingClientRect();return {src:i.getAttribute('src').startsWith('data:')?'embedded':i.getAttribute('src'),width:r.width,height:r.height,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,decoded:i.complete&&i.naturalWidth>0};}),overflows:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5;}).map(e=>e.tagName)}));
  const missing=sourceBlocks.filter(s=>!normalize(facts.text).includes(normalize(s)));if(missing.length)throw Error('Source text missing '+JSON.stringify(missing));
  if(/开明|关于开明|已有运行证据|2026 年 11 月 9 日/.test(facts.text))throw Error('Project promotion remains');
  if(facts.scrollWidth!==width||facts.overflows.length||facts.scripts||facts.resources.length||facts.images.length!==4||facts.images.some(i=>!i.decoded)||facts.links.length!==1||facts.links[0]!=='https://aclanthology.org/2024.tacl-1.9/')throw Error('Static publication condition failed');
  delete facts.text;facts.sourceBlocks=sourceBlocks.length;facts.missingSourceBlocks=0;
  if(width===390||width===1440){await p.screenshot({path:path.join(task,`screenshots/article-${width}-top.png`)});await p.screenshot({path:path.join(task,`screenshots/article-${width}-full.png`),fullPage:true});for(let i=0;i<4;i++){await p.evaluate(i=>{const r=document.querySelectorAll('figure')[i].getBoundingClientRect();scrollTo(0,scrollY+r.top-180);},i);await p.screenshot({path:path.join(task,`screenshots/article-${width}-context-${i+1}.png`)});}await p.evaluate(()=>scrollTo(0,document.body.scrollHeight));await p.screenshot({path:path.join(task,`screenshots/article-${width}-ending.png`)});}
  pages.push(facts);await p.close();
 }
 const p=await browser.newPage();await p.goto(pathToFileURL(path.join(out,'wechat-copy.html')).href);await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));const copyFacts=await p.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.getAttribute('src'),decoded:i.complete&&i.naturalWidth>0})));if(copyFacts.some((a,i)=>!a.decoded||a.src!=='assets/'+names[i]+'.png'))throw Error('Relative image mismatch');await p.close();
 }finally{await browser.close();}
 const zipCode=`import pathlib,sys,zipfile,json
root=pathlib.Path(sys.argv[1]); write=sys.argv[2]=='write'; names=json.loads(sys.argv[3])
files=['index.html','wechat-copy.html','README.md','article.md']+['assets/'+n+'.png' for n in names]
if write:
    with zipfile.ZipFile(root/'agent-delivery-system-wechat-v2.zip','w',zipfile.ZIP_DEFLATED) as z:
        for f in files:
            info=zipfile.ZipInfo(f,(2026,11,11,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,(root/f).read_bytes())
with zipfile.ZipFile(root/'agent-delivery-system-wechat-v2.zip') as z:
    assert len(z.namelist())==8 and set(z.namelist())==set(files) and z.testzip() is None
    for f in files: assert z.read(f)==(root/f).read_bytes()
print(json.dumps({'members':8,'allBytesMatch':True}))`;
 const zip=JSON.parse(execFileSync('python3',['-c',zipCode,out,write?'write':'check',JSON.stringify(names)],{encoding:'utf8'}));
 const record={profile:'visual',source:'article.md',sourceSha256:digest(source),acceptedLayoutCommit:'e4c2142',figuresUnchanged:true,assets:assets.map(({bytes,...a})=>a),pages,zip,limits:'Local static Chrome only. No product Test/full suite or actual WeChat preview/publication.'};
 await fs.writeFile(path.join(task,'checks.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({sourceBlocks:sourceBlocks.length,pages:pages.map(p=>({width:p.viewport,missing:p.missingSourceBlocks,images:p.images.map(i=>[i.width,i.height])})),zip},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
