import { parseOrgRoles } from "@workspace/common";
import { orgRoles, type OrgRoleId } from "./index";

export function memberRoleFieldHasPermission(
  roleField: string,
  required: Record<string, string[]>,
): boolean {
  const ids = parseOrgRoles(roleField);
  return ids.some((id) => {
    const role = orgRoles[id as OrgRoleId];
    return role?.authorize(required).success === true;
  });
}
