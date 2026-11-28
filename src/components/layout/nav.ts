import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; icon: string; perm: Permission; phase?: number };
export type NavGroup = { label: string; items: NavItem[] };

/** サイドバー構成（指示書 04）。phase が 1 より大きいものは「準備中」表示 */
export const NAV: NavGroup[] = [
  {
    label: "メイン",
    items: [
      { href: "/dashboard", label: "ダッシュボード", icon: "LayoutDashboard", perm: "dashboard.view" },
      { href: "/call-center", label: "架電センター", icon: "PhoneCall", perm: "callcenter.use" },
      { href: "/contacts", label: "顧客一覧", icon: "Users", perm: "contacts.view" },
      { href: "/call-lists", label: "架電リスト管理", icon: "ListChecks", perm: "calllists.manage" },
      { href: "/appointments", label: "アポイント管理", icon: "CalendarCheck", perm: "appointments.view" },
      { href: "/calendar", label: "カレンダー", icon: "CalendarDays", perm: "appointments.view" },
      { href: "/tasks", label: "タスク管理", icon: "CheckSquare", perm: "appointments.view" },
    ],
  },
  {
    label: "人材事業管理",
    items: [
      { href: "/candidates", label: "求職者管理", icon: "UserRound", perm: "talent.view", phase: 3 },
      { href: "/interviews", label: "キャリア面談管理", icon: "MessagesSquare", perm: "talent.view", phase: 3 },
      { href: "/jobs", label: "求人管理", icon: "Briefcase", perm: "talent.view", phase: 3 },
      { href: "/companies", label: "企業管理", icon: "Building2", perm: "talent.view", phase: 3 },
      { href: "/applications", label: "選考進捗管理", icon: "KanbanSquare", perm: "talent.view", phase: 3 },
      { href: "/placements", label: "成約・売上管理", icon: "JapaneseYen", perm: "revenue.view", phase: 3 },
    ],
  },
  {
    label: "分析",
    items: [
      { href: "/analytics/sales", label: "営業分析", icon: "LineChart", perm: "analytics.view" },
      { href: "/analytics/members", label: "担当者別実績", icon: "Trophy", perm: "analytics.view" },
      { href: "/analytics/lists", label: "リスト別分析", icon: "ListOrdered", perm: "analytics.view" },
      { href: "/analytics/hours", label: "時間帯別分析", icon: "Clock", perm: "analytics.view" },
      { href: "/analytics/sources", label: "流入経路別分析", icon: "Route", perm: "analytics.view" },
    ],
  },
  {
    label: "管理者設定",
    items: [
      { href: "/admin/users", label: "ユーザー管理", icon: "UserCog", perm: "admin.users" },
      { href: "/admin/teams", label: "チーム管理", icon: "UsersRound", perm: "admin.teams" },
      { href: "/admin/goals", label: "KPI目標設定", icon: "Target", perm: "admin.goals" },
      { href: "/admin/import", label: "顧客CSV取り込み", icon: "Upload", perm: "admin.integrations" },
      { href: "/admin/kintone", label: "kintone連携", icon: "Database", perm: "admin.integrations", phase: 2 },
      { href: "/admin/lp", label: "LP連携", icon: "Globe", perm: "admin.integrations", phase: 4 },
      { href: "/admin/cti", label: "CTI連携", icon: "Headphones", perm: "admin.integrations", phase: 2 },
      { href: "/admin/scripts", label: "トークスクリプト管理", icon: "FileText", perm: "admin.scripts" },
      { href: "/admin/call-rules", label: "架電ルール設定", icon: "SlidersHorizontal", perm: "admin.rules" },
      { href: "/admin/consents", label: "個人情報・利用許諾管理", icon: "ShieldCheck", perm: "admin.consents" },
      { href: "/admin/audit-logs", label: "操作ログ", icon: "ScrollText", perm: "admin.audit" },
    ],
  },
];
