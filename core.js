// Pure merge logic. Never evaluates card contents or calls a model.
export const copy = value => value === undefined ? undefined : structuredClone(value);
export function stable(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
export const equal = (a, b) => stable(a) === stable(b);
export const EXT = {
    position:'position', excludeRecursion:'exclude_recursion', preventRecursion:'prevent_recursion',
    delayUntilRecursion:'delay_until_recursion', probability:'probability', useProbability:'useProbability',
    depth:'depth', selectiveLogic:'selectiveLogic', outletName:'outlet_name', group:'group',
    groupOverride:'group_override', groupWeight:'group_weight', scanDepth:'scan_depth',
    caseSensitive:'case_sensitive', matchWholeWords:'match_whole_words', useGroupScoring:'use_group_scoring',
    automationId:'automation_id', role:'role', vectorized:'vectorized', sticky:'sticky', cooldown:'cooldown',
    delay:'delay', matchPersonaDescription:'match_persona_description', matchCharacterDescription:'match_character_description',
    matchCharacterPersonality:'match_character_personality', matchCharacterDepthPrompt:'match_character_depth_prompt',
    matchScenario:'match_scenario', matchCreatorNotes:'match_creator_notes', triggers:'triggers', ignoreBudget:'ignore_budget',
};
export function cleanEntry(entry) {
    if (!entry) return undefined;
    const e = copy(entry);
    for (const key of ['uid','displayIndex','addMemo','hash','world']) delete e[key];
    if (e.extensions) {
        for (const key of [...Object.values(EXT),'display_index','card_update_manager_native']) delete e.extensions[key];
        if (!Object.keys(e.extensions).length) delete e.extensions;
    }
    return e;
}
export function entriesOf(world) {
    return Object.values(world?.entries ?? {}).map((entry, index) => ({...copy(entry), uid: entry.uid ?? index}));
}
// Use stable, unique identities before ever considering IDs: authors can renumber IDs.
export function matchEntries(base, target) {
    const result = Array(base.length).fill(-1), used = new Set();
    const uniquePass = keyOf => {
        const left = new Map(), right = new Map();
        const add = (map, key, i) => { if (key) map.set(key, [...(map.get(key) ?? []), i]); };
        base.forEach((v,i) => { if (result[i] < 0) add(left,keyOf(v),i); });
        target.forEach((v,i) => { if (!used.has(i)) add(right,keyOf(v),i); });
        for (const [key, list] of left) if (list.length === 1 && right.get(key)?.length === 1) {
            result[list[0]] = right.get(key)[0]; used.add(right.get(key)[0]);
        }
    };
    uniquePass(e => e.comment?.trim());
    uniquePass(e => e.content?.trim());
    uniquePass(e => e.key?.length ? stable(e.key) : '');
    // ID alone is intentionally insufficient. Unmatched items require review in the mapping screen.
    return result;
}
export function validateMap(map, base, target) {
    if (!Array.isArray(map) || map.length !== base.length) throw Error('条目对应表长度不正确');
    const seen = new Set();
    for (const i of map) {
        if (!Number.isInteger(i) || i < -1 || i >= target.length) throw Error('条目对应关系无效');
        if (i >= 0 && seen.has(i)) throw Error('一个条目不能同时对应两个旧条目');
        if (i >= 0) seen.add(i);
    }
}
export const LABELS = {
    unchanged:'完全相同', author:'仅作者修改', mine:'仅我修改', both:'双方修改', same:'双方结果相同',
    authorAdded:'作者新增', mineAdded:'我的新增', authorDeleted:'作者删除', mineDeleted:'我的删除',
    bothDeleted:'双方删除', additionConflict:'双方新增同名条目',
};
export function classify(base, mine, next) {
    if (!base) return mine && next ? (equal(cleanEntry(mine),cleanEntry(next)) ? 'same':'additionConflict') : mine ? 'mineAdded':'authorAdded';
    if (!mine && !next) return 'bothDeleted';
    if (!mine) return equal(cleanEntry(base),cleanEntry(next)) ? 'mineDeleted':'both';
    if (!next) return equal(cleanEntry(base),cleanEntry(mine)) ? 'authorDeleted':'both';
    const m = !equal(cleanEntry(base), cleanEntry(mine)), n = !equal(cleanEntry(base),cleanEntry(next));
    return !m && !n ? 'unchanged' : m && n ? (equal(cleanEntry(mine),cleanEntry(next)) ? 'same':'both') : m ? 'mine':'author';
}
export function buildRows(base, mine, next, maps = {}) {
    const mm = maps.mine ?? matchEntries(base,mine), nm = maps.next ?? matchEntries(base,next);
    validateMap(mm,base,mine); validateMap(nm,base,next);
    const usedM = new Set(mm), usedN = new Set(nm), rows = [];
    const add = (b,m,n,id) => {
        const type = classify(b,m,n);
        const choice = ['both','additionConflict'].includes(type) ? null : ['mine','mineAdded','mineDeleted'].includes(type) ? 'mine':'next';
        rows.push({id, base:copy(b),mine:copy(m),next:copy(n),type,choice,title:n?.comment || m?.comment || b?.comment || `未命名条目 ${id}`});
    };
    base.forEach((b,i) => add(b,mine[mm[i]],next[nm[i]],`b${i}`));
    // Match independent additions only when unique; never collapse duplicate names.
    const extraM = mine.map((_,i)=>i).filter(i=>!usedM.has(i));
    const extraN = next.map((_,i)=>i).filter(i=>!usedN.has(i));
    const paired = matchEntries(extraM.map(i=>mine[i]),extraN.map(i=>next[i]));
    const pairedN = new Set();
    extraM.forEach((mi,i) => { const ni=extraN[paired[i]]; if (ni !== undefined) pairedN.add(ni); add(undefined,mine[mi],next[ni],`m${mi}`); });
    extraN.filter(ni=>!pairedN.has(ni)).forEach(ni=>add(undefined,undefined,next[ni],`n${ni}`));
    return rows;
}
export function selectedEntry(row) {
    if (!row.choice) throw Error(`仍有未处理条目：${row.title}`);
    if (row.choice === 'delete') return undefined;
    if (row.choice === 'custom') return copy(row.custom);
    if (!['mine','next'].includes(row.choice)) throw Error('未知选择');
    return copy(row[row.choice]);
}
export function changedFields(base, value) {
    const b = cleanEntry(base) ?? {}, v = cleanEntry(value) ?? {};
    return [...new Set([...Object.keys(b), ...Object.keys(v)])].filter(k=>!equal(b[k],v[k]));
}
export function fieldMerge(row) {
    if (!row.mine || !row.next) throw Error('删除冲突请使用整条选择');
    const b=cleanEntry(row.base)??{}, m=cleanEntry(row.mine), n=cleanEntry(row.next), result=copy(row.next);
    for (const key of new Set([...Object.keys(b),...Object.keys(m),...Object.keys(n)])) {
        const value = equal(b[key],n[key]) ? m[key] : n[key];
        if (value === undefined) delete result[key]; else result[key]=copy(value);
    }
    return result;
}
export function assembleWorld(rows, nextWorld) {
    const result=copy(nextWorld); result.entries={}; delete result.originalData;
    const reserved=new Set(entriesOf(nextWorld).map(e=>Number(e.uid)));
    const used=new Set();let fresh=Math.max(-1,...reserved,...rows.map(r=>Number(r.mine?.uid??-1)))+1;
    const chosen = rows.map(r=>({row:r,entry:selectedEntry(r)})).filter(x=>x.entry);
    chosen.sort((a,b)=>(a.row.next?.displayIndex??a.entry.displayIndex??0)-(b.row.next?.displayIndex??b.entry.displayIndex??0));
    chosen.forEach(({row,entry},i)=>{
        let uid=Number(row.next?.uid??entry.uid);
        if(!Number.isSafeInteger(uid)||uid<0||used.has(uid)||(!row.next&&reserved.has(uid)))uid=fresh++;
        used.add(uid);result.entries[uid]={...entry,uid,displayIndex:i};
    });
    return result;
}
export function toCharacterBook(world, template = {}) {
    const book=copy(template); book.entries=[];
    const knownNative = new Set(['uid','key','keysecondary','comment','content','constant','selective','order','position','disable','addMemo','displayIndex','extensions','cardExtra',...Object.keys(EXT)]);
    for (const [i,e] of entriesOf(world).entries()) {
        const extensions={...copy(e.extensions)};
        for (const [key,dest] of Object.entries(EXT)) if (e[key] !== undefined) extensions[dest]=copy(e[key]);
        extensions.display_index=i;
        // Unknown native fields are preserved in a namespaced extension and in the native world file.
        const unknown=Object.fromEntries(Object.entries(e).filter(([key])=>!knownNative.has(key)));
        if (Object.keys(unknown).length) extensions.card_update_manager_native=unknown;
        book.entries.push({...copy(e.cardExtra),id:e.uid??i,keys:e.key??[],secondary_keys:e.keysecondary??[],comment:e.comment??'',
            content:e.content??'',constant:!!e.constant,selective:!!e.selective,insertion_order:e.order??100,
            enabled:!e.disable,position:e.position===0?'before_char':'after_char',extensions});
    }
    return book;
}
export function normalizeCardWorld(card, convert) {
    const book=card.data?.character_book;
    if (!book || !Array.isArray(book.entries)) throw Error('角色卡未携带世界书；首版需要带内嵌世界书的卡');
    const ids = book.entries.map((e,i)=>e.id??i);
    if(ids.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<0))throw Error('世界书条目 ID 必须是非负安全整数');
    if (new Set(ids.map(String)).size !== ids.length) throw Error('世界书包含重复条目 ID，请先修正后导入');
    const world=convert(copy(book));
    for (const e of entriesOf(world)) {
        if (e.extensions?.card_update_manager_native) Object.assign(world.entries[e.uid],e.extensions.card_update_manager_native);
        const original=book.entries.find((v,index)=>String(v.id??index)===String(e.uid));
        const extras=Object.fromEntries(Object.entries(original??{}).filter(([k])=>!['id','keys','secondary_keys','comment','content','constant','selective','insertion_order','enabled','position','extensions'].includes(k)));
        if(Object.keys(extras).length)world.entries[e.uid].cardExtra=extras;
    }
    return world;
}
export function enrichLiveWorld(world, convert) {
    if(!world.originalData?.entries)return world;
    const original=normalizeCardWorld({data:{character_book:world.originalData}},convert);
    for(const entry of entriesOf(world)) {
        const extras=original.entries[entry.uid]?.cardExtra;
        if(extras)world.entries[entry.uid].cardExtra=copy(extras);
    }
    return world;
}
export function lineDiff(oldText='', newText='') {
    const a=String(oldText).split('\n'), b=String(newText).split('\n');
    // Bounded LCS: avoid freezing on unusually large worldbook entries.
    if (a.length*b.length > 300000) return [{kind:'remove',text:a.join('\n')},{kind:'add',text:b.join('\n')}];
    const dp=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
    for(let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    const result=[]; let i=0,j=0;
    while(i<a.length || j<b.length) {
        if(i<a.length && j<b.length && a[i]===b[j]) { result.push({kind:'same',text:a[i++]}); j++; }
        else if(j<b.length && (i===a.length || dp[i][j+1]>=dp[i+1][j])) result.push({kind:'add',text:b[j++]});
        else result.push({kind:'remove',text:a[i++]});
    }
    return result;
}
