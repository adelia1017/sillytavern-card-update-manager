const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
export function bytesToBase64(bytes) {
    let text=''; for(let i=0;i<bytes.length;i+=16384) text+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(text);
}
export function base64ToBytes(text) { return Uint8Array.from(atob(text),c=>c.charCodeAt(0)); }
export function parseJSON(text) {
    return JSON.parse(text,(key,value)=>{
        if(['__proto__','prototype','constructor'].includes(key)) throw Error('文件包含不安全的对象字段');
        return value;
    });
}
export function validateCard(card) {
    if (!card || !['chara_card_v2','chara_card_v3'].includes(card.spec) || !card.data || typeof card.data.name !== 'string') {
        throw Error('请导入 V2 或 V3 格式的 PNG / JSON 角色卡');
    }
    const entries=card.data.character_book?.entries;
    if (!Array.isArray(entries)) throw Error('这张卡没有内嵌世界书，首版暂不支持独立世界书导入');
    if (entries.length>10000) throw Error('世界书超过 10000 条，暂不支持');
    for(const e of entries) if (!e || typeof e.content!=='string' || !Array.isArray(e.keys)) throw Error('世界书条目缺少正文或关键词数组');
    return card;
}
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes) { let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0; }
function chunksOf(bytes) {
    if(!signature.every((n,i)=>bytes[i]===n)) throw Error('无效的 PNG 文件');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), chunks=[];
    let pos=8, ended=false;
    while(pos+12<=bytes.length) {
        const size=view.getUint32(pos);
        if(size>bytes.length-pos-12)throw Error('PNG 数据块被截断');
        const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
        if(crc32(bytes.subarray(pos+4,pos+8+size))!==view.getUint32(pos+8+size))throw Error('PNG 校验失败，文件可能已损坏');
        chunks.push({type,data:bytes.slice(pos+8,pos+8+size),raw:bytes.slice(pos,pos+12+size)});
        pos+=12+size;
        if(type==='IEND'){ended=true;break;}
    }
    if(!ended || chunks[0]?.type!=='IHDR')throw Error('PNG 缺少必要的数据块');
    return chunks;
}
function keyword(chunk) { const i=chunk.data.indexOf(0);return i<0?'':new TextDecoder().decode(chunk.data.subarray(0,i)).toLowerCase(); }
export function readPng(bytes) {
    const chunks=chunksOf(bytes), texts=chunks.filter(c=>c.type==='tEXt');
    const chunk=texts.find(c=>keyword(c)==='ccv3')??texts.find(c=>keyword(c)==='chara');
    if(!chunk)throw Error('PNG 没有角色卡数据，请使用原图文件');
    const text=new TextDecoder().decode(chunk.data.subarray(chunk.data.indexOf(0)+1));
    return parseJSON(decoder.decode(base64ToBytes(text)));
}
function makeChunk(type,data) {
    const bytes=new Uint8Array(data.length+12), view=new DataView(bytes.buffer);
    view.setUint32(0,data.length);bytes.set(encoder.encode(type),4);bytes.set(data,8);
    view.setUint32(bytes.length-4,crc32(bytes.subarray(4,bytes.length-4)));return bytes;
}
export function writePng(bytes,card) {
    const chunks=chunksOf(bytes), out=[signature];
    const text=bytesToBase64(encoder.encode(JSON.stringify(card)));
    for(const chunk of chunks) {
        if(['tEXt','iTXt','zTXt'].includes(chunk.type) && ['chara','ccv3'].includes(keyword(chunk)))continue;
        if(chunk.type==='IEND') {
            out.push(makeChunk('tEXt',encoder.encode('chara\0'+text)));
            if(card.spec==='chara_card_v3')out.push(makeChunk('tEXt',encoder.encode('ccv3\0'+text)));
        }
        out.push(chunk.raw);
    }
    const result=new Uint8Array(out.reduce((n,b)=>n+b.length,0));let pos=0;
    for(const part of out){result.set(part,pos);pos+=part.length;}return result;
}
export async function readCardFile(file) {
    if(file.size>64*1024*1024)throw Error('文件超过 64 MB，请使用较小的 PNG / JSON 卡');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const png=signature.every((n,i)=>bytes[i]===n);
    const card=validateCard(png?readPng(bytes):parseJSON(decoder.decode(bytes)));
    return {card,png:png?new Blob([bytes],{type:'image/png'}):null,filename:file.name};
}
export async function packCard(card,png) {
    if(!png)throw Error('缺少用于封装角色卡的 PNG 图像');
    return new Blob([writePng(new Uint8Array(await png.arrayBuffer()),card)],{type:'image/png'});
}
export function download(blob,name) {
    const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
}
