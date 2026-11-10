// Local integration harness. Requires an isolated SillyTavern at TEST_URL; never point at a real profile.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {writePng} from '../card.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=path.resolve('test-results');await fs.mkdir(root,{recursive:true});
const settingsPath=path.join(root,'data/default-user/settings.json');
const settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));settings.firstRun=false;await fs.writeFile(settingsPath,JSON.stringify(settings,null,2));
const entry=(id,comment,content,extra={})=>({id,keys:[comment],secondary_keys:[],comment,content,constant:false,selective:true,insertion_order:100,enabled:true,position:'before_char',extensions:{},...extra});
const base={spec:'chara_card_v2',spec_version:'2.0',data:{name:'星港档案 · 测试卡',description:'仅用于隔离测试',personality:'',scenario:'',first_mes:'旧开场白',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'Test',character_version:'1.0',extensions:{},character_book:{name:'test-old-world',entries:[entry(0,'港口','旧港口设定'),entry(1,'向导','年龄：20\n职业：向导'),entry(2,'商店','只在白天营业'),entry(3,'旧传闻','之后会删除'),entry(4,'保留条目','完全相同')]}}};
const next=structuredClone(base);next.data.first_mes='新开场白';next.data.alternate_greetings=['新的第二开场白'];next.data.character_version='2.0';next.data.character_book.entries[0].content='作者新版港口设定';next.data.character_book.entries[1].content='年龄：22\n职业：资深向导';next.data.character_book.entries.splice(3,1);next.data.character_book.entries.push(entry(7,'新地图','作者新增的地图'));
const seed=new Uint8Array(await fs.readFile(path.join(root,'SillyTavern/public/img/ai4.png')));
const baseFile=path.join(root,'old.png'),nextFile=path.join(root,'new.png');
await fs.writeFile(baseFile,writePng(seed,base));await fs.writeFile(nextFile,writePng(seed,next));
const browser=await chromium.launch({...process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'},headless:true,args:['--disable-gpu'],downloadsPath:root});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(moduleRoot=>{window.cumModuleRoot=moduleRoot;},process.env.TEST_EXTENSION_ROOT??'/scripts/extensions/third-party/card-update-manager/');
await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
try{
 await page.goto(process.env.TEST_URL??'http://127.0.0.1:18123/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#cum-open',{state:'attached',timeout:60000});
 const setup=await page.evaluate(async({base,base64})=>{
    const script=await import('/script.js'),wi=await import('/scripts/world-info.js');
    const headers=()=>script.getRequestHeaders();
    async function post(url,data){const r=await fetch('/api/'+url,{method:'POST',headers:headers(),body:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());return r;}
    const file=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'});
    const data=new FormData();data.append('avatar',file,'old.png');data.append('file_type','png');data.append('preserved_name','cum-test-card');
    const h=new Headers(headers());h.delete('Content-Type');const result=await(await fetch('/api/characters/import',{method:'POST',headers:h,body:data})).json();
    if(result.error)throw Error('import setup failed');
    const mine=wi.convertCharacterBook(structuredClone(base.data.character_book));
    mine.entries[1].content='年龄：25\n职业：向导';mine.entries[2].disable=true;
    mine.entries[10]={...structuredClone(mine.entries[0]),uid:10,key:['私有笔记'],comment:'私有笔记',content:'我的自定义条目'};
    await wi.saveWorldInfo('test-old-world',mine,true);await wi.updateWorldInfoList();
    await post('characters/merge-attributes',{avatar:'cum-test-card.png',chat:'existing-chat',fav:true,data:{extensions:{world:'test-old-world',fav:true}}});
    await post('chats/save',{avatar_url:'cum-test-card.png',ch_name:base.data.name,file_name:'existing-chat',chat:[{user_name:'User',character_name:base.data.name,chat_metadata:{}},{name:base.data.name,is_user:false,send_date:'2026-11-10',mes:'必须保留的历史聊天',extra:{}}]});
    const {connectHost}=await import(window.cumModuleRoot+'host.js');
    const {Storage}=await import(window.cumModuleRoot+'storage.js');
    const {Manager}=await import(window.cumModuleRoot+'ui.js');
    const host=await connectHost();const store=new Storage(host.account);await store.put('cum-test-card.png',{});
    window.cumTest={host,store,manager:new Manager(host,store)};
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    await window.cumTest.manager.open();return {cards:(await host.list()).length};
 },{base,base64:Buffer.from(await fs.readFile(baseFile)).toString('base64')});
 console.log('SETUP',setup);
 await page.getByRole('button',{name:/星港档案/}).click();
 const inputFile=async(buttonName,file,confirmName)=>{
    const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:buttonName,exact:true}).click();await(await chooser).setFiles(file);
    if(confirmName)await page.getByRole('button',{name:confirmName,exact:true}).click();
 };
 await inputFile('导入旧原版',baseFile,'建立基线');
 await inputFile('导入新版并比较',nextFile,'开始比较');
 assert.equal(await page.getByText('核对条目对应关系',{exact:true}).count(),0);
 await page.waitForSelector('.cum-entry');
 const types=await page.evaluate(()=>window.cumTest.manager.state.rows.map(r=>r.type));assert.ok(types.includes('both'));assert.ok(types.includes('mineAdded'));
 await page.locator('.cum-entry').filter({hasText:'向导'}).click();await page.getByRole('button',{name:'保留我的正文',exact:true}).click();
 await page.getByRole('button',{name:'编辑正文',exact:true}).click();
 await page.getByRole('textbox',{name:'编辑最终正文'}).fill('年龄：25\n职业：资深向导');
 await page.getByRole('button',{name:'保存正文',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'检查并覆盖更新'}).isEnabled(),true);
 await page.screenshot({path:path.join(root,'desktop-merge.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(root,'mobile-merge.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.querySelector('.cum-dialog').scrollWidth<=document.querySelector('.cum-dialog').clientWidth),true);
 await page.setViewportSize({width:1440,height:1000});
 // Stop reload only for assertions, while exercising the actual production transaction.
 await page.evaluate(()=>{window.cumTest.host.refresh=()=>{window.cumRefreshed=true;};});
 await page.getByRole('button',{name:'检查并覆盖更新'}).click();await page.getByRole('button',{name:'备份并覆盖更新',exact:true}).click();
 await page.waitForFunction(()=>window.cumRefreshed || document.querySelector('.cum-message.cum-error'),{},{timeout:30000});
 const result=await page.evaluate(async()=>{
    const {host,store}=window.cumTest,card=await host.getCard('cum-test-card.png'),snapshot=await host.snapshot('cum-test-card.png');
    const record=await store.get('cum-test-card.png');const backups=await store.backups('cum-test-card.png');
    const script=await import('/script.js');const chats=await(await fetch('/api/characters/chats',{method:'POST',headers:script.getRequestHeaders(),body:JSON.stringify({avatar_url:'cum-test-card.png'})})).json();
    return {message:document.querySelector('.cum-message').textContent,refreshed:!!window.cumRefreshed,card,entries:snapshot.world.entries,recordBaseline:record?.baseline,backups:backups.map(b=>({id:b.id,status:b.status})),chats};
 });
 await fs.writeFile(path.join(root,'integration-result.json'),JSON.stringify(result,null,2));
 assert.equal(result.refreshed,true,result.message);assert.equal(result.card.chat,'existing-chat');assert.equal(result.card.fav,true);assert.equal(result.card.data.first_mes,'新开场白');
 const entries=Object.values(result.entries);assert.equal(entries.find(e=>e.comment==='向导').content,'年龄：25\n职业：资深向导');assert.equal(entries.find(e=>e.comment==='商店').disable,false);assert.ok(entries.some(e=>e.comment==='新地图'));assert.ok(entries.some(e=>e.comment==='私有笔记'));assert.ok(!entries.some(e=>e.comment==='旧传闻'));
 assert.equal(result.recordBaseline.data.character_book.entries[1].content,'年龄：22\n职业：资深向导');assert.ok(JSON.stringify(result.chats).includes('existing-chat'));
 const secondCycle=await page.evaluate(async()=>{
    const {host,store}=window.cumTest;const core=await import(window.cumModuleRoot+'core.js');
    const snap=await host.snapshot('cum-test-card.png');const base=(await store.get('cum-test-card.png')).baseline;
    const b=core.entriesOf(core.normalizeCardWorld(base,host.convert));
    return core.buildRows(b,core.entriesOf(snap.world),b).map(r=>({name:r.title,type:r.type,fields:core.changedFields(r.base,r.mine)}));
 });
 assert.equal(secondCycle.some(r=>['both','author'].includes(r.type)),false,JSON.stringify(secondCycle));
 assert.equal(secondCycle.find(r=>r.name==='港口').type,'unchanged');
 assert.equal(secondCycle.find(r=>r.name==='商店').type,'unchanged');
 const restored=await page.evaluate(async()=>{const {host,store}=window.cumTest;const b=(await store.backups('cum-test-card.png')).find(b=>b.status==='complete');await host.restore(b);return host.getCard('cum-test-card.png');});
 assert.equal(restored.data.first_mes,'旧开场白');assert.equal(restored.data.extensions.world,'test-old-world');assert.equal(restored.chat,'existing-chat');assert.equal(restored.fav,true);
 await page.evaluate(async()=>{
    document.querySelectorAll('.cum-dialog').forEach(d=>d.close());
    const script=await import('/script.js');await script.getCharacters();script.setCharacterId(script.characters.findIndex(c=>c.avatar==='cum-test-card.png'));
    const select=document.querySelector('#char-management-dropdown');
    if(document.querySelector('#replace_update').nextElementSibling.id!=='cum-character-update')throw Error('Wrong contextual entry position');
    select.value='cum-character-update';select.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForSelector('.cum-dialog[open] .cum-character-name');
 assert.ok((await page.locator('.cum-dialog[open] .cum-character-name').textContent()).includes('cum-test-card.png'));
 console.log('PASS character menu: opens selected card directly');
 console.log('PASS: real ST import, world merge, backup, baseline advancement, chat/favourite retention, restore, desktop/mobile UI');
 console.log('PAGE_ERRORS',errors.filter(e=>e.includes('card-update-manager')));
}catch(error){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true});console.error('FAILED',error);console.error(await page.locator('.cum-message').textContent().catch(()=>''));throw error;}
finally{await browser.close();}
