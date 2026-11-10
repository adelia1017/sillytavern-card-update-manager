import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRows,matchEntries,assembleWorld,selectedEntry,cleanEntry,toCharacterBook,normalizeCardWorld,lineDiff,textDiff} from '../core.js';
const entry=(comment,content,extra={})=>({uid:0,comment,content,key:[comment],disable:false,order:100,extensions:{},...extra});
test('三方分类和默认选择：作者、玩家、双方、相同改动',()=>{
 const base=[entry('a','old'),entry('b','old'),entry('c','old'),entry('d','old')];
 const mine=[entry('a','old'),entry('b','mine'),entry('c','mine'),entry('d','same')];
 const next=[entry('a','new'),entry('b','old'),entry('c','new'),entry('d','same')];
 const rows=buildRows(base,mine,next);
 assert.deepEqual(rows.map(r=>[r.type,r.choice]),[['author','next'],['mine','mine'],['both',null],['same','next']]);
 assert.throws(()=>assembleWorld(rows,{entries:{}}),/未处理/);
});
test('新条目、删除冲突和玩家主动删除不会丢失',()=>{
 const b=[entry('a','old'),entry('b','old'),entry('c','old')],m=[entry('a','changed'),entry('c','old'),entry('mine','x')],n=[entry('b','old'),entry('new','y')];
 const rows=buildRows(b,m,n);
 assert.deepEqual(rows.map(r=>r.type),['both','mineDeleted','authorDeleted','mineAdded','authorAdded']);
 assert.equal(rows[0].choice,null);
 rows[0].choice='mine';
 assert.deepEqual(Object.values(assembleWorld(rows,{entries:{}}).entries).map(e=>e.comment).sort(),['a','mine','new']);
});
test('作者重排 ID 时按身份对应，不按旧 ID 覆盖另一条',()=>{
 const b=[entry('a','x',{uid:0}),entry('b','y',{uid:1})],n=[entry('b','y!',{uid:0}),entry('a','x!',{uid:1})];
 assert.deepEqual(matchEntries(b,n),[1,0]);
 assert.deepEqual(matchEntries([entry('a','old')],[entry('unrelated','new')]),[-1]);
});
test('重复对应被拒绝，重复名称不盲目配对',()=>{
 const b=[entry('same','one',{key:[]}),entry('same','two',{key:[]})],n=[entry('same','three',{key:[]}),entry('same','four',{key:[]})];
 assert.deepEqual(matchEntries(b,n),[-1,-1]);
 assert.throws(()=>buildRows(b,n,n,{mine:[0,0],next:[0,1]}),/不能同时对应/);
});
test('开关、蓝绿灯、关键词和顺序不计入差异，文本选择沿用新版配置',()=>{
 const b=entry('a','old'),m=entry('a','old',{disable:true,constant:true,key:['mine'],order:999}),n=entry('a','old',{constant:false,key:['new']});
 const row=buildRows([b],[m],[n])[0];assert.equal(row.type,'unchanged');
 row.mine.content='my text';row.choice='mine';
 const merged=selectedEntry(row);assert.equal(merged.content,'my text');assert.equal(merged.disable,false);assert.deepEqual(merged.key,['new']);
 row.choice='custom';row.custom={...m,content:'custom'};assert.equal(selectedEntry(row).constant,false);
});
test('忽略 UID 和显示序号，扩展未知字段保留',()=>{
 assert.deepEqual(cleanEntry(entry('a','x',{uid:1,displayIndex:1})),cleanEntry(entry('a','x',{uid:99,displayIndex:99})));
 const world={entries:{1:entry('a','x',{uid:1,extensions:{foreign:{a:1}},cardExtra:{case_sensitive:true},futureFlag:7})}};
 const book=toCharacterBook(world,{name:'book',scan_depth:9});
 assert.equal(book.scan_depth,9);assert.equal(book.entries[0].case_sensitive,true);assert.equal(book.entries[0].extensions.foreign.a,1);
 assert.equal(book.entries[0].extensions.card_update_manager_native.futureFlag,7);
});
test('重复卡内 ID 拒绝',()=>assert.throws(()=>normalizeCardWorld({data:{character_book:{entries:[{id:1},{id:1}]}}},()=>{}),/重复/));
test('有界逐行差异',()=>{
 assert.deepEqual(lineDiff('a\nb','a\nc').map(x=>x.kind),['same','add','remove']);
 assert.equal(lineDiff('a\n'.repeat(600),'b\n'.repeat(600)).length,2);
});
test('合并保留作者新版 UID，仅对个人新增冲突 ID 分配新编号',()=>{
 const b=[entry('a','old',{uid:0})],m=[entry('a','mine',{uid:0}),entry('private','note',{uid:8})],n=[entry('a','new',{uid:8})];
 const rows=buildRows(b,m,n);rows[0].choice='mine';
 const world=assembleWorld(rows,{entries:{8:n[0]}});
 assert.equal(world.entries[8].content,'mine');assert.equal(world.entries[9].comment,'private');
 assert.equal(toCharacterBook(world).entries[0].id,8);
});
test('危险或异常条目 ID 拒绝',()=>assert.throws(()=>normalizeCardWorld({data:{character_book:{entries:[{id:'__proto__'}]}}},()=>{}),/安全整数/));
test('内联差异保留原文和换行；不变文本无着色段',()=>{
 for(const [a,b]of [['ABC\nDEF','ABC\nDEG\n123'],['年龄20','年龄25'],['','新条目'],['删除',''],['中文🌙\r\n末尾\n','中文🌟\r\n结尾\n'],['一'.repeat(2000),'二'.repeat(2000)]]){
  const parts=textDiff(a,b);assert.equal(parts.filter(p=>p.kind!=='add').map(p=>p.text).join(''),a);assert.equal(parts.filter(p=>p.kind!=='remove').map(p=>p.text).join(''),b);
 }
 const same='一样\n'.repeat(5000);assert.deepEqual(textDiff(same,same),[{kind:'same',text:same}]);
 assert.deepEqual(textDiff('ABC DEF','ABC DEG'),[{kind:'same',text:'ABC DE'},{kind:'remove',text:'F'},{kind:'add',text:'G'}]);
});
