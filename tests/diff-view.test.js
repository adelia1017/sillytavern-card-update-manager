import test from 'node:test';
import assert from 'node:assert/strict';
import {displayBlocks} from '../diff-view.js';

test('显示区块按旧原文对齐，完整保留三方正文',()=>{
 const examples=[
  ['开头。年龄20岁。中间。喜欢茶。结尾。','开头。年龄25岁。中间。喜欢茶。结尾。','开头。年龄22岁。中间。喜欢咖啡。结尾。'],
  ['甲。乙。丙。','甲。补充。乙。丙。','甲。乙。丙。'],
  ['甲。乙。丙。','甲。丙。','甲。改写乙。丙。'],
  ['', '我的新增。','作者新增。'],['原文。',undefined,undefined],
  ['原文。','共同结果。','共同结果。'],
  ['A\nB\nC\n','A\n新增\nB\nC\n','A\nB\nC\n末尾'],
  ['🌙\r\n尾行\n','🌟\r\n尾行\n','🌙\r\n新尾行\n'],
 ];
 for(const [base,mine,next]of examples){
  const blocks=displayBlocks(base,mine,next);
  for(const [key,text]of Object.entries({base,mine,next}))assert.equal(blocks.map(b=>b[key]).join(''),text??'');
  const dual=displayBlocks(undefined,mine,next,true);
  assert.equal(dual.map(b=>b.mine).join(''),mine??'');assert.equal(dual.map(b=>b.next).join(''),next??'');
 }
});
test('相邻、重叠与同位置插入在两侧一致分组',()=>{
 const blocks=displayBlocks('一。二。三。四。','一。个人二。三。四。','一。作者二和三。四。');
 assert.equal(blocks.filter(b=>b.kind==='change').length,1);
 assert.equal(blocks[1].mine,'个人二。三。');
 const same=displayBlocks('旧句。','新句。','新句。')[0];
 assert.equal(same.kind,'change');assert.notEqual(same.base,same.mine);assert.notEqual(same.base,same.next);
});
test('随机文本编辑的显示分块不会遗漏、重复或修改原文',()=>{
 let seed=7;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 for(let i=0;i<100;i++){
  const base=Array.from({length:12},(_,j)=>`${j}原文。`).join('');
  const edit=()=>base.split('。').map(t=>random()<.2?'':random()<.3?t+'新增🌙。':t+'。').join('');
  const mine=edit(),next=edit(),blocks=displayBlocks(base,mine,next);
  assert.equal(blocks.map(b=>b.base).join(''),base);assert.equal(blocks.map(b=>b.mine).join(''),mine);assert.equal(blocks.map(b=>b.next).join(''),next);
 }
});
