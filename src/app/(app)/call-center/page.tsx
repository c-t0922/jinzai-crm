import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCtiProvider } from "@/server/integrations/cti";
import { CallCenter } from "@/features/call-center/call-center";
import type { ResultMaster } from "@/lib/call-result";

export const metadata: Metadata = { title: "架電センター" };

export default async function CallCenterPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  await requireUser("callcenter.use");
  const sp = await searchParams;
  const supabase = await createSupabaseServer();
  const [masters, scripts, advisors, hours] = await Promise.all([
    supabase.from("call_result_masters").select("*").eq("active", true).neq("code", "not_called").order("sort_order"),
    supabase.from("scripts").select("id,title,body").eq("active", true).order("created_at"),
    supabase.from("user_roles").select("user_id, users!inner(id,name,status)").eq("role", "career_advisor"),
    supabase.from("call_rules").select("value").eq("key", "calling_hours").maybeSingle(),
  ]);
  const cti = getCtiProvider();
  const advisorList = (advisors.data ?? [])
    .map((r) => (Array.isArray(r.users) ? r.users[0] : r.users) as { id: string; name: string; status: string })
    .filter((u) => u?.status === "active")
    .map((u) => ({ id: u.id, name: u.name }));

  return (
    <CallCenter
      masters={(masters.data ?? []) as ResultMaster[]}
      scripts={scripts.data ?? []}
      advisors={advisorList}
      ctiMode={cti.name}
      isDemo={cti.isDemo}
      callingHours={hours.data?.value as { enforce: boolean; days: number[]; start: string; end: string } | undefined}
      initialContactId={sp.contact}
    />
  );
}
