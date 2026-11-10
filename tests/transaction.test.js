import test from 'node:test';
import assert from 'node:assert/strict';
import {applyUpdate} from '../host.js';
function fixture(fail){
 const snapshot={avatar:'Old.png',card:{chat:'chat1',data:{name:'Old',extensions:{world:'old'}}},worldName:'old',world:{entries:{}}};
 const card={data:{name:'New',extensions:{world:'new'}}};const calls=[];
 const store={get:async()=>({baseline:'old'}),backup:async x=>({...x,id:'1'}),saveBackup:async b=>calls.push(b.status),put:async(_k,r)=>calls.push(r.baseline)};
 const host={ensureIdle(){},snapshot:async()=>snapshot,saveWorld:async()=>calls.push('world'),importPng:async()=>{calls.push('import');if(fail==='import')throw Error('network');},preserveLocal:async()=>{},getCard:async()=>({chat:'chat1',data:fail==='verify'?{}:card.data}),restore:async()=>calls.push('restore')};
 return {host,store,snapshot,card,world:{entries:{}},worldName:'new',png:new Blob(),baseline:'new',calls};
}
test('成功时备份在覆盖前完成，完成后才升级作者基线',async()=>{const f=fixture();await applyUpdate(f);assert.deepEqual(f.calls,['world','writing','import','complete','new']);});
test('导入失败或校验失败恢复旧卡与基线',async()=>{for(const reason of ['import','verify']){const f=fixture(reason);await assert.rejects(applyUpdate(f),/已恢复旧卡/);assert.ok(f.calls.includes('restore'));assert.ok(!f.calls.includes('new'));}});
test('比较期间修改过数据时禁止覆盖',async()=>{const f=fixture();f.host.snapshot=async()=>({...f.snapshot,worldName:'changed'});await assert.rejects(applyUpdate(f),/发生了修改/);assert.deepEqual(f.calls,[]);});
test('恢复也失败时记录需恢复状态',async()=>{const f=fixture('verify');f.host.restore=async()=>{throw Error('offline');};await assert.rejects(applyUpdate(f),/自动恢复未完成/);assert.ok(f.calls.includes('recovery-needed'));});

test('同名写回后校验接受自身写入；失败恢复世界书',async()=>{
 for(const fail of [false,true]){
  const f=fixture();f.worldName='old';f.card.data.extensions.world='old';f.world={entries:{0:{uid:0,content:'merged'}}};
  let current=structuredClone(f.snapshot),writes=0;
  f.host.snapshot=async()=>structuredClone(current);
  f.host.saveWorld=async(name,world)=>{writes++;current.world=structuredClone(world);if(fail&&writes===1)throw Error('write verification');};
  if(fail){await assert.rejects(applyUpdate(f),/已恢复旧世界书/);assert.deepEqual(current.world,f.snapshot.world);assert.equal(writes,2);}
  else{await applyUpdate(f);assert.equal(writes,1);assert.ok(f.calls.includes('complete'));}
 }
});
