// Helpers for material "buckets" — the aggregated set of parts that a
// configuration implies, plus counts and reconciliation against the actual
// material allocations on operations.

import { collectRefDescendants } from './drawings';

// Does a drawing apply to the given SB config?
// Drawings now point to their configs explicitly via sbConfigIds. An empty
// or missing list means the drawing is not linked to any config — it's
// effectively orphaned until an admin re-links it.
export function drawingAppliesToConfig(drawing, configId) {
  const ids = drawing?.sbConfigIds;
  if (!Array.isArray(ids) || ids.length === 0) return false;
  return ids.includes(configId);
}

// Every drawing applicable to a given config, expanded recursively through
// refDrawingIds. Returns drawing documents sorted by docNumber. Used by the
// per-config drawing bucket on the SB page and the Drawings section on the
// TO Part view.
export function collectDrawingsForConfig(configId, { drawingById }) {
  const ids = new Set();
  for (const drawing of drawingById.values()) {
    if (!drawingAppliesToConfig(drawing, configId)) continue;
    collectRefDescendants(drawing.id, drawingById, ids);
  }
  const out = [];
  for (const id of ids) {
    const d = drawingById.get(id);
    if (d) out.push(d);
  }
  out.sort((a, b) =>
    (a.docNumber || '').localeCompare(b.docNumber || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
  return out;
}

// The bucket for one SB config: the parent bulletin's own materials, plus
// the materials of every drawing applicable to this config — following
// drawing-to-drawing references all the way down. Returns an aggregated list
// of { materialId, qty }, sorted by part number. Kits are left whole; their
// contents are not exploded here.
export function computeConfigBucket(config, { sb, drawingById, materialById }) {
  const totals = new Map();

  function addLink(link) {
    if (!link || !link.materialId) return;
    const qty = Number(link.qty) || 0;
    if (qty <= 0) return;
    totals.set(link.materialId, (totals.get(link.materialId) || 0) + qty);
  }

  if (sb && Array.isArray(sb.materials)) sb.materials.forEach(addLink);

  // Reverse lookup: walk all drawings and keep those tied to this config,
  // then recurse through their refs.
  const contributing = new Set();
  for (const drawing of drawingById.values()) {
    if (!drawingAppliesToConfig(drawing, config.id)) continue;
    collectRefDescendants(drawing.id, drawingById, contributing);
  }
  for (const drawingId of contributing) {
    const drawing = drawingById.get(drawingId);
    if (drawing && Array.isArray(drawing.materials)) {
      drawing.materials.forEach(addLink);
    }
  }

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
  if (seen.has(kitId)) return result;
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

// All kit material ids reachable from `kitId`, including itself. Used when
// reconciling: a fromKitId tag is "inside this bucket kit" if it falls in
// the kit's tree.
export function collectKitTree(kitId, materialById, seen = new Set()) {
  if (seen.has(kitId)) return seen;
  const m = materialById.get(kitId);
  if (!m?.isKit || !Array.isArray(m.components)) return seen;
  seen.add(kitId);
  for (const comp of m.components) {
    const child = materialById.get(comp.materialId);
    if (child?.isKit) collectKitTree(comp.materialId, materialById, seen);
  }
  return seen;
}

// Every kit that has `materialId` as a direct component. Used to populate
// the "from kit" picker when assigning a material to an operation.
export function findKitsContaining(materialId, materials) {
  const list = [];
  for (const m of materials) {
    if (
      m?.isKit &&
      Array.isArray(m.components) &&
      m.components.some((c) => c.materialId === materialId)
    ) {
      list.push(m);
    }
  }
  return list;
}

// Reconcile a bucket (list of { materialId, qty }) against operation
// material entries — each entry shaped like:
//   { materialId, qty, fromKitId?, opId }
// Returns { lines, extras } where each line carries its reconciled state
// and (for cracked kits) a recursive sub-line tree.
//
// `alternatesMap` (optional) — materialId -> Set of materialIds in the same
// interchange group (including itself). When provided, an entry counts
// toward a bucket line if its materialId matches the line's materialId OR
// any of its interchangeable alternates.
//
// Possible per-line `state` values:
//   'untouched' — nothing has been distributed for this line
//   'short'     — partially distributed
//   'complete'  — distributed exactly equals required (for kits = "whole")
//   'over'      — more distributed than required
//   'cracked'   — the kit has been opened; sub-lines carry the detail
//   'mixed'     — kit has both whole and cracked assignments (inconsistent)
export function reconcileBucket(bucket, entries, materialById, alternatesMap) {
  const lines = bucket.map((line) =>
    reconcileDemand({
      materialId: line.materialId,
      requiredQty: line.qty,
      fromKitContext: null,
      entries,
      materialById,
      alternatesMap,
    })
  );

  // Any entry that wasn't claimed by some demand (top-level or sub-) is an
  // "extra" — material on an operation that the bucket doesn't ask for.
  const matched = new Set();
  collectMatchedEntries(lines, matched);
  const extras = entries.filter((e) => !matched.has(e));

  return { lines, extras };
}

function reconcileDemand({
  materialId,
  requiredQty,
  fromKitContext,
  entries,
  materialById,
  alternatesMap,
}) {
  const m = materialById.get(materialId);
  const isKit =
    !!m?.isKit && Array.isArray(m.components) && m.components.length > 0;

  // Acceptable materialIds for satisfying this demand at this context:
  // the line's own materialId plus any interchangeable alternates.
  const acceptable =
    alternatesMap?.get(materialId) || new Set([materialId]);

  // Whole/loose match: entries with an acceptable materialId, at this
  // fromKitContext (null for top-level lines, parent kit id for nested).
  const wholeMatches = entries.filter(
    (e) =>
      acceptable.has(e.materialId) &&
      (e.fromKitId || null) === (fromKitContext || null)
  );
  const distributedWhole = wholeMatches.reduce(
    (sum, e) => sum + (Number(e.qty) || 0),
    0
  );

  if (!isKit) {
    return {
      materialId,
      requiredQty,
      fromKitContext,
      isKit: false,
      state: stateFor(distributedWhole, requiredQty),
      distributedWhole,
      distributions: wholeMatches,
      crackedSub: null,
    };
  }

  // Kit — detect cracking. Cracked if any entry has fromKitId anywhere
  // in this kit's tree (including itself).
  const kitTree = collectKitTree(materialId, materialById);
  const isCracked = entries.some(
    (e) => e.fromKitId && kitTree.has(e.fromKitId)
  );

  if (isCracked && distributedWhole > 0) {
    return {
      materialId,
      requiredQty,
      fromKitContext,
      isKit: true,
      state: 'mixed',
      distributedWhole,
      distributions: wholeMatches,
      crackedSub: null,
    };
  }

  if (!isCracked) {
    return {
      materialId,
      requiredQty,
      fromKitContext,
      isKit: true,
      state: stateFor(distributedWhole, requiredQty),
      distributedWhole,
      distributions: wholeMatches,
      crackedSub: null,
    };
  }

  // Cracked: recurse into the direct components, scaled by required qty.
  const components = m.components || [];
  const crackedSub = components.map((comp) =>
    reconcileDemand({
      materialId: comp.materialId,
      requiredQty: (Number(comp.qty) || 0) * requiredQty,
      fromKitContext: materialId,
      entries,
      materialById,
      alternatesMap,
    })
  );

  return {
    materialId,
    requiredQty,
    fromKitContext,
    isKit: true,
    state: 'cracked',
    distributedWhole: 0,
    distributions: [],
    crackedSub,
  };
}

function stateFor(distributed, required) {
  if (distributed === 0) return 'untouched';
  if (distributed < required) return 'short';
  if (distributed > required) return 'over';
  return 'complete';
}

function collectMatchedEntries(reconLines, matched) {
  for (const line of reconLines) {
    if (Array.isArray(line.distributions)) {
      for (const e of line.distributions) matched.add(e);
    }
    if (Array.isArray(line.crackedSub)) {
      collectMatchedEntries(line.crackedSub, matched);
    }
  }
}
