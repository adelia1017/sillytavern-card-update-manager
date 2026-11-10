import {connectHost} from './host.js';
import {Storage} from './storage.js';
import {Manager} from './ui.js';

let manager;
async function open(){
    try{
        if(!manager){const host=await connectHost();manager=new Manager(host,new Storage(host.account));}
        await manager.open();
    }catch(error){console.error('[Card Update Manager]',error);globalThis.toastr?.error(error.message,'角色卡更新管理器');}
}
function install(){
    if(document.getElementById('cum-open'))return;
    const target=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
    if(!target){setTimeout(install,1000);return;}
    const block=document.createElement('div');block.id='cum-launcher';
    const button=document.createElement('button');button.id='cum-open';button.type='button';button.textContent='角色卡更新管理器';button.addEventListener('click',open);block.append(button);target.append(block);
    const menu=document.querySelector('#extensionsMenu');
    if(menu){const entry=document.createElement('div');entry.className='list-group-item flex-container flexGap5';entry.tabIndex=0;entry.role='button';entry.textContent='角色卡更新管理器';entry.addEventListener('click',open);entry.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}});menu.append(entry);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
