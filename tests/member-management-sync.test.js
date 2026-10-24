"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),dbSource=fs.readFileSync(path.join(root,'db.js'),'utf8');
function dbFixture(account){
  const writes=[];
  const sb={from(){return {select(){return this;},eq(){return Promise.resolve({data:account?[account]:[],error:null});},update(value){writes.push(value);return this;}};}};
  const ctx={window:{SB:sb},crypto:require('node:crypto').webcrypto,TextEncoder};vm.runInNewContext(dbSource,ctx);
  return {db:ctx.window.Db,writes};
}
test('departed accounts cannot login or reset their password or auto-login',async()=>{
  const {db,writes}=dbFixture({nickname:'솔이',member_departed:true,pw_hash:null});
  assert.equal((await db.login('솔이','test')).reason,'departed');
  assert.equal((await db.loginHash('솔이','hash')).reason,'departed');assert.equal(writes.length,0);
});
test('existing account password stays unchanged and reactivated login works',async()=>{
  const {db,writes}=dbFixture({nickname:'솔이',member_departed:false,pw_hash:'hash'});
  assert.equal((await db.loginHash('솔이','hash')).ok,true);assert.equal(writes.length,0);
});
test('first password for a synced new account must actually save before login succeeds',async()=>{
  const {db,writes}=dbFixture({nickname:'신규',member_departed:false,pw_hash:null});
  assert.equal((await db.login('신규','chosen-password')).ok,true);assert.equal(writes.length,1);
  assert.match(writes[0].pw_hash,/^[a-f0-9]{64}$/);
  let updating=false;
  const query={select(){return this;},update(){updating=true;return this;},eq(){return Promise.resolve(updating?{error:{message:'private server error'}}:{data:[{pw_hash:null}],error:null});}};
  const ctx={window:{SB:{from:()=>query}},crypto:require('node:crypto').webcrypto,TextEncoder};vm.runInNewContext(dbSource,ctx);
  const failed=await ctx.window.Db.login('신규','chosen-password');assert.equal(failed.ok,false);assert.equal(failed.reason,'error');
  assert.doesNotMatch(failed.msg,/private server error/);
});
test('membership read distinguishes known departure from missing data',async()=>{
  assert.equal((await dbFixture({member_departed:true}).db.getMemberAccess('a')).departed,true);
  assert.equal((await dbFixture(null).db.getMemberAccess('a')).known,false);
});
function watchFixture(){
  const intervals=new Map(),listeners=new Map();let next=0,now=100000;
  const window={setInterval(fn,ms){assert.equal(ms,60000);intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'member-access-watch.js'),'utf8'),{window,Date:{now:()=>now}});
  return {watch:window.MemberAccessWatch,intervals,listeners,advance:()=>now+=60000};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('known departure leaves once and removes polling and focus listener',async()=>{
  const f=watchFixture();let left=0;f.watch.start('a',async()=>({known:true,departed:true}),async()=>left++);await flush();
  assert.equal(left,1);assert.equal(f.intervals.size,0);assert.equal(f.listeners.size,0);
});
test('network failure is not a departure and overlapping polls are bounded',async()=>{
  const f=watchFixture();let reads=0,left=0,finish;
  f.watch.start('a',()=>{reads++;return new Promise(resolve=>finish=resolve);},()=>left++);
  f.advance();f.listeners.get('focus')();assert.equal(reads,1);finish({known:false});await flush();assert.equal(left,0);
  f.watch.stop();
});
test('old membership read cannot disconnect a newly logged-in member',async()=>{
  const f=watchFixture();let finish,left=0;
  f.watch.start('a',()=>new Promise(resolve=>finish=resolve),()=>left++);
  f.watch.start('b',async()=>({known:true,departed:false}),()=>left++);
  finish({known:true,departed:true});await flush();assert.equal(left,0);assert.equal(f.intervals.size,1);f.watch.stop();
});
test('all account-verified game endpoints reject departed accounts',async()=>{
  for(const name of ['room-lease','holdem-table','catchmind-gallery','catchmind-progression','relay-gallery']){
    const source=fs.readFileSync(path.join(root,'supabase','functions',name,'index.ts'),'utf8');
    const start=source.indexOf('async function verifyAccount('),end=source.indexOf('\n}',start)+2,body=source.slice(start,end);
    assert.match(body,/\.select\("nickname(?:,is_admin)?,member_departed"\)/);assert.match(body,/data\.member_departed === true/);
    const context={safeText:(value,max)=>String(value||'').trim().slice(0,max),object:value=>value&&typeof value==='object'?value:{}};
    vm.createContext(context);
    vm.runInContext(require('node:module').stripTypeScriptTypes(body)+';globalThis.verify=verifyAccount;',context);
    for(const departed of [false,true]){
      const query={select(columns){assert.ok(columns.includes('member_departed'));return this;},eq(){return this;},maybeSingle(){return Promise.resolve({data:{nickname:'member',is_admin:false,member_departed:departed},error:null});}};
      const result=await context.verify({from:()=>query},{nick:'member',hash:'a'.repeat(64)});
      assert.equal(result===null,departed,name);
    }
  }
});
test('database migration runs real join departure rejoin duplicate and rollback cases', {skip:!process.env.MEMBER_SYNC_TEST_PGLITE},async()=>{
  const {PGlite}=require(process.env.MEMBER_SYNC_TEST_PGLITE),db=new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;create table accounts(nickname text primary key,pw_hash text,is_admin boolean default false,profile_avatar text);create table allowlist(nickname text primary key);create table games(id int primary key,nickname text references accounts(nickname),score int);insert into accounts values('기존','original-hash',false,'original-avatar'),('구나','admin-hash',true,null),('별도','separate-hash',false,null);insert into games values(1,'기존',90);");
    const migration=fs.readFileSync(path.join(root,'supabase','migrations','202610230001_member_management_sync.sql'),'utf8');
    await db.exec(migration);await db.exec(migration);
    const source='13LPdYRKTdwX0sxRAHCJh6Y3Gc7slG2DKi6SHuz6sxlc';let revision=Date.now()-100;
    const member=(member_id,nickname,status='active')=>({member_id,nickname,status});
    async function sync(members,rev=++revision,src=source){return (await db.query('select sync_member_management($1,$2,$3::jsonb) as r',[src,rev,JSON.stringify(members)])).rows[0].r;}
    const rows=async(sql)=> (await db.query(sql)).rows;
    const roster=[member('old','기존'),member('new','신규'),member('admin','구나','departed')];
    let r=await sync(roster);assert.equal(r.created,1);assert.equal(r.protected,1);assert.equal(r.processed,3);
    assert.deepEqual(await sync(roster,revision),r);
    assert.equal((await sync(roster)).created,0);
    const original=(await rows("select * from accounts where nickname='기존'"))[0];assert.equal(original.pw_hash,'original-hash');assert.equal(original.profile_avatar,'original-avatar');
    assert.equal((await rows("select * from accounts where nickname='신규'"))[0].pw_hash,null);
    r=await sync([member('old','기존','departed')]);assert.equal(r.departed,1);
    assert.equal((await rows("select member_departed from accounts where nickname='기존'"))[0].member_departed,true);
    assert.equal((await rows("select * from allowlist where nickname='기존'")).length,0);
    assert.equal((await rows('select * from games'))[0].score,90);
    assert.equal((await rows("select member_departed from accounts where nickname='신규'"))[0].member_departed,false);
    assert.equal((await rows("select member_departed from accounts where nickname='별도'"))[0].member_departed,false);
    assert.equal((await sync([member('old','기존','departed')])).departed,0);
    assert.equal((await sync([member('old','기존')])).activated,1);
    assert.equal((await rows("select pw_hash from accounts where nickname='기존'"))[0].pw_hash,'original-hash');
    await sync([member('old','기존','review')]);assert.equal((await rows("select member_departed from accounts where nickname='기존'"))[0].member_departed,false);
    for(const bad of [[],[member('same','a'),member('same','b')],[member('1','a'),member('2','a')],[member('bad','동운이')],[member('bad','a','unknown')],[{member_id:'a',nickname:'b'}]])await assert.rejects(sync(bad));
    await assert.rejects(sync(roster,revision-1000),/stale_revision/);
    await assert.rejects(sync(roster,Date.now()-1000000),/invalid_source_or_revision/);
    await assert.rejects(sync(roster,Date.now()+1000000),/invalid_source_or_revision/);
    await assert.rejects(sync(roster,++revision,'other'),/invalid_source_or_revision/);
    await assert.rejects(sync([member('created-first','취소될신규'),member('old','바뀐이름')]),/nickname_change_requires_review/);
    assert.equal((await rows("select * from accounts where nickname='취소될신규'")).length,0);
    await assert.rejects(sync([member('wrong-id','기존')]),/nickname_identity_conflict/);
    await sync([member('never-joined','옛탈퇴자','departed')]);assert.equal((await rows("select * from accounts where nickname='옛탈퇴자'")).length,0);
    await db.exec('set role anon');
    await assert.rejects(sync(roster),/permission denied/);await db.exec('reset role');
    await db.exec('set role authenticated');
    await assert.rejects(sync(roster),/permission denied/);await db.exec('reset role');
    await db.exec('set role service_role');
    assert.equal((await sync(roster)).ok,true);await db.exec('reset role');
    assert.equal((await rows("select member_departed from accounts where nickname='구나'"))[0].member_departed,false);
  } finally {await db.close();}
});
