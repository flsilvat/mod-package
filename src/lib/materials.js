// Helpers for the Materials entity.
//
// A material may be a "kit" — it then has a `components` array of
// { materialId, qty }, and each referenced material may itself be a kit.
// These functions walk that tree and stop kits from containing themselves.

// Every material id reachable from `startId` (including itself), following
// kit components. `seen` doubles as the result and as a guard against any
// pre-existing bad cycle in the data.
export function collectDescendants(startId, byId, seen = new Set()) {
  if (seen.has(startId)) return seen;
  seen.add(startId);
  const material = byId.get(startId);
  if (material?.isKit && Array.isArray(material.components)) {
    for (const component of material.components) {
      collectDescendants(component.materialId, byId, seen);
    }
  }
  return seen;
}

// True if putting `candidateId` inside kit `kitId` would create a loop —
// either because they are the same material, or because the candidate
// already contains the kit somewhere below it.
export function wouldCreateCycle(kitId, candidateId, byId) {
  if (kitId === candidateId) return true;
  return collectDescendants(candidateId, byId).has(kitId);
}
