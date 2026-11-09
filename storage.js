// IndexedDB is isolated by origin; additionally namespace by SillyTavern account.
export class Storage {
    constructor(account){this.account=account;}
    async open(){
        if(this.db)return this.db;
        this.db=await new Promise((resolve,reject)=>{
            const req=indexedDB.open('st-card-update-manager',1);
            req.onupgradeneeded=()=>{req.result.createObjectStore('records');req.result.createObjectStore('backups');};
            req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });return this.db;
    }
    key(avatar){return JSON.stringify([this.account,avatar]);}
    async run(store,mode,action){
        const db=await this.open();return new Promise((resolve,reject)=>{
            const tx=db.transaction(store,mode);let result;
            const req=action(tx.objectStore(store));req.onsuccess=()=>{result=req.result;};
            tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('存储事务已中止'));
        });
    }
    get(avatar){return this.run('records','readonly',s=>s.get(this.key(avatar)));}
    put(avatar,value){return this.run('records','readwrite',s=>s.put(value,this.key(avatar)));}
    async backup(value){
        const backup={...value,account:this.account,id:crypto.randomUUID(),time:new Date().toISOString(),status:'prepared'};
        await this.run('backups','readwrite',s=>s.put(backup,backup.id));return backup;
    }
    saveBackup(value){return this.run('backups','readwrite',s=>s.put(value,value.id));}
    async backups(avatar){return (await this.run('backups','readonly',s=>s.getAll())).filter(b=>b.account===this.account&&b.avatar===avatar).sort((a,b)=>b.time.localeCompare(a.time));}
}
