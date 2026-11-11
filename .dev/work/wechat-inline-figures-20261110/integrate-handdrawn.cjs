// Integrates existing, inspected ImageGen PNGs. Never generates or edits pixels.
// --check is read-only for publication files; writes local check records/screenshots.
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=process.cwd();
const task=path.join(root,'.dev/work/wechat-inline-figures-20261110');
const out=path.join(root,'articles/publish/agent-delivery-system-wechat-v2');
const digest=b=>createHash('sha256').update(b).digest('hex');
const outsideFigures=h=>h.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/g,'');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const names=['01-complete-delivery-handdrawn','02-context-handdrawn','03-verification-handdrawn','04-evidence-handdrawn'];
const alt=[
 '多模块交付概览：需求整理明确目标异常与验收，架构设计明确模块接口切片并经审阅确认，选定切片制定实施计划，工程实现后独立审阅与适用测试，发现问题修复后重审，结算留下知识证据和下一步。',
 '沿项目入口与模块地图定位模块规格和共享契约，结合本次计划及相关代码测试开展开发；缺口补读，组合后仍需联调。',
 '同源自证把当前输出复制为测试期望。独立验证用验收与权限事实形成预期；正常文件和混入越权记录的文件都输入同一检查器，前者通过，后者因越权拒绝。',
 '程序核对身份报告与保存，模型判断验收范围与证据；已审成果v1变化为v2后旧结论失效，重新审阅并执行适用测试，取得新报告。'
];
const captions=[
 '图 1｜多模块开发从需求整理开始。设计成果经独立审阅、必要的用户确认与结算后，选定切片再制定实施计划。实现经过独立审阅和适用测试，最后留下知识与证据。已有依据可以复用，发现缺口再补设计。',
 '图 2｜主管给目标、范围与 Plan，开发者按需取得足够依据。模块规格完整描述用户能力，共享契约只在一个权威位置定义；遇到缺口继续补读。独立推进后，仍要验证最终组合。',
 '图 3｜测试期望不能从当前输出复制。假设案例中，预期集合由筛选与权限事实独立确定；故意混入越权订单，检查器必须因越权而拒绝。文件损坏或超时造成的失败，不证明它识别了权限问题。',
 '图 4｜程序核对事实，模型判断语义。已审交付文件变化后，旧结论不能证明新成果，须重审并执行适用测试。v1/v2 仅用于说明成果变化，不是工具参数。'
];
async function main(){
 const write=process.argv.includes('--write');
 if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check');
 const assets=await Promise.all(names.map(async name=>{const bytes=await fs.readFile(path.join(out,'assets',name+'.png'));return {name,bytes,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:digest(bytes)};}));
 if(assets.some(a=>a.width/a.height<1.7||a.width/a.height>2.3))throw Error('Unexpected aspect ratio');
 const updates=[];
 for(const file of ['index.html','wechat-copy.html']){
  const p=path.join(out,file),before=await fs.readFile(p,'utf8');
  let n=0;
  const after=before.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/g,()=>{
   const i=n++,a=assets[i];if(!a)throw Error('Too many figures');
   const src=file==='index.html'?'data:image/png;base64,'+a.bytes.toString('base64'):'assets/'+a.name+'.png';
   return `<figure style="margin:32px 0 38px;padding:0;"><img src="${src}" width="${a.width}" height="${a.height}" alt="${escape(alt[i])}" style="display:block;width:100%;max-width:540px;height:auto;margin:0 auto;"><figcaption style="margin:12px 0 0;color:#617181;font-size:14px;line-height:1.8;text-align:left;">${captions[i]}</figcaption></figure>`;
  });
  if(n!==4||outsideFigures(before)!==outsideFigures(after))throw Error('Nonfigure content changed');
  if(write)await fs.writeFile(p,after);
  else if(before!==after)throw Error('Published figures do not match manifest '+file);
  updates.push({file,nonfigureHTMLSha256:digest(outsideFigures(before)),figureCount:n});
 }
 const index=await fs.readFile(path.join(out,'index.html'),'utf8');
 const copy=await fs.readFile(path.join(out,'wechat-copy.html'),'utf8');
 if(index.replace(/src="[^"]*"/g,'src="IMAGE"')!==copy.replace(/src="[^"]*"/g,'src="IMAGE"'))throw Error('HTML variants diverge');
 const embedded=[...index.matchAll(/<img\b[^>]*src="data:image\/png;base64,([^"]+)"/g)];
 if(embedded.length!==4||embedded.some((m,i)=>!Buffer.from(m[1],'base64').equals(assets[i].bytes)))throw Error('Embedded PNG mismatch');
 const {chromium}=require(path.join(root,'kaiming/node_modules/@playwright/test'));
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const pages=[];
 const shots=path.join(task,'handdrawn-screenshots');await fs.mkdir(shots,{recursive:true});
 try{
  for(const width of [375,390,768,1440]){
   const p=await browser.newPage({viewport:{width,height:960},deviceScaleFactor:1});
   await p.goto(pathToFileURL(path.join(out,'index.html')).href);
   await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   await p.evaluate(()=>document.fonts.ready);
   const facts=await p.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector('main').getBoundingClientRect().width,scripts:document.scripts.length,external:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(s=>!s.startsWith('data:')),links:[...document.querySelectorAll('a')].map(a=>a.href),images:[...document.images].map(i=>{const r=i.getBoundingClientRect();return {width:r.width,height:r.height,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,decoded:i.complete&&i.naturalWidth>0,alt:i.alt};}),overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5;}).map(e=>e.tagName)}));
   if(facts.scrollWidth!==width||facts.scripts||facts.external.length||facts.overflow.length||facts.images.length!==4||facts.images.some(i=>!i.decoded||i.height>300)||facts.links.length!==1||facts.links[0]!=='https://aclanthology.org/2024.tacl-1.9/')throw Error('Layout/resource invariant failed '+JSON.stringify(facts));
   await p.screenshot({path:path.join(shots,`article-${width}-full.png`),fullPage:true});
   if(width===390||width===1440){for(let i=0;i<4;i++){
    await p.locator('figure').nth(i).screenshot({path:path.join(shots,`article-${width}-figure-${i+1}.png`)});
    await p.evaluate(i=>{const r=document.querySelectorAll('figure')[i].getBoundingClientRect();scrollTo(0,scrollY+r.top-180);},i);
    await p.screenshot({path:path.join(shots,`article-${width}-context-${i+1}.png`)});
   }}
   pages.push(facts);await p.close();
  }
  const p=await browser.newPage();await p.goto(pathToFileURL(path.join(out,'wechat-copy.html')).href);await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  const facts=await p.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.getAttribute('src'),decoded:i.complete&&i.naturalWidth>0})));
  if(facts.length!==4||facts.some((f,i)=>!f.decoded||f.src!=='assets/'+names[i]+'.png'))throw Error('Copy HTML image mismatch');await p.close();
 }finally{await browser.close();}
 const zipCode=`import pathlib,sys,zipfile,json
root=pathlib.Path(sys.argv[1]); mode=sys.argv[2]; names=json.loads(sys.argv[3])
files=['index.html','wechat-copy.html','README.md']+['assets/'+n+'.png' for n in names]
zpath=root/'agent-delivery-system-wechat-v2.zip'
if mode=='write':
    with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files:
            info=zipfile.ZipInfo(f,(2026,11,11,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o644<<16
            z.writestr(info,(root/f).read_bytes())
with zipfile.ZipFile(zpath) as z:
    assert set(z.namelist())==set(files)
    assert z.testzip() is None
    for f in files: assert z.read(f)==(root/f).read_bytes()
print(json.dumps({'members':len(files),'allBytesMatch':True}))`;
 const zip=JSON.parse(execFileSync('python3',['-c',zipCode,out,write?'write':'check',JSON.stringify(names)],{encoding:'utf8'}));
 const record={profile:'visual',imageMode:'built-in ImageGen; PNGs embedded unchanged',updates,assets:assets.map(({bytes,...a})=>a),pages,zip,limits:'Local Chrome only. No product Test/full suite or actual WeChat import/upload/phone preview.'};
 await fs.writeFile(path.join(task,'handdrawn-checks.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({assets:record.assets,pages:pages.map(p=>({width:p.viewport,images:p.images.map(({width,height})=>({width,height}))})),zip},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
