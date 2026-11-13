// Presentation only: no entry classification, choices, saved records or merge operations.
import {sentenceDiff,textDiff} from './core.js';

function edits(before,after){
    let position=0;
    return sentenceDiff(before,after).flatMap(part=>{
        if(part.kind==='same'){position+=part.text.length;return [];}
        const start=position;position+=part.old.length;
        return [{start,end:position,text:part.next}];
    });
}
export function displayBlocks(base,mine,next,twoWay=false){
    const original=twoWay?(mine??''):(base??'');
    const left=twoWay?[]:edits(original,mine??''),right=edits(original,next??'');
    const intervals=[...left,...right].sort((a,b)=>a.start-b.start||a.end-b.end);
    const groups=[];
    for(const edit of intervals){
        const last=groups.at(-1);
        if(last&&edit.start<=last.end)last.end=Math.max(last.end,edit.end);
        else groups.push({start:edit.start,end:edit.end});
    }
    const slice=(changes,start,end)=>{
        let at=start,text='';
        for(const e of changes.filter(e=>e.start>=start&&e.end<=end)){
            text+=original.slice(at,e.start)+e.text;at=e.end;
        }
        return text+original.slice(at,end);
    };
    const blocks=[];let at=0;
    const same=text=>{if(text)blocks.push({kind:'same',base:text,mine:text,next:text});};
    for(const g of groups){
        same(original.slice(at,g.start));
        const old=original.slice(g.start,g.end);
        blocks.push({kind:'change',base:old,mine:slice(left,g.start,g.end),next:slice(right,g.start,g.end)});
        at=g.end;
    }
    same(original.slice(at));
    if(!blocks.length)blocks.push({kind:'same',base:'',mine:'',next:''});
    return blocks;
}

function node(tag,className,text){const e=document.createElement(tag);e.className=className;if(text!==undefined)e.textContent=text;return e;}
function button(text,action){const e=node('button','',text);e.type='button';e.addEventListener('click',action);return e;}
export function createComparison(row,{twoWay=false,mode='focus',onMode=()=>{}}={}){
    const blocks=displayBlocks(row.base?.content,row.mine?.content,row.next?.content,twoWay);
    const expanded=new Set();
    const element=node('div','cum-comparison cum-diff-view');
    const controls=node('div','cum-diff-controls');controls.setAttribute('aria-label','正文显示方式');
    let frame=0,disposed=false;
    const papers=[],pairs=[];
    const mobile=matchMedia('(max-width:760px), (max-height:500px) and (max-width:1000px)');
    const align=()=>{
        cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
            if(disposed||!element.isConnected)return;
            // Read natural content heights before writing either side's shared row height.
            const heights=pairs.map(pair=>mobile.matches?0:Math.max(...pair.map(e=>e.firstElementChild.getBoundingClientRect().height)));
            pairs.forEach((pair,i)=>pair.forEach(e=>{e.style.minHeight=heights[i]?Math.ceil(heights[i])+'px':'';}));
        });
    };
    const observer=new ResizeObserver(align);
    for(const [side,label]of [['mine',twoWay?'当前版本':'我的版本'],['next','作者新版']]){
        const panel=node('section','cum-text-panel cum-text-'+(side==='mine'?'mine':'author'));panel.setAttribute('aria-label',label);
        panel.append(node('h4','',label));
        const paper=node('div','cum-paper');paper.tabIndex=0;paper.role='region';paper.setAttribute('aria-label',label+'正文，可滚动');
        panel.append(paper);element.append(panel);papers.push(paper);
        observer.observe(paper);
    }
    const foldable=block=>block.kind==='same'&&(block.base.length>180||block.base.split('\n').length>5);
    const focus=button('差异聚焦',()=>{mode='focus';onMode(mode);render();});
    const full=button('完整正文',()=>{mode='full';onMode(mode);render();});
    const expand=button('全部展开相同段落',()=>{blocks.forEach((b,i)=>{if(foldable(b))expanded.add(i);});render();});
    controls.append(focus,full,expand);
    function render(){
        observer.disconnect();papers.forEach(p=>{p.replaceChildren();observer.observe(p);});pairs.length=0;
        focus.setAttribute('aria-pressed',String(mode==='focus'));full.setAttribute('aria-pressed',String(mode==='full'));
        expand.disabled=mode==='full'||!blocks.some((b,i)=>foldable(b)&&!expanded.has(i));
        blocks.forEach((block,index)=>{
            const pair=[];
            for(let sideIndex=0;sideIndex<2;sideIndex++){
                const side=sideIndex===0?'mine':'next';
                const wrapper=node('div','cum-diff-row');wrapper.dataset.block=String(index);
                const content=node('div','cum-diff-block');
                wrapper.append(content);pair.push(wrapper);
                if(mode==='focus'&&foldable(block)&&!expanded.has(index)){
                    const toggle=button('··· 相同段落 ···',()=>{expanded.add(index);render();});
                    toggle.className='cum-same-toggle';toggle.setAttribute('aria-expanded','false');content.append(toggle);
                }else{
                    const value=block[side],changed=block.kind==='change'&&(twoWay?block.mine!==block.next:value!==block.base);
                    if(changed)content.classList.add('is-changed');
                    const text=node('div','cum-diff-text');
                    if(!value&&!block.base){text.append(node('span','cum-diff-placeholder',block.kind==='same'?'（空正文）':'此处无新增内容'));}
                    else if(!changed){text.append(node('span','cum-text-same',value));}
                    else if(twoWay){
                        for(const part of textDiff(block.mine,block.next)){
                            if(part.kind===(side==='mine'?'add':'remove'))continue;
                            text.append(node('span',part.kind==='same'?'cum-text-same':'cum-diff-added',part.text));
                        }
                        if(!text.textContent)text.append(node('span','cum-diff-placeholder','此处无内容'));
                    }else{
                        for(const part of textDiff(block.base,value)){
                            if(part.kind==='remove')continue;
                            text.append(node(part.kind==='add'?'ins':'span',part.kind==='add'?'cum-diff-added':'cum-text-same',part.text));
                        }
                    }
                    content.append(text);
                    if(mode==='focus'&&foldable(block)){
                        const toggle=button('收起相同段落',()=>{expanded.delete(index);render();});toggle.className='cum-same-toggle';toggle.setAttribute('aria-expanded','true');content.append(toggle);
                    }
                }
                papers[sideIndex].append(wrapper);observer.observe(content);
            }
            pairs.push(pair);
        });
        align();
    }
    mobile.addEventListener('change',align);
    render();
    return {element,controls,destroy(){disposed=true;observer.disconnect();cancelAnimationFrame(frame);mobile.removeEventListener('change',align);}};
}
