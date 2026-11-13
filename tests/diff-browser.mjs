import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=path.resolve('test-results/diff-v0.1.10');await fs.mkdir(root,{recursive:true});
const demo=await Promise.all(['01-author-original','02-player-modified','03-author-update'].map(async n=>JSON.parse(await fs.readFile('../../03_results/card-update-manager/demo-cards-v2/'+n+'.json','utf8'))));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [width,height]of [[1440,1100],[390,844]])for(const dark of [true,false]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18124/',{waitUntil:'domcontentloaded'});await page.waitForSelector('#cum-open',{state:'attached'});
  await page.evaluate(async({demo,dark})=>{
   const root='/scripts/extensions/third-party/sillytavern-card-update-manager/';
   const {Manager}=await import(root+'ui.js'),core=await import(root+'core.js'),wi=await import('/scripts/world-info.js');
   const style=document.documentElement.style;
   for(const [key,val]of Object.entries({SmartThemeBlurTintColor:dark?'#191c20':'#f5f6f8',SmartThemeChatTintColor:dark?'#191c20':'#ffffff',SmartThemeBodyColor:dark?'#d8d9da':'#25292e',SmartThemeBorderColor:dark?'#343940':'#d8dde3',SmartThemeQuoteColor:dark?'#a2b9d1':'#41627f'}))style.setProperty('--'+key,val);
   const card={name:'星港 · 差异显示验证',avatar:'diff-ui-only.png'};
   const m=new Manager({list:async()=>[card]},{get:async()=>({}),put:async()=>{}});await m.open(card);
   const arrays=demo.map(c=>core.entriesOf(core.normalizeCardWorld(c,wi.convertCharacterBook)));
   m.state.rows=core.buildRows(...arrays);m.state.filter='all';m.state.selected=m.state.rows.findIndex(r=>r.title.startsWith('34 '));m.state.mobilePane='detail';
   window.manager=m;window.originalRows=JSON.stringify(m.state.rows);m.renderMerge();
  },{demo,dark});
  await page.waitForTimeout(250);
  const left=page.locator('.cum-text-mine .cum-paper'),right=page.locator('.cum-text-author .cum-paper');
  assert.ok(await left.getByRole('button',{name:'··· 相同段落 ···',exact:true}).count()>0);
  assert.ok(await left.locator('.is-changed').count()>0);assert.ok(await right.locator('.is-changed').count()>0);
  const checkAlign=async()=>{
   if(width<761)return;
   const offsets=await page.evaluate(()=>[...document.querySelectorAll('.cum-diff-view .cum-paper')].map(p=>[...p.children].map(c=>c.getBoundingClientRect().top-p.getBoundingClientRect().top+p.scrollTop)));
   assert.equal(offsets[0].length,offsets[1].length);offsets[0].forEach((y,i)=>assert.ok(Math.abs(y-offsets[1][i])<2,`alignment ${i}: ${y} / ${offsets[1][i]}`));
  };
  await checkAlign();
  await left.getByRole('button',{name:'··· 相同段落 ···',exact:true}).first().click();await page.waitForTimeout(300);
  assert.equal(await left.getByRole('button',{name:'收起相同段落',exact:true}).count(),1);assert.equal(await right.getByRole('button',{name:'收起相同段落',exact:true}).count(),1);await checkAlign();
  await page.getByRole('button',{name:'全部展开相同段落',exact:true}).click();await page.waitForTimeout(250);
  assert.equal(await page.getByRole('button',{name:'··· 相同段落 ···',exact:true}).count(),0);await checkAlign();
  await page.getByRole('button',{name:'完整正文',exact:true}).click();await page.waitForTimeout(250);
  assert.equal(await page.locator('.cum-diff-view del,.cum-diff-removed').count(),0);
  if(width>=761){
   for(const [source,target] of [[left,right],[right,left]]){
    const top=await source.evaluate(e=>{e.scrollTop+=160;return e.scrollTop;});
    assert.ok(top>0);
    await target.evaluate((e,top)=>new Promise((resolve,reject)=>{
     const deadline=performance.now()+1000;
     function check(){if(Math.abs(e.scrollTop-top)<=1)resolve();else if(performance.now()>deadline)reject(new Error('双栏滚动位置不一致'));else requestAnimationFrame(check);}
     check();
    }),top);
   }
  }
  const highlight=await left.locator('.cum-diff-added').first().evaluate(e=>({word:getComputedStyle(e).backgroundColor,block:getComputedStyle(e.closest('.cum-diff-block')).backgroundColor,color:getComputedStyle(e).color}));assert.notEqual(highlight.word,highlight.block);assert.notEqual(highlight.word,'rgba(0, 0, 0, 0)');
  const text=async p=>p.evaluate(e=>{const c=e.cloneNode(true);c.querySelectorAll('del,.cum-diff-placeholder,button').forEach(x=>x.remove());return [...c.querySelectorAll('.cum-diff-text')].map(x=>x.textContent).join('');});
  assert.equal(await text(left),demo[1].data.character_book.entries.find(e=>e.comment.startsWith('34 ')).content);
  assert.equal(await text(right),demo[2].data.character_book.entries.find(e=>e.comment.startsWith('34 ')).content);
  await page.getByRole('slider',{name:'对比字号'}).fill('16');await page.waitForTimeout(250);await checkAlign();
  await page.getByRole('slider',{name:'对比字号'}).fill('12');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.manager.state.rows)===window.originalRows),true);
  // A fresh view resets individually expanded sections, keeping the selected display mode.
  await page.getByRole('button',{name:'差异聚焦',exact:true}).click();
  await page.evaluate(()=>window.manager.drawDetail());await page.waitForTimeout(150);
  await page.locator('.cum-detail').evaluate(e=>{e.scrollTop=0;});
  await page.screenshot({path:path.join(root,`${dark?'dark':'light'}-${width}.png`)});
  for(const [prefix,side]of [['02 ','next'],['03 ','mine'],['06 ','both']]){
   await page.evaluate(prefix=>{const m=window.manager;m.selectEntry(m.state.rows.findIndex(r=>r.title.startsWith(prefix)));},prefix);await page.waitForTimeout(250);
   const counts=[await left.locator('.is-changed').count(),await right.locator('.is-changed').count()];
   if(side==='mine'){assert.ok(counts[0]>0);assert.equal(counts[1],0);}else if(side==='next'){assert.equal(counts[0],0);assert.ok(counts[1]>0);}else assert.ok(counts.every(n=>n>0));
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${dark?'dark':'light'} ${width}: folding, alignment, full text, unchanged choices, all modification states`);
  await page.close();
 }
}finally{await browser.close();}
