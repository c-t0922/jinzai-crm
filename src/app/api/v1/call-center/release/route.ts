import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";

/** ページ離脱時（sendBeacon）の架電ロック解放 */
export async function POST(req: Request) {
  const body = z.object({ contactId: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  await supabase.rpc("cc_release", { p_contact: body.data.contactId });
  return new Response(null, { status: 204 });
}
