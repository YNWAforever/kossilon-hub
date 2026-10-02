export async function readSnapshotMembership(
  snapshotId: string,
  ids: string[],
  read: (input: { data: { snapshotId: string; ids: string[] } }) => Promise<{ ids: string[] }>,
) {
  const unique = [...new Set(ids)];
  const allowed = new Set<string>();
  for (let start = 0; start < unique.length; start += 5000) {
    const chunk = unique.slice(start, start + 5000);
    const result = await read({ data: { snapshotId, ids: chunk } });
    const actual = new Set(result.ids);
    for (const id of chunk) if (actual.has(id)) allowed.add(id);
  }
  return { ids: unique.filter((id) => allowed.has(id)) };
}
