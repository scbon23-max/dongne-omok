// Offline PostgreSQL validation: node tests/holdem-sql-audit.cjs <PGlite package directory>
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(path.resolve(process.argv[2]));
const migrations = path.join(__dirname, "../supabase/migrations");
function originalFunction(file, name) {
  const source = fs.readFileSync(path.join(migrations, file), "utf8");
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table accounts(nickname text primary key);
      create table holdem_wallets(nickname text primary key, balance bigint default 100000, updated_at timestamptz);
      create table holdem_tables(room_id text primary key, owner_nickname text, state jsonb, version bigint, created_at timestamptz, updated_at timestamptz);
      create table holdem_economy_events(event_type text, nickname text, amount bigint, room_id text, hand_no bigint, table_version bigint);
      create table holdem_hand_results(room_id text, hand_no bigint, nickname text, session_date date, small_blind bigint, big_blind bigint, net_amount bigint, won_amount bigint, is_winner boolean, revealed boolean, hand_name text, hand_category integer, table_version bigint, created_at timestamptz default now(), unique(room_id,hand_no,nickname));
    `);
    await db.exec(originalFunction("202607270001_holdem_wallets_and_buyins.sql", "holdem_ring_table_compare_and_swap"));
    await db.exec(originalFunction("202607280002_holdem_economy_v3.sql", "holdem_ring_table_v3_compare_and_swap"));
    await db.exec(originalFunction("202607280003_holdem_session_history.sql", "holdem_ring_table_v4_compare_and_swap"));
    const migration = fs.readFileSync(path.join(migrations, "202609080002_holdem_audit_fixes.sql"), "utf8");
    await db.exec(migration); await db.exec(migration); // Reapplying is safe.
    const adjustments = Array.from({ length: 8 }, (_, i) => ({ nickname: `player${i}`, delta: -100 }));
    const hands = adjustments.map(p => ({ nickname: p.nickname, hand_no: 1, small_blind: 200, big_blind: 400, net_amount: 0, won_amount: 0, is_winner: false, revealed: false, hand_name: "", hand_category: -1 }));
    const cas = (version, records = hands) => db.query("select * from holdem_ring_table_v4_compare_and_swap($1,$2,$3,$4,$5,$6,$7)", ["eight", version, { phase: "hand_end", seats: [] }, "player0", adjustments, [], records]);
    assert.equal((await cas(0)).rows[0].applied, true);
    assert.equal(Number((await db.query("select count(*) n from holdem_hand_results where room_id='eight'")).rows[0].n), 8);
    assert.equal(Number((await db.query("select sum(balance) n from holdem_wallets")).rows[0].n), 799200);
    assert.equal((await cas(0)).rows[0].reason, "conflict");
    assert.equal(Number((await db.query("select sum(balance) n from holdem_wallets")).rows[0].n), 799200);
    await assert.rejects(cas(1, [...hands, { ...hands[0], nickname: "ninth" }]), /invalid holdem hand result/);
    await db.exec(`
      insert into accounts values ('audit'),('new-wallet');
      insert into holdem_wallets(nickname,balance) values ('audit',10000);
      insert into holdem_hand_results(room_id,hand_no,nickname,net_amount,created_at)
        select 'daily', n, 'audit', 100, '2026-09-08T00:00:00Z'::timestamptz from generate_series(1,1001) n;
      insert into holdem_hand_results(room_id,hand_no,nickname,net_amount,created_at) values
        ('before',1,'audit',999900,'2026-09-07T14:59:59Z'),('after',1,'audit',999900,'2026-09-08T15:00:00Z');
      insert into holdem_tables(room_id,state)
        select 'table-' || n, '{"settings":{"mode":"ring","assetBacked":true},"phase":"waiting","seats":[]}'::jsonb from generate_series(1,501) n;
      update holdem_tables set state=jsonb_set(state,'{seats}','[{"nick":"audit","stack":20000,"totalBet":5000}]') where room_id='table-501';
    `);
    const net = await db.query("select holdem_today_net_by_nickname($1,$2,$3) result", [["audit"], "2026-09-07T15:00:00Z", "2026-09-08T15:00:00Z"]);
    assert.equal(net.rows[0].result.audit, 100100);
    const assets = () => db.query("select holdem_profile_asset('audit') result");
    assert.equal((await assets()).rows[0].result.totalAssets, 30000);
    await db.exec("update holdem_tables set state=jsonb_set(state,'{phase}','\"flop\"') where room_id='table-501'");
    assert.equal((await assets()).rows[0].result.totalAssets, 35000);
    await db.exec("update holdem_tables set state=jsonb_set(state,'{seats,0,isBot}','true') where room_id='table-501'");
    assert.equal((await assets()).rows[0].result.totalAssets, 10000);
    assert.equal((await db.query("select holdem_profile_asset('new-wallet') result")).rows[0].result.totalAssets, 100000);
    assert.equal((await db.query("select holdem_profile_asset('missing') result")).rows[0].result, null);
    assert.equal(Number((await db.query("select count(*) n from holdem_wallets where nickname='new-wallet'")).rows[0].n), 0);
    console.log("PASS: SQL migration/reapply, eight-player settlement/debits, conflict idempotency, ninth-player rejection, 1001 daily results/time boundaries, 501 tables/active bets/bots, read-only wallet defaults.");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
