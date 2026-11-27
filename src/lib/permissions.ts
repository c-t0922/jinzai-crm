/** 権限定義（docs/06_permission_matrix.md）。画面・API で同じ定義を使う。DB は RLS / RPC で再チェックする。 */
export const ROLES = ["admin", "pm", "team_leader", "caller", "career_advisor", "executive"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "システム管理者",
  pm: "PM・事業責任者",
  team_leader: "チームリーダー",
  caller: "架電担当者",
  career_advisor: "キャリアアドバイザー",
  executive: "経営陣",
};

export type Permission =
  | "dashboard.view"
  | "callcenter.use"
  | "contacts.view"
  | "contacts.viewAllPhones"
  | "contacts.export"
  | "contacts.bulk"
  | "calllists.manage"
  | "appointments.view"
  | "talent.view"
  | "revenue.view"
  | "analytics.view"
  | "admin.view"
  | "admin.users"
  | "admin.integrations"
  | "admin.rules"
  | "admin.consents"
  | "admin.goals"
  | "admin.scripts"
  | "admin.teams"
  | "admin.audit"
  | "suppression.release"
  | "consent.bulk";

const MATRIX: Record<Permission, Role[]> = {
  "dashboard.view": ["admin", "pm", "team_leader", "caller", "career_advisor", "executive"],
  "callcenter.use": ["admin", "pm", "team_leader", "caller"],
  "contacts.view": ["admin", "pm", "team_leader", "caller", "career_advisor"],
  "contacts.viewAllPhones": ["admin", "pm", "team_leader", "career_advisor"],
  "contacts.export": ["admin", "pm"],
  "contacts.bulk": ["admin", "pm", "team_leader"],
  "calllists.manage": ["admin", "pm", "team_leader"],
  "appointments.view": ["admin", "pm", "team_leader", "caller", "career_advisor"],
  "talent.view": ["admin", "pm", "career_advisor"],
  "revenue.view": ["admin", "pm", "career_advisor", "executive"],
  "analytics.view": ["admin", "pm", "team_leader", "caller", "career_advisor", "executive"],
  "admin.view": ["admin", "pm"],
  "admin.users": ["admin"],
  "admin.integrations": ["admin"],
  "admin.rules": ["admin", "pm"],
  "admin.consents": ["admin", "pm"],
  "admin.goals": ["admin", "pm"],
  "admin.scripts": ["admin", "pm"],
  "admin.teams": ["admin", "pm"],
  "admin.audit": ["admin", "pm"],
  "suppression.release": ["admin"],
  "consent.bulk": ["admin"],
};

export function can(roles: readonly Role[], perm: Permission) {
  return roles.some((r) => MATRIX[perm].includes(r));
}

/** 兼務は権限の和集合。管理者・PM は MFA 必須 */
export function requiresMfa(roles: readonly Role[]) {
  return roles.includes("admin") || roles.includes("pm");
}
