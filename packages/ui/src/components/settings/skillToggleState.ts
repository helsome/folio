/**
 * Optimistic toggle state transition (pure — unit-tested).
 *
 * The Skills view flips a skill's `enabled` flag before the IPC call returns
 * (optimistic update) and flips it back on failure (rollback). This single
 * transition serves both directions because the flip is its own inverse.
 */
export function flipSkillEnabled<T extends { id: string; enabled: boolean }>(
  items: T[],
  skillId: string
): T[] {
  return items.map((item) =>
    item.id === skillId ? { ...item, enabled: !item.enabled } : item
  );
}
