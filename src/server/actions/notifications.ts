"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/server/repositories/notifications";

export async function markNotificationsRead() {
  const { ctx } = await requireOrgContext();
  await markAllNotificationsRead(ctx);
  revalidatePath("/", "layout");
}
