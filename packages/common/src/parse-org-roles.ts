export function parseOrgRoles(roleField: string): string[] {
  return roleField
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
