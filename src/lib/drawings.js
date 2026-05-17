// Helpers for drawing-to-drawing references.
//
// A drawing may reference other drawings via `refDrawingIds`, and each of
// those may reference more — a tree. These walk that tree and stop a drawing
// from referencing itself, directly or through a loop.

// Every drawing id reachable from `startId` (including itself), following
// references. `seen` is both the result and a guard against a pre-existing
// bad cycle in the data.
export function collectRefDescendants(startId, byId, seen = new Set()) {
  if (seen.has(startId)) return seen;
  seen.add(startId);
  const drawing = byId.get(startId);
  if (drawing && Array.isArray(drawing.refDrawingIds)) {
    for (const refId of drawing.refDrawingIds) {
      collectRefDescendants(refId, byId, seen);
    }
  }
  return seen;
}

// True if making `drawingId` reference `candidateId` would create a loop —
// either they are the same drawing, or the candidate already references the
// drawing somewhere below it.
export function wouldRefCycle(drawingId, candidateId, byId) {
  if (drawingId === candidateId) return true;
  return collectRefDescendants(candidateId, byId).has(drawingId);
}
