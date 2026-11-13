import {createComparison} from './diff-view.js';
import {copy,entriesOf,matchEntries,buildRows,buildTwoWayRows,LABELS,selectedEntry,assembleWorld,toCharacterBook,normalizeCardWorld} from './core.js';
import {readCardFile,packCard,download,bytesToBase64,base64ToBytes,parseJSON} from './card.js';
import {applyUpdate} from './host.js';

function el(tag,attrs={},...children){
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs)){
        if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
        else if(key==='class')node.className=value;
        else if(key==='checked'||key==='disabled')node[key]=value;
        else node.setAttribute(key,value);
    }
    for(const child of children.flat())if(child!==undefined&&child!==null)node.append(typeof child==='string'?document.createTextNode(child):child);
    return node;
}
const button=(text,action,attrs={})=>el('button',{type:'button',onclick:action,...attrs},text);
const pretty=v=>v===undefined?'（不存在）':typeof v==='string'?v:JSON.stringify(v,null,2);
async function pickFile(accept){
    return new Promise(resolve=>{
        const input=el('input',{type:'file',accept,hidden:''});document.body.append(input);
        const done=()=>{const file=input.files?.[0];input.remove();resolve(file);};
        input.addEventListener('change',done,{once:true});input.addEventListener('cancel',done,{once:true});input.click();
    });
}
async function portable(value){
    if(value instanceof Blob)return {__cumBlob:bytesToBase64(new Uint8Array(await value.arrayBuffer())),type:value.type};
    if(Array.isArray(value))return Promise.all(value.map(portable));
    if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await portable(v)])));
    return value;
}
function hydrate(value){
    if(value&&typeof value==='object'&&typeof value.__cumBlob==='string')return new Blob([base64ToBytes(value.__cumBlob)],{type:value.type});
    if(Array.isArray(value))return value.map(hydrate);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hydrate(v)]));
    return value;
}

export class Manager {
    constructor(host,store){this.host=host;this.store=store;this.state={};this.busy=false;}
    async open(card){
        if(this.dialog?.open){if(card)await this.run(()=>this.selectCard(card));this.dialog.focus();return;}
        this.previousFocus=document.activeElement;
        this.dialog=el('dialog',{class:'cum-dialog','aria-labelledby':'cum-title'});
        this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
        this.dialog.addEventListener('close',()=>{this.comparisonView?.destroy();this.previousFocus?.focus();this.dialog.remove();});
        this.message=el('div',{class:'cum-message',role:'status','aria-live':'polite'});
        this.content=el('main',{class:'cum-content'});
        this.shell=el('div',{class:'cum-shell'},
            el('header',{class:'cum-header'},el('div',{},el('span',{class:'cum-eyebrow'},'CARD UPDATE MANAGER'),el('h2',{id:'cum-title'},'角色卡更新管理器',el('span',{class:'cum-version'},'0.1.10'))),
                button('关闭',()=>{if(!this.busy)this.dialog.close();},{class:'cum-quiet'})),this.message,this.content);
        this.dialog.append(this.shell);document.body.append(this.dialog);this.dialog.showModal();
        const pref=await this.store.get('@preferences');this.fontSize=Math.min(20,Math.max(10,Number(pref?.fontSize)||12));this.dialog.style.setProperty('--cum-reading-size',this.fontSize+'px');await this.run(()=>card?this.selectCard(card):this.home());
    }
    async run(task){
        if(this.busy)return;
        this.busy=true;this.message.textContent='处理中…';this.message.classList.remove('cum-error');this.shell.setAttribute('aria-busy','true');
        this.content.inert=true;
        try{await task();if(this.message.textContent==='处理中…')this.message.textContent='';}
        catch(error){console.error('[Card Update Manager]',error);this.message.textContent=error.message;this.message.classList.add('cum-error');}
        finally{this.busy=false;this.content.inert=false;this.shell.removeAttribute('aria-busy');}
    }
    say(text){this.message.textContent=text;}
    async confirm(text,action){
        const dlg=el('dialog',{class:'cum-confirm','aria-label':'确认操作'});
        const answer=await new Promise(resolve=>{
            dlg.append(el('h3',{},'确认操作'),el('p',{},text),el('div',{class:'cum-actions'},button('取消',()=>{dlg.close();resolve(false);}),button(action,()=>{dlg.close();resolve(true);},{class:'cum-primary'})));
            dlg.addEventListener('cancel',()=>resolve(false),{once:true});document.body.append(dlg);dlg.showModal();
        });dlg.remove();return answer;
    }
    async home(){
        this.comparisonView?.destroy();
        this.content.classList.remove('cum-merge-page');
        this.state={};const cards=await this.host.list();
        const records=await Promise.all(cards.map(c=>this.store.get(c.avatar)));
        const search=el('input',{type:'search',placeholder:'搜索角色名或文件名…','aria-label':'搜索角色卡'});
        const grid=el('div',{class:'cum-card-grid'});
        const draw=()=>{
            grid.replaceChildren();const q=search.value.toLowerCase();
            cards.forEach((card,i)=>{
                if(!`${card.name} ${card.avatar}`.toLowerCase().includes(q))return;
                const r=records[i];const img=el('img',{src:'/thumbnail?type=avatar&file='+encodeURIComponent(card.avatar),alt:'',loading:'lazy'});
                img.onerror=()=>{img.style.visibility='hidden';};
                grid.append(button('',()=>this.run(()=>this.selectCard(card)),{class:'cum-card'}));
                grid.lastChild.append(img,el('span',{class:'cum-card-info'},el('strong',{},card.name),el('small',{},card.avatar),el('span',{class:'cum-badge'},r?.draft?'有合并草稿':r?.baseline?'已建立基线':'尚未建立基线'),r?.updatedAt?el('small',{},'上次更新 '+new Date(r.updatedAt).toLocaleString()):null));
            });
            if(!grid.children.length)grid.append(el('p',{class:'cum-empty'},cards.length?'没有匹配的角色卡':'当前没有角色卡，请先在酒馆导入角色卡。'));
        };
        search.addEventListener('input',draw);draw();
        this.content.replaceChildren(el('div',{class:'cum-heading'},el('div',{},el('h3',{},'选择要更新的角色'),el('p',{},'先比较，再覆盖。你的选择会写进新版卡。')),button('刷新列表',()=>this.run(()=>this.home()))),search,grid,
            el('p',{class:'cum-note'},'基线、草稿和恢复备份保存在当前浏览器、当前酒馆账号下。更换浏览器前请导出项目备份。'));
    }
    async selectCard(card){
        const record=await this.store.get(card.avatar)??{};
        this.state={card,record,snapshot:null,next:null,rows:null,filter:'changed',selected:0};
        this.renderSetup();
    }
    nav(){
        const actions=el('div',{class:'cum-more-actions'},button('备份与恢复',()=>this.run(()=>this.backupPage())),button('导出项目备份',()=>this.run(()=>this.exportProject())));
        if(this.state.rows)actions.append(button('导出合并卡',()=>this.run(()=>this.exportMerged()),{disabled:this.state.rows.some(r=>!r.choice)}),button('读取当前修改重新比较',()=>this.run(async()=>{if(!await this.confirm('重新读取会清除当前条目选择，是否继续？','重新比较'))return;this.state.snapshot=await this.host.snapshot(this.state.card.avatar);await this.beginComparison();})));
        return el('div',{class:'cum-heading cum-nav'},el('div',{class:'cum-nav-title'},button('← 角色列表',()=>this.run(()=>this.home()),{class:'cum-quiet'}),el('div',{class:'cum-character-name'},el('h3',{},this.state.card.name),el('small',{},this.state.card.avatar))),el('details',{class:'cum-more'},el('summary',{},'更多'),actions));
    }
    renderSetup(){
        this.comparisonView?.destroy();
        this.content.classList.remove('cum-merge-page');
        const s=this.state;
        const steps=el('div',{class:'cum-steps'},
            el('section',{class:'cum-step'},el('span',{class:'cum-step-number'},'01'),el('h4',{},'作者旧原版'),el('p',{},s.record.baseline?`已保存：${s.record.baseline.data.name} · ${s.record.baseline.data.character_book.entries.length} 条`:'导入你开始修改前下载的作者原版，用来识别哪些改动来自你。'),button(s.record.baseline?'更换旧原版':'导入旧原版',()=>this.run(()=>this.importBaseline()))),
            el('section',{class:'cum-step'},el('span',{class:'cum-step-number'},'02'),el('h4',{},'当前游玩版'),el('p',{},'比较时直接读取这张卡实际绑定的主要世界书。无需切换聊天。')),
            el('section',{class:'cum-step'},el('span',{class:'cum-step-number'},'03'),el('h4',{},'作者新版'),el('p',{},'导入 PNG 或 JSON 新版卡。比较期间不会修改酒馆中的角色卡。'),button('导入新版并比较',()=>this.run(()=>this.importNext()),{class:'cum-primary',disabled:!s.record.baseline}),button('没有旧原版，直接比较',()=>this.run(()=>this.importNext(true)),{class:'cum-quiet'})));
        this.content.replaceChildren(this.nav(),steps,el('div',{class:'cum-actions'},s.record.draft?button('继续合并草稿',()=>this.run(()=>this.resumeDraft()),{class:'cum-primary'}):null,button('导入项目备份',()=>this.run(()=>this.importProject()))),
            el('p',{class:'cum-note'},'只比较和合并主要世界书正文，开关和触发配置采用新版；开场白、描述、正则、脚本等其他角色卡内容采用作者新版。全局、聊天及附加世界书不纳入比较。'));
    }
    async importBaseline(){
        const file=await pickFile('.png,.json');if(!file)return;
        const parsed=await readCardFile(file);normalizeCardWorld(parsed.card,this.host.convert);
        if(!await this.confirm(`将“${parsed.card.data.name}”设为“${this.state.card.name}”的作者旧原版。请确认这是你开始修改前使用的版本。已有合并草稿会清除。`,'建立基线'))return;
        this.state.record={...this.state.record,baseline:parsed.card,draft:null};
        await this.store.put(this.state.card.avatar,this.state.record);this.renderSetup();this.say('旧原版已保存。现在可以导入新版。');
    }
    async importNext(twoWay=false){
        const file=await pickFile('.png,.json');if(!file)return;
        const next=await readCardFile(file);normalizeCardWorld(next.card,this.host.convert);
        if(!await this.confirm(`将“${next.card.data.name}”作为“${this.state.card.name}”的作者新版进行比较。此步骤不会覆盖旧卡。${twoWay?'缺少旧原版，无法判断差异来源，所有不同条目需确认。':''}`,'开始比较'))return;
        const snapshot=await this.host.snapshot(this.state.card.avatar);
        Object.assign(this.state,{snapshot,next,rows:null,twoWay});await this.beginComparison();
    }
    prepareMaps(){
        const s=this.state;
        s.baseWorld=s.twoWay?null:normalizeCardWorld(s.record.baseline,this.host.convert);s.nextWorld=normalizeCardWorld(s.next.card,this.host.convert);
        s.base=entriesOf(s.baseWorld);s.mine=entriesOf(s.snapshot.world);s.nextEntries=entriesOf(s.nextWorld);
        s.maps={mine:matchEntries(s.base,s.mine),next:matchEntries(s.base,s.nextEntries)};
    }
    async beginComparison(){
        this.prepareMaps();
        const s=this.state;
        s.rows=s.twoWay?buildTwoWayRows(s.mine,s.nextEntries):buildRows(s.base,s.mine,s.nextEntries,s.maps);
        s.selected=0;s.filter='changed';s.mobilePane='list';
        await this.saveDraft();this.renderMerge();
    }
    async saveDraft(){
        const s=this.state;
        s.record={...s.record,draft:{textOnly:true,twoWay:!!s.twoWay,snapshot:s.snapshot,next:s.next,maps:s.maps,rows:s.rows,savedAt:new Date().toISOString()}};
        await this.store.put(s.card.avatar,s.record);
    }
    async resumeDraft(){
        const s=this.state,d=s.record.draft;
        Object.assign(s,{snapshot:d.snapshot,next:d.next,twoWay:!!d.twoWay});this.prepareMaps();s.maps=d.maps??s.maps;s.rows=s.twoWay?buildTwoWayRows(s.mine,s.nextEntries):buildRows(s.base,s.mine,s.nextEntries,s.maps);for(const row of s.rows){const old=d.rows?.find(r=>r.id===row.id);if(old&&row.type!=='unchanged'&&old.choice){row.choice=old.choice;row.custom=old.custom;}}s.filter='changed';s.selected=0;s.mobilePane='list';s.detailSource=null;
        this.renderMerge();this.say('草稿已恢复。应用前会检查当前卡和世界书是否发生变化。');
    }
    renderMerge(){
        this.content.classList.add('cum-merge-page');
        const s=this.state, pending=s.rows.filter(r=>!r.choice).length;
        const filter=el('select',{'aria-label':'筛选条目'},el('option',{value:'changed'},'所有差异'),el('option',{value:'pending'},`待处理（${pending}）`),el('option',{value:'all'},'全部条目'));
        for(const [key,label]of Object.entries(LABELS)){const count=s.rows.filter(r=>r.type===key).length;if(count)filter.append(el('option',{value:key},`${label}（${count}）`));}
        filter.value=s.filter;filter.addEventListener('change',()=>{s.filter=filter.value;s.detailSource=null;this.renderMerge();});
        this.list=el('aside',{class:'cum-entry-list','aria-label':'世界书条目'});this.detail=el('section',{class:'cum-detail','aria-label':'条目差异详情',tabindex:'-1'});
        this.mobileTabs=el('div',{class:'cum-mobile-tabs','aria-label':'比较面板'},button('条目列表',()=>this.setMobilePane('list'),{'data-pane':'list'}),button('差异详情',()=>this.setMobilePane('detail'),{'data-pane':'detail'}));
        this.content.replaceChildren(this.nav(),this.mobileTabs,el('div',{class:'cum-toolbar'},el('div',{class:'cum-merge-summary'},el('strong',{},`世界书 · ${s.rows.length} 条`),el('span',{},`${pending} 条待处理`)),filter),
            s.twoWay?el('div',{class:'cum-two-way-tools'},el('p',{class:'cum-note'},'无旧原版：仅显示版本差异，无法判断修改来源。仅一侧存在的条目也需确认；无法可靠匹配的条目分开显示。'),el('div',{class:'cum-actions'},button(`剩余 ${pending} 条保留当前版`,()=>this.run(()=>this.resolvePending('mine')),{disabled:!pending}),button(`剩余 ${pending} 条采用新版`,()=>this.run(()=>this.resolvePending('next')),{disabled:!pending}))):el('span',{hidden:''}),el('div',{class:'cum-workspace'},this.list,this.detail),
            el('footer',{class:'cum-footer'},el('span',{},'其他卡内容采用作者新版；世界书沿用原名写回。'),el('div',{class:'cum-actions'},button('保存草稿',()=>this.run(async()=>{await this.saveDraft();this.say('草稿已保存。');})),button('检查并覆盖更新',()=>this.run(()=>this.apply()),{class:'cum-primary',disabled:!!pending}))));
        this.drawList();this.setMobilePane(s.mobilePane??'list');
    }
    setMobilePane(pane){
        this.state.mobilePane=pane;this.content.dataset.mobilePane=pane;
        for(const b of this.mobileTabs?.querySelectorAll('button')??[])b.setAttribute('aria-pressed',String(b.dataset.pane===pane));
    }
    selectEntry(index){
        this.state.selected=index;this.state.detailSource=null;this.drawList();this.setMobilePane('detail');this.detail.scrollTop=0;
        if(matchMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1000px)').matches)this.detail.focus({preventScroll:true});
    }
    drawList(){
        const s=this.state;this.list.replaceChildren();
        const visible=s.rows.map((r,i)=>({r,i})).filter(({r})=>s.filter==='all'||s.filter==='changed'&&!['unchanged','bothDeleted'].includes(r.type)||s.filter==='pending'&&!r.choice||r.type===s.filter);
        if(!visible.some(({i})=>i===s.selected))s.selected=visible[0]?.i??-1;
        this.visibleRows=visible.map(x=>x.i);
        for(const {r,i}of visible){const b=button('',()=>this.selectEntry(i),{class:'cum-entry'+(s.selected===i?' is-selected':''),'aria-pressed':String(s.selected===i)});b.append(el('strong',{},r.title),el('span',{},LABELS[r.type]),el('small',{},!r.choice?'待选择':r.choice==='mine'?(s.twoWay?'保留当前版':'保留我的'):r.choice==='next'?'采用新版':r.choice==='delete'?'删除':'自定义合并'));this.list.append(b);}
        if(!visible.length)this.list.append(el('p',{class:'cum-empty'},'此分类没有条目。'));
        this.drawDetail();
        const active=this.list.querySelector('.is-selected');if(active&&this.list.scrollWidth>this.list.clientWidth)this.list.scrollLeft=active.offsetLeft-this.list.offsetLeft;
    }
    async resolvePending(choice){
        const count=this.state.rows.filter(r=>!r.choice).length;if(!count)return;
        if(!await this.confirm(`将剩余 ${count} 个未决定条目全部${choice==='mine'?'保留当前版':'采用新版'}。所选版本不存在的条目将被删除；已决定条目不变。`, '应用批量选择'))return;
        for(const r of this.state.rows)if(!r.choice)r.choice=choice;
        await this.saveDraft();this.renderMerge();
    }
    fontControl(){
        const output=el('output',{},this.fontSize+'px');
        const input=el('input',{type:'range',min:'10',max:'20',step:'1',value:String(this.fontSize),'aria-label':'对比字号'});
        input.addEventListener('input',()=>{this.fontSize=Number(input.value);output.textContent=this.fontSize+'px';this.dialog.style.setProperty('--cum-reading-size',this.fontSize+'px');});
        input.addEventListener('change',()=>{this.store.put('@preferences',{fontSize:this.fontSize}).catch(e=>this.say('字号保存失败：'+e.message));});
        return el('label',{class:'cum-font-control'},'字号',input,output);
    }
    drawDetail(){
        this.comparisonView?.destroy();
        const s=this.state,r=s.rows[s.selected];this.detail.replaceChildren();
        if(!r){this.detail.append(el('p',{class:'cum-empty'},'当前筛选下没有正文差异。可在条目列表选择“全部条目”查看。'));return;}
        this.comparisonView=createComparison(r,{twoWay:!!s.twoWay,mode:this.diffMode??'focus',onMode:mode=>{this.diffMode=mode;}});
        const choose=choice=>this.run(async()=>{r.choice=choice;await this.saveDraft();this.renderMerge();});
        const at=this.visibleRows.indexOf(s.selected);
        this.detail.append(el('div',{class:'cum-entry-nav'},button('上一条',()=>this.selectEntry(this.visibleRows[at-1]),{disabled:at<=0}),el('span',{},`${at+1} / ${this.visibleRows.length}`),button('下一条',()=>this.selectEntry(this.visibleRows[at+1]),{disabled:at>=this.visibleRows.length-1})),
            el('div',{class:'cum-detail-heading'},el('span',{class:'cum-badge'},LABELS[r.type]),el('h3',{},r.title)),
            el('div',{class:'cum-actions'},button(s.twoWay?(r.mine?'保留当前正文':'当前版不含此条目'):r.mine?'保留我的正文':'保留我的删除',()=>choose('mine'),{'aria-pressed':String(r.choice==='mine')}),button(s.twoWay?(r.next?'采用新版正文':'新版不含此条目'):r.next?'采用新版正文':'接受新版删除',()=>choose('next'),{'aria-pressed':String(r.choice==='next')}),r.mine||r.next?button('编辑正文',()=>this.editFields(r)):null),
            el('div',{class:'cum-display-toolbar'},this.fontControl(),this.comparisonView.controls),el('p',{class:'cum-text-legend'},s.twoWay?'蓝底：当前版差异 · 绿底：新版差异；底色不代表修改来源。':'蓝色：我的修改 · 绿色：作者修改 · 高亮：新增或替换的字词'),
            this.comparisonView.element);
        const entry=r.choice?selectedEntry(r):undefined;
        this.detail.append(el('details',{class:'cum-result-preview'},el('summary',{},'合并结果预览'),el('pre',{class:'cum-result-content'},r.choice?(entry?.content??'（删除此条目）'):'尚未选择')));
    }
    editFields(row){
        const current=row.choice==='custom'?row.custom.content:(row.mine?.content??row.next?.content??'');
        const editor=el('textarea',{'aria-label':'编辑最终正文',rows:'14'});editor.value=current;
        const form=el('div',{class:'cum-field-form'},el('h3',{},'编辑合并后的正文'),el('p',{},'这里只修改正文；开关、触发方式等配置采用作者新版。'),editor,
            el('div',{class:'cum-actions'},button('取消',()=>this.drawDetail()),button('保存正文',()=>this.run(async()=>{row.custom={...copy(row.next??row.mine),content:editor.value};row.choice='custom';await this.saveDraft();this.renderMerge();}),{class:'cum-primary'})));
        this.detail.replaceChildren(form);
    }
    async prepareResult(){
        const s=this.state;const world=assembleWorld(s.rows,s.nextWorld);
        const card=copy(s.next.card);
        const worldName=s.snapshot.worldName||s.snapshot.card.data.character_book?.name||card.data.character_book?.name||s.card.name;
        card.data.character_book=toCharacterBook(world,card.data.character_book);card.data.character_book.name=worldName;
        card.data.extensions={...card.data.extensions,world:worldName};
        world.originalData=copy(card.data.character_book);
        const png=await packCard(card,s.next.png??s.snapshot.png);
        return {card,world,worldName,png};
    }
    async exportMerged(){const result=await this.prepareResult();download(result.png,`${this.state.card.name}-merged.png`);this.say('合并卡已导出，酒馆中的旧卡未修改。');}
    async apply(){
        const s=this.state;
        const mine=s.rows.filter(r=>r.choice==='mine').length,next=s.rows.filter(r=>r.choice==='next').length,custom=s.rows.filter(r=>r.choice==='custom').length;
        const text=`将覆盖“${s.card.name}”（${s.card.avatar}）。采用新版 ${next} 条，保留我的 ${mine} 条，自定义 ${custom} 条。开关、触发方式等配置及开场白、描述、正则和脚本采用作者新版。先创建恢复备份；合并世界书沿用原名称并写回；若其他角色共用此世界书，也会读取更新后的内容。完成后自动刷新酒馆。`;
        if(!await this.confirm(text,'备份并覆盖更新'))return;
        const task=async()=>{
            const result=await this.prepareResult();
            await applyUpdate({host:this.host,store:this.store,snapshot:s.snapshot,...result,baseline:s.next.card,progress:t=>this.say(t)});
            this.say('更新与校验成功，正在刷新酒馆…');this.host.refresh();
        };
        if(navigator.locks)await navigator.locks.request('cum-update-'+this.host.account,{ifAvailable:true},lock=>{if(!lock)throw Error('另一个窗口正在更新，请稍后重试');return task();});
        else await task();
    }
    async exportProject(){
        const avatar=this.state.card.avatar;
        const data=await portable({format:'cum-project-v1',avatar,record:await this.store.get(avatar),backups:await this.store.backups(avatar)});
        download(new Blob([JSON.stringify(data)],{type:'application/json'}),`${avatar}-update-backup.json`);this.say('项目备份已导出，包含原版基线、草稿和恢复快照。');
    }
    async importProject(){
        const file=await pickFile('.json');if(!file)return;
        if(file.size>256*1024*1024)throw Error('项目备份超过 256 MB');
        const data=hydrate(parseJSON(await file.text()));
        if(data.format!=='cum-project-v1'||data.avatar!==this.state.card.avatar||(!data.record?.baseline&&!data.record?.draft?.twoWay))throw Error('这不是当前角色的项目备份（需匹配角色文件名）');
        if(data.record.baseline)normalizeCardWorld(data.record.baseline,this.host.convert);
        if(!await this.confirm('导入项目备份会替换当前浏览器中这张卡的基线和草稿，酒馆角色卡保持不变。','导入备份'))return;
        for(const backup of data.backups??[]){if(backup.avatar!==data.avatar||!backup.snapshot?.png)throw Error('备份快照不完整');await this.store.saveBackup({...backup,account:this.host.account,id:crypto.randomUUID()});}
        await this.store.put(data.avatar,data.record);this.state.record=data.record;this.renderSetup();this.say('项目备份已导入。');
    }
    async backupPage(){
        this.content.classList.remove('cum-merge-page');
        const backups=await this.store.backups(this.state.card.avatar);
        const list=el('div',{class:'cum-backups'});
        for(const b of backups)list.append(el('section',{class:'cum-step'},el('h4',{},new Date(b.time).toLocaleString()),el('p',{},`状态：${({complete:'更新成功','rolled-back':'已自动回退','recovery-needed':'需要恢复',prepared:'已备份，尚未更新',writing:'更新中断，建议检查','not-applied':'未覆盖旧卡'})[b.status]??b.status}`),
            button('导出旧卡',()=>this.run(async()=>download(await packCard(b.snapshot.card,b.snapshot.png),`${b.avatar}-before-update.png`))),
            button('恢复此版本',()=>this.run(async()=>{
                if(!await this.confirm('将角色卡恢复到此快照并重新绑定当时的世界书。同名写回的世界书会恢复为备份时的内容；旧版独立保存的备份只恢复原绑定。恢复前会再备份当前卡。完成后刷新酒馆。','备份当前卡并恢复'))return;
                this.host.ensureIdle();
                const before=await this.host.snapshot(b.avatar);await this.store.backup({avatar:b.avatar,snapshot:before,previousRecord:await this.store.get(b.avatar)});
                await this.host.restore(b);await this.store.put(b.avatar,b.previousRecord??{});this.host.refresh();
            }))));
        if(!backups.length)list.append(el('p',{class:'cum-empty'},'还没有覆盖更新记录。每次实际更新前都会创建备份。'));
        this.content.replaceChildren(this.nav(),button('← 返回角色管理',()=>this.renderSetup()),el('h3',{},'备份与恢复'),list);
    }
}
