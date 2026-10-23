"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {stripTypeScriptTypes} = require("node:module");
const root = path.join(__dirname,"..");

function edgeContext() {
  const source = fs.readFileSync(path.join(root,"supabase/functions/catchmind-gallery/index.ts"),"utf8")
    .replace(/^import .*;\r?\n/gm,"");
  const context = vm.createContext({Deno:{serve(){}},Response,console});
  vm.runInContext(stripTypeScriptTypes(source),context);
  return context;
}

test("match gallery restricts the query to this game's rounds and avoids unrelated gallery work",async()=>{
  const context=edgeContext();const calls=[];
  const client={storage:{from(){return {getPublicUrl:p=>({data:{publicUrl:"https://images.invalid/"+p}})};}},
    from(table){
      assert.equal(table,"catchmind_drawings");
      let matchId;
      return {
        select(fields){assert.ok(fields.includes("match_id"));return this;},
        eq(key,value){calls.push({key,value});assert.equal(key,"match_id");matchId=value;return this;},
        order(key){assert.equal(key,"round_index");return this;},
        async limit(count){
          assert.equal(count,40);
          return {data:[{id:1,drawer:"B",word:"사과",match_id:"game-a",round_index:0,image_path:"a.webp"},
            {id:2,drawer:"B",word:"옛 그림",match_id:"game-b",round_index:0,image_path:"b.webp"}]
            .filter(row=>row.match_id===matchId),error:null};
        }
      };
    }};
  const result=await (await context.listGallery(client,"A",{mode:"match",matchId:"game-a"})).json();
  assert.equal(result.ok,true);assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].matchId,"game-a");assert.equal(result.rows[0].word,"사과");
  assert.equal(result.rows[0].roundIndex,0);assert.equal(calls.length,1);
});

test("missing match IDs do not fall back to unrelated recent drawings",async()=>{
  const context=edgeContext();const client={from(){throw Error("must not query");}};
  const result=await (await context.listGallery(client,"A",{mode:"match",matchId:""})).json();
  assert.equal(result.ok,false);assert.equal(result.reason,"invalid_match");
});

test("the game adapter sends the match identifier through the authenticated gallery endpoint",async()=>{
  let invocation;
  const context=vm.createContext({console,window:{SB:{functions:{async invoke(name,options){
    invocation={name,body:options.body};return {data:{ok:true,rows:[]},error:null};
  }}}}});
  vm.runInContext(fs.readFileSync(path.join(root,"db.js"),"utf8"),context);
  await context.window.Db.getCatchmindMatchDrawings({nick:"A",hash:"a".repeat(64)}," game-a ");
  assert.equal(invocation.name,"catchmind-gallery");assert.equal(invocation.body.action,"list");
  assert.equal(invocation.body.mode,"match");assert.equal(invocation.body.matchId,"game-a");
  assert.equal(invocation.body.auth.nick,"A");
});
