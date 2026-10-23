"use strict";

// Offline Chrome: documents and drawing pixels stay in memory; no live service.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const html = read("index.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<link\b[^>]*>/gi, "").replace(/<img\b[^>]*>/gi, "");
let browser;
test.before(async () => { browser = await chromium.launch({channel:"chrome", headless:true}); });
test.after(async () => { if (browser) await browser.close(); });

async function pageFor(t, viewport = {width:393,height:851}) {
  const context = await browser.newContext({viewport});
  t.after(() => context.close());
  await context.route("**/*", route => route.request().url() === "https://mvp-test.invalid/"
    ? route.fulfill({contentType:"text/html",body:html}) : route.abort());
  const page = await context.newPage();
  await page.goto("https://mvp-test.invalid/");
  await page.addStyleTag({content:read("styles.css")});
  await page.evaluate(() => { window.__CATCHMIND_TEST__ = true; localStorage.setItem("omok_mute","1"); });
  await page.addScriptTag({content:read("catchmind-levels.js")});
  await page.addScriptTag({content:read("catchmind.js")});
  await page.evaluate(() => {
    document.querySelectorAll(".screen").forEach(el => el.classList.add("hidden"));
    document.getElementById("catchgame").classList.remove("hidden");
    window.testApi = {me:()=>({nick:"A"}),host:()=>"A",isHost:()=>false,
      roster:()=>["A","B","C"].map(nick=>({nick,catchLevel:12})),send(){},toast(){},
      loadMatchDrawings:async()=>{ window.loads++; return {ok:true,rows:[]}; },
      voteCatchmindMvp:async(matchId,nick)=>{ votes.push({matchId,nick});return {ok:true,vote:{ok:true}}; }};
    window.loads=0;window.votes=[];
    CatchMind.enter(testApi);
    window.round = (drawer, index, word, color) => ({
      protocol:2,matchId:"mvp-game",phase:"reveal",rev:index+1,roundIndex:index,
      queue:["A","B","C"],drawer,guessers:[],revealWord:word,drawSeq:index+1,
      canvasBg:"#ffffff",completedRounds:0,
      strokes:color?[{id:"stroke-"+index,tool:"pen",color,width:96,points:[{x:.2,y:.2},{x:.8,y:.8}]}]:[]
    });
    window.showVote = (matchId="mvp-game",queue=["A","B","C"]) => {
      const t=CatchMind._test;
      t.applyState({phase:"finished",rev:50,matchId,queue,roundIndex:queue.length,completedRounds:0},true);
      Object.assign(t.getLiveProgression(),{stage:"voting",matchId,deadline:Date.now()+15000});
      t.renderLiveMvp();
    };
  });
  return page;
}

test("MVP shows each participant's actual drawing and word; clicking a thumbnail votes", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    const t=CatchMind._test;
    t.applyState(round("B",0,"사과","#ff0000"),true);
    t.applyState(round("C",1,"바다","#0000ff"),true);
    showVote();
  });
  assert.equal(await page.locator(".cm-mvp-candidate").count(),2);
  assert.equal(await page.locator('[data-catch-mvp-nick="A"]').count(),0);
  assert.deepEqual(await page.locator(".cm-mvp-drawing-word").allTextContents(),["사과","바다"]);
  const pixels = await page.locator(".cm-mvp-thumbnail").evaluateAll(async images => Promise.all(images.map(async img => {
    await img.decode();const c=document.createElement("canvas");c.width=c.height=192;
    const ctx=c.getContext("2d");ctx.drawImage(img,0,0);return [...ctx.getImageData(96,96,1,1).data];
  })));
  assert.ok(pixels[0][0]>200 && pixels[0][2]<40,JSON.stringify(pixels));
  assert.ok(pixels[1][2]>200 && pixels[1][0]<40,JSON.stringify(pixels));
  assert.equal(await page.evaluate(() => loads),0,"cached drawings need no gallery request");
  await page.locator('[data-catch-mvp-nick="B"] img').click();
  assert.equal(await page.locator('[data-catch-mvp-nick="B"]').getAttribute("aria-pressed"),"true");
  await page.locator("#catch-level-mvp-confirm").click();
  await page.waitForFunction(() => votes.length===1);
  assert.deepEqual(await page.evaluate(() => votes),[{matchId:"mvp-game",nick:"B"}]);
});

test("reconnected voters load only this match and reject unrelated or unsafe image rows", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    testApi.loadMatchDrawings=async matchId=>{
      loads++;return {ok:true,rows:[
        {matchId:"old-game",drawer:"B",word:"옛 그림",imageUrl:"https://images.invalid/old.webp"},
        {matchId,drawer:"B",word:"이번 그림",imageUrl:"https://images.invalid/current.webp"},
        {matchId,drawer:"C",word:"잘못된 주소",imageUrl:"javascript:alert(1)"},
        {matchId,drawer:"관전자",word:"참가자 아님",imageUrl:"https://images.invalid/viewer.webp"}
      ]};
    };
    showVote();
  });
  await page.waitForFunction(() => document.querySelector('[data-catch-mvp-nick="B"] img'));
  assert.equal(await page.locator('[data-catch-mvp-nick="B"] img').getAttribute("src"),"https://images.invalid/current.webp");
  assert.equal(await page.locator('[data-catch-mvp-nick="B"] .cm-mvp-drawing-word').textContent(),"이번 그림");
  assert.equal(await page.locator('[data-catch-mvp-nick="C"] img').count(),0);
  await page.evaluate(() => { CatchMind._test.getLiveProgression().selection="C";CatchMind._test.renderLiveMvp(); });
  assert.equal(await page.evaluate(() => loads),1,"selection must not repeat the fetch");
});

test("late image responses cannot fill the next match with old drawings", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    testApi.loadMatchDrawings=matchId=>new Promise(resolve=>{ window.finishOld=()=>resolve({ok:true,rows:[{matchId,drawer:"B",word:"옛 그림",imageUrl:"https://images.invalid/old.webp"}]}); });
    showVote();
  });
  await page.waitForFunction(() => typeof finishOld === "function");
  await page.evaluate(async () => {
    testApi.loadMatchDrawings=async()=>({ok:true,rows:[]});
    showVote("next-game");finishOld();
    await new Promise(resolve=>setTimeout(resolve,20));
  });
  assert.equal(await page.locator(".cm-mvp-thumbnail").count(),0);
  assert.ok(!(await page.locator("#catch-level-mvp-candidates").textContent()).includes("옛 그림"));
});

test("a blank drawing is explicit and keeps its revealed word", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { CatchMind._test.applyState(round("B",0,"눈사람",null),true);showVote(); });
  assert.equal(await page.locator('[data-catch-mvp-nick="B"] .cm-mvp-drawing-empty').textContent(),"그린 그림 없음");
  assert.equal(await page.locator('[data-catch-mvp-nick="B"] .cm-mvp-drawing-word').textContent(),"눈사람");
});

test("reconnected voters retry while the last round's gallery upload finishes", async t => {
  const page=await pageFor(t);
  await page.evaluate(() => {
    testApi.loadMatchDrawings=async matchId=>({ok:true,rows:++loads===1?[]:[
      {matchId,drawer:"B",word:"늦게 저장된 그림",imageUrl:"https://images.invalid/late.webp"}
    ]});
    showVote("mvp-game",["A","B"]);
  });
  await page.waitForFunction(() => document.querySelector('[data-catch-mvp-nick="B"] img'));
  assert.equal(await page.evaluate(() => loads),2);
  assert.equal(await page.locator(".cm-mvp-drawing-word").textContent(),"늦게 저장된 그림");
});

test("many candidates scroll inside the dialog on small phones and short screens", async t => {
  for (const viewport of [{width:320,height:568},{width:740,height:360},{width:1280,height:900}]) {
    const page = await pageFor(t,viewport);
    await page.evaluate(() => showVote("large-game",["A",...Array.from({length:39},(_,i)=>"참가자"+i)]));
    const layout=await page.evaluate(() => {
      const dialog=document.querySelector(".cm-mvp-dialog").getBoundingClientRect();
      const button=document.getElementById("catch-level-mvp-confirm").getBoundingClientRect();
      const list=document.getElementById("catch-level-mvp-candidates");
      return {fits:dialog.x>=0&&dialog.y>=0&&dialog.right<=innerWidth&&dialog.bottom<=innerHeight,
        buttonVisible:button.bottom<=innerHeight,scrolls:list.scrollHeight>list.clientHeight,
        noHorizontalOverflow:list.scrollWidth<=list.clientWidth+1};
    });
    assert.deepEqual(layout,{fits:true,buttonVisible:true,scrolls:true,noHorizontalOverflow:true},JSON.stringify(viewport));
  }
});

async function showResult(page, result, options = {}) {
  await page.evaluate(({result, options}) => {
    const t = CatchMind._test;
    testApi.getCatchmindMvpResult = async () => ({ok:true, result});
    Object.assign(t.getLiveProgression(), {
      stage:"waiting", matchId:"mvp-game", requestPending:false,
      deadline:options.expired ? Date.now()-6000 : Date.now()+15000,
      award:{beforeXp:100, appliedXp:27,
        breakdown:{completion:15, answers:12, mvp:0},
        metrics:{answerTimesMs:[12000], answerXp:[12], mvp:false}}
    });
    t.pollLiveMvp();
  }, {result, options});
  await page.waitForFunction(() => CatchMind._test.getLiveProgression().stage === "result");
}

test("XP results name another player's MVP and keep the viewer's XP unchanged", async t => {
  const page = await pageFor(t);
  await showResult(page, {status:"finalized", winner:"B", votes:3, appliedXp:15});
  assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), "B");
  assert.equal(await page.locator("#catch-level-xp-mvp-detail").textContent(), "3표 · 이번 게임의 MVP로 선정됐어요");
  assert.equal(await page.locator("#catch-level-xp-earned").textContent(), "+27 XP");
  assert.equal(await page.locator("#catch-level-xp-mvp.has-winner").count(), 1);
  assert.equal(await page.locator("#catch-level-xp-backdrop").getAttribute("aria-hidden"), "false");
});

test("the MVP sees their own name and bonus in the final XP popup", async t => {
  const page = await pageFor(t);
  await showResult(page, {status:"finalized", winner:"A", votes:2, appliedXp:15});
  assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), "A (나)");
  assert.equal(await page.locator("#catch-level-xp-earned").textContent(), "+42 XP");
  assert.match(await page.locator("#catch-level-xp-breakdown").textContent(), /MVP 보너스.*\+15 XP/);
});

test("XP popup follows the server's chosen winner and distinguishes no votes from a failed lookup", async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { CatchMind._test.getLiveProgression().selection="B"; });
  await showResult(page, {status:"finalized", winner:"C", votes:1, appliedXp:15});
  assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), "C");
  await showResult(page, {status:"no_votes"});
  assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), "선정된 MVP가 없어요");
  assert.equal(await page.locator("#catch-level-xp-mvp.has-winner").count(), 0);
  await showResult(page, {status:"error"}, {expired:true});
  assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), "MVP 결과를 확인하지 못했어요");
  assert.ok(!(await page.locator("#catch-level-xp-mvp-detail").textContent()).includes("투표가 없어"));
});

test("MVP names stay readable and XP popup buttons remain accessible on small screens", async t => {
  for (const viewport of [{width:320,height:568},{width:740,height:360}]) {
    const page = await pageFor(t, viewport);
    const winner = "아주긴닉네임".repeat(6);
    await showResult(page, {status:"finalized", winner, votes:2, appliedXp:15});
    assert.equal(await page.locator("#catch-level-xp-mvp-name").textContent(), winner);
    const layout = await page.evaluate(() => {
      const dialog=document.querySelector(".cm-xp-dialog");
      const rect=dialog.getBoundingClientRect();
      const button=document.getElementById("catch-level-xp-confirm").getBoundingClientRect();
      const scroll=document.querySelector(".cm-xp-scroll");
      return {fits:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
        buttonVisible:button.bottom<=innerHeight,noHorizontalOverflow:scroll.scrollWidth<=scroll.clientWidth+1};
    });
    assert.deepEqual(layout, {fits:true,buttonVisible:true,noHorizontalOverflow:true});
  }
});
