// Presentation only: no entry classification, choices, saved records or merge operations.
import {sameContent,sentenceDiff,textDiff} from './core.js';

function sentenceEdits(before,after,position=0){
    return sentenceDiff(before,after).flatMap(part=>{
        if(part.kind==='same'){position+=part.text.length;return [];}
        const start=position;position+=part.old.length;
        return [{start,end:position,text:part.next}];
    });
}

function sections(text){
    const parts=[];
    let offset=0, previousBlank=false;
    for(const line of text.match(/[^\n]*\n|[^\n]+$/g)??[]){
        const trimmed=line.trim();
        const heading=trimmed.match(/^(?:[^\s:：。！？]{1,24}\s*[:：]|<\/?[^<>]+>)$/)?.[0]
            ?.replace(/[\s:：]+$/g,'');
        if(!parts.length||heading||(previousBlank&&trimmed))parts.push({offset,heading,text:''});
        parts.at(-1).text+=line;
        offset+=line.length;
        previousBlank=!trimmed;
    }
    for(const part of parts){
        part.normalized=part.text.replace(/\s+/g,'');
        part.grams=new Set();
        for(let i=0;i<part.normalized.length-1;i++)part.grams.add(part.normalized.slice(i,i+2));
    }
    return parts;
}

function sectionScore(a,b){
    if(a.heading!==b.heading&&(a.heading||b.heading))return 0;
    if(a.normalized===b.normalized)return 6;
    if(a.heading)return 5;
    if(Math.min(a.normalized.length,b.normalized.length)<8)return 0;
    let shared=0;
    for(const gram of a.grams)if(b.grams.has(gram))shared++;
    const similarity=2*shared/(a.grams.size+b.grams.size);
    return similarity>=0.48?similarity:0;
}

function edits(before,after){
    if(before===after)return [];
    const a=sections(before),b=sections(after);
    if(a.length<=1&&b.length<=1&&!a[0]?.heading&&!b[0]?.heading)return sentenceEdits(before,after);
    const changes=[];
    // Align whole sections first. Repeated bullets or blank lines are weak anchors across headings.
    const bounded=a.length*b.length<=40000;
    const scores=bounded?a.map(x=>Float32Array.from(b,y=>sectionScore(x,y))):[];
    const best=bounded?Array.from({length:a.length+1},()=>new Float32Array(b.length+1)):[];
    if(bounded){
        for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--){
            const score=scores[i][j];
            best[i][j]=Math.max(best[i+1][j],best[i][j+1],score?score+best[i+1][j+1]:0);
        }
    }
    let i=0,j=0;
    while(i<a.length||j<b.length){
        const score=scores[i]?.[j];
        if(score&&Math.abs(best[i][j]-score-best[i+1][j+1])<0.0001){
            changes.push(...sentenceEdits(a[i].text,b[j].text,a[i].offset));i++;j++;
        }else if(i<a.length&&(j===b.length||!bounded||best[i+1][j]>=best[i][j+1])){
            changes.push({start:a[i].offset,end:a[i].offset+a[i].text.length,text:''});i++;
        }else{
            const start=a[i]?.offset??before.length;
            changes.push({start,end:start,text:b[j].text});j++;
        }
    }
    return changes;
}
export function displayBlocks(base,mine,next,twoWay=false){
    const original=twoWay?(mine??''):(base??'');
    const left=twoWay?[]:edits(original,mine??''),right=edits(original,next??'');
    const intervals=[...left.map(edit=>({...edit,side:'mine'})),...right.map(edit=>({...edit,side:'next'}))]
        .sort((a,b)=>a.start-b.start||a.end-b.end);
    const groups=[];
    for(const edit of intervals){
        const last=groups.at(-1);
        if(last&&(edit.start<last.end||(last.start===last.end&&edit.start===edit.end&&last.start===edit.start))){
            last.end=Math.max(last.end,edit.end);
            last[edit.side].push(edit);
        }else{
            const group={start:edit.start,end:edit.end,mine:[],next:[]};
            group[edit.side].push(edit);groups.push(group);
        }
    }
    const slice=(changes,start,end)=>{
        let at=start,text='';
        for(const e of changes){
            text+=original.slice(at,e.start)+e.text;at=e.end;
        }
        return text+original.slice(at,end);
    };
    const blocks=[];let at=0;
    const same=text=>{if(text)blocks.push({kind:'same',base:text,mine:text,next:text});};
    for(const g of groups){
        same(original.slice(at,g.start));
        const old=original.slice(g.start,g.end);
        blocks.push({kind:'change',base:old,mine:slice(g.mine,g.start,g.end),next:slice(g.next,g.start,g.end)});
        at=g.end;
    }
    same(original.slice(at));
    if(!blocks.length)blocks.push({kind:'same',base:'',mine:'',next:''});
    return blocks;
}

function node(tag,className,text){const e=document.createElement(tag);e.className=className;if(text!==undefined)e.textContent=text;return e;}
function button(text,action){const e=node('button','',text);e.type='button';e.addEventListener('click',action);return e;}
export function createComparison(row,{twoWay=false}={}){
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
    function jumpTo(index,side){
        const target=pairs[index]?.[1-side];
        if(!target)return;
        element.querySelector('.cum-diff-target')?.classList.remove('cum-diff-target');
        target.classList.add('cum-diff-target');
        if(mobile.matches)target.scrollIntoView({block:'center'});
        else{
            const paper=papers[1-side];
            paper.scrollTop+=target.getBoundingClientRect().top-paper.getBoundingClientRect().top-12;
        }
    }
    for(const [side,label]of [['mine',twoWay?'当前版本':'我的版本'],['next','作者新版']]){
        const panel=node('section','cum-text-panel cum-text-'+(side==='mine'?'mine':'author'));panel.setAttribute('aria-label',label);
        panel.append(node('h4','',label));
        const paper=node('div','cum-paper');paper.tabIndex=0;paper.role='region';paper.setAttribute('aria-label',label+'正文，可滚动');
        panel.append(paper);element.append(panel);papers.push(paper);
        observer.observe(paper);
    }
    const foldable=block=>block.kind==='same'&&(block.base.length>180||block.base.split('\n').length>5);
    const expand=button('全部展开相同段落',()=>{blocks.forEach((b,i)=>{if(foldable(b))expanded.add(i);});render();});
    controls.append(expand);
    if(!twoWay&&row.base&&['both','same'].includes(row.type)){
        const original=node('details','cum-original');
        original.append(node('summary','','原文'));
        const paper=node('pre','cum-original-text',row.base.content);
        paper.tabIndex=0;paper.setAttribute('aria-label','作者旧版原文');
        original.append(paper);
        element.insertBefore(original,element.lastElementChild);
    }
    function render(){
        observer.disconnect();papers.forEach(p=>{p.replaceChildren();observer.observe(p);});pairs.length=0;
        expand.disabled=!blocks.some((b,i)=>foldable(b)&&!expanded.has(i));
        blocks.forEach((block,index)=>{
            const pair=[];
            for(let sideIndex=0;sideIndex<2;sideIndex++){
                const side=sideIndex===0?'mine':'next';
                const wrapper=node('div','cum-diff-row');wrapper.dataset.block=String(index);
                const content=node('div','cum-diff-block');
                wrapper.append(content);pair.push(wrapper);
                if(foldable(block)&&!expanded.has(index)){
                    const toggle=button('··· 相同段落 ···',()=>{expanded.add(index);render();});
                    toggle.className='cum-same-toggle';toggle.setAttribute('aria-expanded','false');content.append(toggle);
                }else{
                    const value=block[side],changed=block.kind==='change'&&(twoWay?!sameContent(block.mine,block.next):!sameContent(value,block.base));
                    if(changed){
                        content.classList.add('is-changed');
                        content.tabIndex=0;
                        content.setAttribute('role','button');
                        content.setAttribute('aria-label','跳到另一栏的对应段落');
                        content.addEventListener('click',()=>{if(!getSelection()?.toString())jumpTo(index,sideIndex);});
                        content.addEventListener('keydown',event=>{
                            if(event.key==='Enter'||event.key===' '){event.preventDefault();jumpTo(index,sideIndex);}
                        });
                    }
                    const text=node('div','cum-diff-text');
                    if(!value&&!block.base){text.append(node('span','cum-diff-placeholder',block.kind==='same'?'（空正文）':'此处无新增内容'));}
                    else if(!changed){text.append(node('span','cum-text-same',value));}
                    else if(twoWay){
                        for(const part of textDiff(block.mine,block.next)){
                            if(part.kind===(side==='mine'?'add':'remove'))continue;
                            text.append(node('span',part.kind==='same'||sameContent(part.text,'')?'cum-text-same':'cum-diff-added',part.text));
                        }
                        if(!text.textContent)text.append(node('span','cum-diff-placeholder','此处无内容'));
                    }else{
                        for(const part of textDiff(block.base,value)){
                            if(part.kind==='remove')continue;
                            text.append(node(part.kind==='add'?'ins':'span',part.kind==='add'&&!sameContent(part.text,'')?'cum-diff-added':'cum-text-same',part.text));
                        }
                    }
                    content.append(text);
                    if(foldable(block)){
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
