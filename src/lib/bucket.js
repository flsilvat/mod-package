// Helpers for material "buckets" — the aggregated set of parts that a
// configuration implies, plus counts for the kits inside it.

import { collectRefDescendants } from './drawings';

// Does a drawing apply to the given SB config?
// An empty or missing sbConfigIds means the drawing applies to ALL configs
// of its bulletin — you only tag the exceptions.
export function drawingAppliesToConfig(drawing, configId) {
  const ids = drawing?.sbConfigIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.includes(configId);
}

// The bucket for one SB config: the parent bulletin's own materials, plus
// the materials of every referenced drawing that applies to this config —
// following drawing-to-drawing references all the way down. Returns an
// aggregated list of { materialId, qty }, sorted by part number. Kits are
// left whole; their contents are not exploded here.
export function computeConfigBucket(config, { sb, drawingById, materialById }) {
  const totals = new Map(); // materialId -> summed qty

  function addLink(link) {
    if (!link || !link.materialId) return;
    const qty = Number(link.qty) || 0;
    if (qty <= 0) return;
    totals.set(link.materialId, (totals.get(link.materialId) || 0) + qty);
  }

  // 1. the bulletin's own materials
  if (sb && Array.isArray(sb.materials)) sb.materials.forEach(addLink);

  // 2. every applicable drawing, plus its whole reference tree — collected
  //    into one set first so a shared drawing is never counted twice
  const contributing = new Set();
  if (sb && Array.isArray(sb.drawingIds)) {
    for (const drawingId of sb.drawingIds) {
      const drawing = drawingById.get(drawingId);
      if (!drawing || !drawingAppliesToConfig(drawing, config.id)) continue;
      collectRefDescendants(drawingId, drawingById, contributing);
    }
  }
  for (const drawingId of contributing) {
    const drawing = drawingById.get(drawingId);
    if (drawing && Array.isArray(drawing.materials)) {
      drawing.materials.forEach(addLink);
    }
  }

  // 3. aggregated lines, sorted by part number
  const lines = [];
  for (const [materialId, qty] of totals) lines.push({ materialId, qty });
  lines.sort((a, b) => {
    const pa = materialById.get(a.materialId)?.partNumber || '';
    const pb = materialById.get(b.materialId)?.partNumber || '';
    return pa.localeCompare(pb);
  });
  return lines;
}

// Recursively tally what a kit holds: total leaf parts (quantity-aware) and
// how many nested subkit instances sit inside it.
export function kitTally(kitId, materialById, seen = new Set()) {
  const result = { parts: 0, subkits: 0 };
  if (seen.has(kitId)) return result; // guard against a bad cycle
  const kit = materialById.get(kitId);
  if (!kit || !kit.isKit || !Array.isArray(kit.components)) return result;
  const nextSeen = new Set(seen);
  nextSeen.add(kitId);
  for (const comp of kit.components) {
    const qty = Number(comp.qty) || 0;
    if (qty <= 0) continue;
    const child = materialById.get(comp.materialId);
    const childIsKit =
      child?.isKit &&
      Array.isArray(child.components) &&
      child.components.length > 0;
    if (childIsKit) {
      result.subkits += qty;
      const inner = kitTally(comp.materialId, materialById, nextSeen);
      result.parts += inner.parts * qty;
      result.subkits += inner.subkits * qty;
    } else {
      result.parts += qty;
    }
  }
  return result;
}
