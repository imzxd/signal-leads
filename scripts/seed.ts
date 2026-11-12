/**
 * pnpm db:seed — create the Evergreen Roofing demo organization if it doesn't exist.
 * Against Supabase, pass the auth user id that should own it: pnpm db:seed -- --owner <uuid>
 */
import { getDatabaseHandle } from "../src/server/db/client";
import { ensureDemoOrganization, seedDemoOrganization } from "../src/server/seed/demo";
import { DEMO_ORG_SLUG } from "../src/server/seed/demo-config";

const ownerFlag = process.argv.indexOf("--owner");
const owner = ownerFlag > -1 ? process.argv[ownerFlag + 1] : undefined;

const handle = await getDatabaseHandle();
const id = owner
  ? await seedDemoOrganization(handle.db, { slug: `${DEMO_ORG_SLUG}-${owner.slice(0, 8)}`, ownerUserId: owner, ownerName: "Demo Owner", ownerEmail: "owner@example.com" })
  : await ensureDemoOrganization(handle.db);
console.log(`Demo organization ready: ${id}`);
await handle.close();
