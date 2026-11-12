/** Dev utility: print a lead's timeline, messages and follow-ups. Usage: pnpm exec tsx scripts/inspect-lead.ts "Lead Name" */
import { getDatabaseHandle } from "../src/server/db/client";

const h = await getDatabaseHandle();
const name = process.argv[2] ?? "Victor Nguyen";
const lead = (await h.raw.query(`select id, stage, score, temperature, next_action, summary, service_key, intent from leads where name = $1`, [name]))[0];
console.log(lead);
const ev = await h.raw.query(`select actor_label, title, detail, receipt from agent_events where lead_id = $1 order by created_at`, [lead.id]);
for (const e of ev) console.log("-", e.actor_label, "|", e.title, e.receipt ? JSON.stringify(e.receipt) : "");
const msgs = await h.raw.query(`select direction, status, body, block_reason from messages where lead_id = $1 order by created_at`, [lead.id]);
for (const m of msgs) console.log(`  [${m.direction}/${m.status}${m.block_reason ? "/" + m.block_reason : ""}]`, String(m.body).slice(0, 300));
const fu = await h.raw.query(`select sequence_number, status, scheduled_for, cancel_reason from follow_ups where lead_id = $1 order by sequence_number`, [lead.id]);
console.log(fu);
await h.close();


