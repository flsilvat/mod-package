// Helpers for the recursive HTL tree.
//
// An HTL holds an ordered `children` list — each entry is { type, id } where
// type is 'gtl' or 'htl'. HTL children can themselves contain HTLs, so the
// tree is recursive; these walk it and stop an HTL from containing itself.

// Every HTL id reachable from `startId` (including itself), following only
// the 'htl'-typed children. `seen` is the result and a guard against a
// pre-existing bad cycle in the data.
export function collectHtlDescendants(startId, byId, seen = new Set()) {
  if (seen.has(startId)) return seen;
  seen.add(startId);
  const htl = byId.get(startId);
  if (htl && Array.isArray(htl.children)) {
    for (const child of htl.children) {
      if (child && child.type === 'htl') {
        collectHtlDescendants(child.id, byId, seen);
      }
    }
  }
  return seen;
}

// True if making `htlId` contain `candidateId` would create a loop — either
// they are the same HTL, or the candidate already contains the HTL below it.
export function wouldHtlCycle(htlId, candidateId, byId) {
  if (htlId === candidateId) return true;
  return collectHtlDescendants(candidateId, byId).has(htlId);
}
