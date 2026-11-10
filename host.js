import {copy,equal,stable,enrichLiveWorld} from './core.js';
import {packCard} from './card.js';

export async function connectHost() {
    const [script,world,user]=await Promise.all([import('/script.js'),import('/scripts/world-info.js'),import('/scripts/user.js')]);
    const request=async(path,body,{blob=false,form=false}={})=>{
        const headers=new Headers(script.getRequestHeaders());if(form)headers.delete('Content-Type');
        const response=await fetch('/api/'+path,{method:'POST',headers,body:form?body:JSON.stringify(body),cache:'no-store'});
        if(!response.ok)throw Error(`${path} 失败（HTTP ${response.status}）`);
        if(blob)return response.blob();
        const text=await response.text();let data;
        try{data=JSON.parse(text);}catch{return text;}
        if(data?.error)throw Error(`${path} 返回错误：${String(data.message??data.error)}`);
        return data;
    };
    const host={
        account:user.getCurrentUserHandle(),
        convert:world.convertCharacterBook,
        async list(){await script.getCharacters();return script.characters.map(c=>({name:c.name,avatar:c.avatar}));},
        async snapshot(avatar){
            const card=await request('characters/get',{avatar_url:avatar});
            const worldName=card.data?.extensions?.world||'';
            let wi;
            if(worldName){
                // /get silently returns an empty book when missing; check actual list as well.
                await world.updateWorldInfoList();
                if(!world.world_names.includes(worldName))throw Error(`绑定的世界书不存在：${worldName}`);
                wi=await request('worldinfo/get',{name:worldName});
            }else if(card.data?.character_book?.entries){wi=world.convertCharacterBook(copy(card.data.character_book));}
            else throw Error('当前角色没有主要世界书或内嵌世界书');
            const png=await request('characters/export',{avatar_url:avatar,format:'png'},{blob:true});
            return {avatar,card,world:enrichLiveWorld(wi,world.convertCharacterBook),worldName,png};
        },
        ensureIdle(){
            if(script.isGenerating?.() || script.is_send_press || script.isChatSaving)throw Error('酒馆正在生成或保存聊天，请完成后再更新');
        },
        async saveWorld(name,data){
            await request('worldinfo/edit',{name,data});
            // saveWorldInfo also updates SillyTavern's in-memory cache.
            await world.saveWorldInfo(name,data,true);await world.updateWorldInfoList();
            const actual=await request('worldinfo/get',{name});
            if(!equal(actual.entries,data.entries))throw Error('世界书写入后校验失败');
        },
        async importPng(avatar,png){
            if(!avatar || /[/\\]/.test(avatar) || !avatar.toLowerCase().endsWith('.png'))throw Error('目标角色文件标识无效');
            const data=new FormData();data.append('avatar',png,'merged.png');data.append('file_type','png');
            data.append('preserved_name',avatar);data.append('user_name',script.name1);
            const result=await request('characters/import',data,{form:true});
            if(result?.file_name+'.png'!==avatar && result?.file_name!==avatar)throw Error('服务器未返回预期目标卡，停止更新');
        },
        async preserveLocal(avatar,old){
            const patch={avatar};
            for(const key of ['chat','create_date','fav'])if(old[key]!==undefined)patch[key]=copy(old[key]);
            if(old.data?.extensions?.fav!==undefined)patch.data={extensions:{fav:old.data.extensions.fav}};
            await request('characters/merge-attributes',patch);
        },
        async getCard(avatar){return request('characters/get',{avatar_url:avatar});},
        async restore(backup){
            if(backup.newWorldName===backup.snapshot.worldName&&backup.snapshot.worldName)await this.saveWorld(backup.snapshot.worldName,backup.snapshot.world);
            // Repack the export with full card data; /export strips local chat/favourite fields.
            const png=await packCard(backup.snapshot.card,backup.snapshot.png);
            await this.importPng(backup.avatar,png);
            await this.preserveLocal(backup.avatar,backup.snapshot.card);
            const actual=await this.getCard(backup.avatar);
            if(!equal(actual.data,backup.snapshot.card.data) || actual.chat!==backup.snapshot.card.chat)throw Error('角色恢复后校验失败');

        },
        refresh(){location.reload();},
    };
    return host;
}

export function snapshotKey(s) {
    return stable({data:s.card.data,chat:s.card.chat,worldName:s.worldName,entries:s.world.entries});
}
export async function applyUpdate({host,store,snapshot,card,world,png,baseline,worldName,progress=()=>{}}) {
    host.ensureIdle();
    const latest=await host.snapshot(snapshot.avatar);
    if(snapshotKey(latest)!==snapshotKey(snapshot))throw Error('当前角色或世界书在比较后发生了修改，请重新比较；本次没有覆盖');
    const previousRecord=await store.get(snapshot.avatar);
    const backup=await store.backup({avatar:snapshot.avatar,snapshot:latest,previousRecord,newWorldName:worldName});
    let importStarted=false,worldStarted=false;
    const reusesWorld=!!snapshot.worldName&&worldName===snapshot.worldName;
    try{
        progress('正在保存合并世界书…');worldStarted=true;await host.saveWorld(worldName,world);
        // Recheck after backup/world creation, just before the irreversible write.
        host.ensureIdle();
        if(snapshotKey(await host.snapshot(snapshot.avatar))!==snapshotKey(reusesWorld?{...snapshot,world}:snapshot))throw Error('更新前检测到新的修改，请重新比较');
        backup.status='writing';await store.saveBackup(backup);
        progress('正在覆盖目标角色卡…');importStarted=true;
        await host.importPng(snapshot.avatar,png);await host.preserveLocal(snapshot.avatar,latest.card);
        progress('正在核对角色卡和世界书…');
        const actual=await host.getCard(snapshot.avatar);
        const expected=copy(card.data), received=copy(actual.data);
        // Import sanitizes favourites, which preserveLocal restores deliberately.
        if(received.extensions)delete received.extensions.fav;
        if(expected.extensions)delete expected.extensions.fav;
        if(!equal(received,expected) || actual.chat!==latest.card.chat)throw Error('角色卡写入后校验失败');
        backup.status='complete';await store.saveBackup(backup);
        await store.put(snapshot.avatar,{baseline:copy(baseline),updatedAt:new Date().toISOString(),draft:null});
        return backup;
    }catch(error){
        if(importStarted||(reusesWorld&&worldStarted)){
            progress('更新未完成，正在恢复备份…');
            try{if(importStarted)await host.restore(backup);else await host.saveWorld(snapshot.worldName,snapshot.world);await store.put(snapshot.avatar,previousRecord??{});backup.status='rolled-back';}
            catch(restoreError){backup.status='recovery-needed';backup.error=String(restoreError);await store.saveBackup(backup);throw Error(`更新失败：${error.message}。自动恢复未完成：${restoreError.message}。请在“备份与恢复”中恢复旧卡。`);}
        }else backup.status='not-applied';
        backup.error=String(error);await store.saveBackup(backup);
        throw Error(`更新未完成${importStarted?'，已恢复旧卡':reusesWorld&&worldStarted?'，已恢复旧世界书':''}：${error.message}`);
    }
}
