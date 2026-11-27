/**
 * 検索性能の確認（docs/12_test_plan.md「大量データ検索」：25万件で P95 < 2 秒）。ローカル DB 専用。
 * 実行：pnpm tsx --env-file=.env.local scripts/perf-search.ts
 */
import { Client } from "pg";

const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("ローカル DB に対してのみ実行できます");

const CASES: [string, string, Record<string, unknown>][] = [
  ["一覧（新しい順・先頭50件）", "pm@example.test", { sort: "created_desc" }],
  ["氏名の部分一致", "pm@example.test", { q: "田中" }],
  ["カナの部分一致", "pm@example.test", { q: "ヨウコ" }],
  ["電話番号（下4桁）", "pm@example.test", { phone: "1234" }],
  ["複合条件（エリア＋許諾＋未架電）", "pm@example.test", { filter: { op: "and", rules: [
    { field: "area_pref", operator: "in", value: ["東京都", "神奈川県"] },
    { field: "consent_status", operator: "in", value: ["granted"] },
    { field: "call_count", operator: "eq", value: 0 },
  ] }, sort: "inquiry_desc" }],
  ["架電担当（自分の担当のみ・RLS）", "caller01@example.test", { sort: "last_called_desc" }],
];

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  console.log("顧客件数:", (await c.query("select count(*) from contacts")).rows[0].count);
  for (const [label, email, p] of CASES) {
    const [{ id }] = (await c.query("select id from auth.users where email = $1", [email])).rows;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const t = performance.now();
      await c.query("select contacts_search($1)", [p]);
      times.push(performance.now() - t);
      await c.query("rollback");
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95) - 1];
    console.log(`${p95 < 2000 ? "OK " : "NG "} ${label.padEnd(24, "　")} P50 ${times[10].toFixed(0)}ms / P95 ${p95.toFixed(0)}ms`);
  }
  await c.end();
}
main();
