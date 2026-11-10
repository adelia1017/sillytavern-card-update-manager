// UI regression against an isolated ST page. Synthetic in-memory cards; no writes to the host.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=path.resolve('test-results/mobile-v0.1.3');await fs.mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const widths=[[320,568],[360,640],[390,844],[430,932],[844,390],[1440,1000]];
try{
 for(const [width,height]of widths){
  const context=await browser.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000,deviceScaleFactor:1});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(process.env.TEST_URL??'http://127.0.0.1:18124/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#cum-open',{state:'attached'});
  await page.addStyleTag({content:'.menu_button {width:22px!important;word-break:break-all!important} #extensions_settings2 button {writing-mode:vertical-rl;max-width:30px}'});
  const launcher=await page.locator('#cum-open').evaluate(e=>{const s=getComputedStyle(e);return {writing:s.writingMode,width:s.width,display:s.display};});
  assert.equal(launcher.writing,'horizontal-tb');
  if(width===320){
   await page.locator('#extensions-settings-button .drawer-toggle').click();
   await page.locator('#cum-launcher > .inline-drawer-header').click();await page.locator('#cum-open').scrollIntoViewIfNeeded();
   const box=await page.locator('#cum-open').boundingBox();
   assert.ok(box.width>160&&box.height<100,'Launcher must be a full-width horizontal row');
   const container=await page.locator('#cum-launcher').boundingBox();assert.ok(container.height<220,'Compact native drawer');
   await page.locator('#cum-launcher').screenshot({path:path.join(root,'launcher.png')});
  }
  await page.evaluate(async()=>{
   const root='/scripts/extensions/third-party/sillytavern-card-update-manager/';
   const {Manager}=await import(root+'ui.js'),{buildRows}=await import(root+'core.js');
   const card={name:'星港档案 · 手机长文本测试',avatar:'ui-test.png'};
   const host={list:async()=>[card]},store={get:async()=>({}),put:async()=>{}};
   const manager=new Manager(host,store);await manager.open();await manager.selectCard(card);
   const e=(i,content)=>({uid:i,comment:`条目 ${i}`,content,key:['关键词'+i],disable:false});
   const base=Array.from({length:80},(_,i)=>e(i,`旧设定 ${i}`));
   base[0].comment='向导设定';base[0].content='年龄：20\n职业：向导\n旧原版末行';
   const mine=structuredClone(base),next=structuredClone(base);
   mine[0].content='年龄：25\n职业：向导\n我的修改末行';next[0].content='年龄：22\n职业：资深向导\n作者新版末行';
   mine[1].disable=true;next[2].content='作者新增正文';
   next[3].content='长正文开头\n'+Array.from({length:100},(_,i)=>`第 ${i+1} 段：这是手机端应该可以正常滚动阅读的长世界书正文。`).join('\n')+'\n长正文末尾';
   mine.splice(4,1);next.splice(5,1);
   manager.state.rows=buildRows(base,mine,next);manager.state.filter='all';manager.state.selected=0;manager.state.mobilePane='list';
   manager.renderMerge();window.testManager=manager;
  });
  const mobile=width<=760||height<=500&&width<=1000;
  if(mobile){assert.equal(await page.locator('.cum-detail').isVisible(),false);assert.equal(await page.locator('.cum-entry-list').isVisible(),true);}
  await page.locator('.cum-entry').filter({hasText:'向导设定'}).click();
  if(mobile){assert.equal(await page.locator('.cum-entry-list').isVisible(),false);assert.equal(await page.locator('.cum-detail').isVisible(),true);}
  const visible=async locator=>{await locator.scrollIntoViewIfNeeded();assert.equal(await locator.isVisible(),true);const box=await locator.boundingBox();assert.ok(box&&box.width>0&&box.y+box.height>0&&box.y<height);};
  const minePanel=page.locator('.cum-text-panel.cum-text-mine'),authorPanel=page.locator('.cum-text-panel.cum-text-author');
  const contents=async panel=>panel.locator('.cum-paper').evaluate(e=>{const c=e.cloneNode(true);c.querySelectorAll('del').forEach(n=>n.remove());return c.textContent;});
  assert.equal(await contents(minePanel),'年龄：25\n职业：向导\n我的修改末行');
  assert.equal(await contents(authorPanel),'年龄：22\n职业：资深向导\n作者新版末行');
  assert.equal(await minePanel.locator('ins').first().evaluate(e=>getComputedStyle(e).color),'rgb(21, 21, 21)');
  assert.equal(await authorPanel.locator('ins').first().evaluate(e=>getComputedStyle(e).color),'rgb(21, 21, 21)');
  assert.equal(await minePanel.locator('.cum-highlight').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(204, 228, 255)');
  assert.equal(await minePanel.locator('.cum-paper').evaluate(e=>getComputedStyle(e).fontSize),'12px');
  await page.getByRole('slider',{name:'对比字号'}).fill('14');
  assert.equal(await minePanel.locator('.cum-paper').evaluate(e=>getComputedStyle(e).fontSize),'14px');
  await page.getByRole('slider',{name:'对比字号'}).fill('12');
  assert.ok((await authorPanel.boundingBox()).y>(await minePanel.boundingBox()).y);
  assert.equal(await minePanel.locator('del').first().evaluate(e=>getComputedStyle(e).textDecorationLine),'line-through');
  await visible(minePanel.locator('.cum-paper'));
  const footer=page.getByRole('button',{name:'检查并覆盖更新'});const fb=await footer.boundingBox();assert.ok(fb&&fb.y>=0&&fb.y+fb.height<=height+1,'Footer must remain in viewport');
  assert.equal(await page.evaluate(()=>document.querySelector('.cum-dialog').scrollWidth<=document.querySelector('.cum-dialog').clientWidth+1),true);
  await page.screenshot({path:path.join(root,`detail-${width}x${height}.png`)});
  await page.getByRole('button',{name:'保留我的正文',exact:true}).click();
  await page.getByText('合并结果预览',{exact:true}).click();
  await visible(page.locator('.cum-result-content').filter({hasText:'我的修改末行'}));
  if(mobile)await page.getByRole('button',{name:'条目列表',exact:true}).click();
  await page.locator('.cum-entry strong').filter({hasText:/^条目 1$/}).click();
  assert.equal(await authorPanel.locator('ins,del').count(),0);
  assert.equal(await minePanel.locator('ins,del').count(),0);
  assert.equal(await authorPanel.locator('.cum-text-same').evaluate(e=>getComputedStyle(e).color),'rgb(21, 21, 21)');
  assert.equal(await page.evaluate(()=>window.testManager.state.rows.find(r=>r.title==='条目 1').type),'unchanged');
  if(mobile)await page.getByRole('button',{name:'条目列表',exact:true}).click();
  await page.locator('.cum-entry strong').filter({hasText:/^条目 3$/}).click();
  // Touch-like scroll through long content, without nested pre scroll containers.
  await page.locator('.cum-detail').evaluate(e=>{e.scrollTop=e.scrollHeight;});
  const bottom=await page.locator('.cum-detail').evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2);assert.ok(bottom);
  assert.ok(await authorPanel.locator('.cum-paper').textContent().then(t=>t.includes('长正文末尾')));
  assert.equal(await authorPanel.locator('.cum-paper').evaluate(e=>e.clientHeight>=e.scrollHeight),true);
  if(mobile)await page.getByRole('button',{name:'条目列表',exact:true}).click();
  await page.locator('.cum-entry strong').filter({hasText:/^条目 5$/}).click();
  await visible(authorPanel.locator('del').filter({hasText:'旧设定 5'}));
  assert.deepEqual(errors.filter(e=>e.includes('card-update-manager')),[]);
  console.log(`PASS ${width}x${height}: list/detail navigation, stacked text/colors, result, settings ignored, deletion, long text, visible footer`);
  await context.close();
 }
}finally{await browser.close();}
