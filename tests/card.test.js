import test from 'node:test';
import assert from 'node:assert/strict';
import {readPng,writePng,base64ToBytes,parseJSON,validateCard} from '../card.js';
const png=base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=');
test('PNG 中文 V2 / V3 读写和替换旧元数据',()=>{
 const c={spec:'chara_card_v2',data:{name:'测试人物🌙',character_book:{entries:[]}}};
 const first=writePng(png,c);assert.deepEqual(readPng(first),c);
 c.spec='chara_card_v3';c.data.name='新版';const second=writePng(first,c);assert.deepEqual(readPng(second),c);
 c.spec='chara_card_v2';c.data.name='再次替换';assert.deepEqual(readPng(writePng(second,c)),c);
});
test('损坏图片、原型字段与无效角色卡拒绝',()=>{
 const bad=png.slice();bad[20]^=1;assert.throws(()=>readPng(bad),/校验/);
 assert.throws(()=>parseJSON('{"__proto__":{}}'),/不安全/);assert.throws(()=>validateCard({}),/V2/);
});
