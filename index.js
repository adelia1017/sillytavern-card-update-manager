import {connectHost} from './host.js';
import {Storage} from './storage.js';
import {Manager} from './ui.js';

let manager;
async function open(card){
    try{
        if(!manager){const host=await connectHost();manager=new Manager(host,new Storage(host.account));}
        await manager.open(card?.avatar?card:undefined);
    }catch(error){console.error('[Card Update Manager]',error);globalThis.toastr?.error(error.message,'角色卡更新管理器');}
}
function install(){
    if(document.getElementById('cum-open'))return;
    const target=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
    if(!target){setTimeout(install,1000);return;}
    const block=document.createElement('div');block.id='cum-launcher';block.className='inline-drawer';
    const header=document.createElement('div');header.className='inline-drawer-toggle inline-drawer-header';
    const title=document.createElement('b');title.textContent='角色卡更新管理器';
    const icon=document.createElement('div');icon.className='inline-drawer-icon fa-solid fa-circle-chevron-down down';header.append(title,icon);
    const content=document.createElement('div');content.className='inline-drawer-content';
    const button=document.createElement('button');button.id='cum-open';button.className='menu_button';button.type='button';button.textContent='打开更新管理器';button.addEventListener('click',()=>open());content.append(button);block.append(header,content);target.append(block);
    const replace=document.querySelector('#replace_update');
    if(replace){
        const option=document.createElement('option');option.id='cum-character-update';option.value='cum-character-update';option.textContent='对比并更新';replace.after(option);
        replace.parentElement.addEventListener('change',async e=>{
            if(e.target.value!=='cum-character-update')return;
            e.stopImmediatePropagation();e.target.value='default';
            try{const script=await import('/script.js');const card=script.characters[script.this_chid];if(!card?.avatar)throw Error('请先选择角色卡');await open({name:card.name,avatar:card.avatar});}
            catch(error){globalThis.toastr?.error(error.message);}
        },true);
    }
    const menu=document.querySelector('#extensionsMenu');
    if(menu){const entry=document.createElement('div');entry.className='list-group-item flex-container flexGap5';entry.tabIndex=0;entry.role='button';entry.textContent='角色卡更新管理器';entry.addEventListener('click',open);entry.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}});menu.append(entry);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
