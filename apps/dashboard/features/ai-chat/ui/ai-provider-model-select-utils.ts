export interface ProviderModelSelectOption {
  value: string;
  label: string;
  groupLabel: string;
}

export interface ProviderModelOptionGroup {
  groupLabel: string;
  options: { value: string; label: string }[];
}

/**
 * Collapse a flat list of `{ value, label, groupLabel }` options into ordered
 * groups for a grouped `<Select>`. Each group keeps its first-seen position and
 * the original option order within it.
 */
export function groupProviderModelOptions(
  options: ProviderModelSelectOption[],
): ProviderModelOptionGroup[] {
  const groups: ProviderModelOptionGroup[] = [];
  const byLabel = new Map<string, ProviderModelOptionGroup>();

  for (const { value, label, groupLabel } of options) {
    let group = byLabel.get(groupLabel);
    if (!group) {
      group = { groupLabel, options: [] };
      byLabel.set(groupLabel, group);
      groups.push(group);
    }
    group.options.push({ value, label });
  }

  return groups;
}
