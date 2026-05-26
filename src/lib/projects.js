// Helpers for working with Project entities.
//
// A project's `members` array contains mixed types:
//   { type: 'to',     id: <technicalOrderId> }  → all of that TO's parts
//   { type: 'toPart', id: <toPartId> }          → one specific part
//
// `resolveProjectParts` expands and dedupes that membership into a flat list
// of TO Part documents in stable order. `buildProjectMatrix` then turns that
// list into the row/column structure used by both the Drawings and Materials
// matrices on the project full view (and later by the PDF exports).

import { collectDrawingsForConfig } from './bucket';

export function resolveProjectParts(project, { toPartsById, toPartsByTo }) {
  const members = Array.isArray(project?.members) ? project.members : [];
  const partIds = new Set();
  for (const m of members) {
    if (!m || !m.id) continue;
    if (m.type === 'to') {
      const parts = toPartsByTo.get(m.id) || [];
      for (const p of parts) partIds.add(p.id);
    } else if (m.type === 'toPart') {
      if (toPartsById.has(m.id)) partIds.add(m.id);
    }
  }
  const out = [];
  for (const id of partIds) {
    const p = toPartsById.get(id);
    if (p) out.push(p);
  }
  return out;
}

// Build the matrix structure used by both Drawings and Materials displays.
//
//   - `groups` — one group per *unique aircraft set* across all the project's
//                TO Parts (merged: two TO Parts with the same tails collapse
//                into the same group). Sorted by the first member's
//                TO number + part label.
//                Each group carries:
//                  { members: [{ part, partLabel, to, toNumber, config,
//                                configName }, ...],
//                    aircraftIds, aircraft,
//                    drawings (union, recursive via refs) }.
//   - `drawingRows` — one row per unique drawing across the project, with
//                an `appliesTo: Set<groupIndex>` and `primaryGroupIndex`
//                (the lowest group index where it appears, used for
//                sectioning the matrix).
//
// Merging is by canonical aircraft set: parts whose configs reference the
// same sorted list of aircraftIds end up in the same group. Engineering
// reality is that those parts touch the same physical aircraft, so the
// matrix shouldn't dedicate a column to each one.
export function buildProjectMatrix(
  project,
  { toPartsById, toPartsByTo, toById, configById, aircraftById, drawingById }
) {
  const parts = resolveProjectParts(project, { toPartsById, toPartsByTo });

  // Per-part info, including the canonical aircraft key for merging.
  const partInfos = parts.map((part) => {
    const config = configById.get(part.sbConfigId) || null;
    const to = toById.get(part.technicalOrderId) || null;
    const aircraftIdsSorted = ((config?.aircraftIds || []).slice()).sort();
    const aircraft = aircraftIdsSorted
      .map((id) => aircraftById.get(id))
      .filter(Boolean);
    const drawings = config
      ? collectDrawingsForConfig(config.id, { drawingById })
      : [];
    return {
      part,
      partLabel: part.partLabel || '',
      to,
      toNumber: to?.toNumber || '',
      config,
      configName: config?.name || '',
      aircraftIds: aircraftIdsSorted,
      aircraft,
      drawings,
      aircraftKey: aircraftIdsSorted.length
        ? aircraftIdsSorted.join('|')
        : '__empty__',
    };
  });

  // Stable ordering of member parts within their groups, and used as the
  // tie-breaker for group ordering.
  partInfos.sort((a, b) =>
    `${a.toNumber} ${a.partLabel}`.localeCompare(
      `${b.toNumber} ${b.partLabel}`,
      undefined,
      { numeric: true, sensitivity: 'base' }
    )
  );

  // Merge parts by aircraftKey. Drawings are deduped by id when unioning.
  const groupMap = new Map();
  for (const info of partInfos) {
    let g = groupMap.get(info.aircraftKey);
    if (!g) {
      g = {
        members: [],
        aircraftIds: info.aircraftIds,
        aircraft: info.aircraft,
        drawingsById: new Map(),
      };
      groupMap.set(info.aircraftKey, g);
    }
    g.members.push(info);
    for (const d of info.drawings) g.drawingsById.set(d.id, d);
  }

  const groups = [...groupMap.values()].map((g) => ({
    members: g.members,
    aircraftIds: g.aircraftIds,
    aircraft: g.aircraft,
    drawings: [...g.drawingsById.values()],
  }));

  // Order groups by their first (alphabetic) member's TO + part label, so
  // group indices are stable and meaningful.
  groups.sort((a, b) => {
    const ka = `${a.members[0].toNumber} ${a.members[0].partLabel}`;
    const kb = `${b.members[0].toNumber} ${b.members[0].partLabel}`;
    return ka.localeCompare(kb, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  // --- Drawings matrix ---
  const drawingApplicability = new Map();
  groups.forEach((g, idx) => {
    for (const d of g.drawings) {
      if (!drawingApplicability.has(d.id)) {
        drawingApplicability.set(d.id, { drawing: d, appliesTo: new Set() });
      }
      drawingApplicability.get(d.id).appliesTo.add(idx);
    }
  });

  const drawingRows = [...drawingApplicability.values()].map((entry) => ({
    drawing: entry.drawing,
    appliesTo: entry.appliesTo,
    primaryGroupIndex: Math.min(...entry.appliesTo),
  }));
  drawingRows.sort((a, b) => {
    if (a.primaryGroupIndex !== b.primaryGroupIndex) {
      return a.primaryGroupIndex - b.primaryGroupIndex;
    }
    return (a.drawing.docNumber || '').localeCompare(
      b.drawing.docNumber || '',
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });

  return { parts, groups, drawingRows };
}

// Build the materials matrix on top of an already-built project matrix.
//
// Returns `materialRows` — one row per unique materialId, with:
//   - material        (the catalogue doc)
//   - quantities      (Array<number|null> aligned to groups[])
//   - primaryGroupIndex (for sectioning)
//   - kitContents     (the kit's components, if it's a kit) — for the
//                     expand/contract toggle on the web view.
//
// `groupBuckets` is the per-group computed bucket; each bucket is the
// output of computeConfigBucket — an array of { materialId, qty }.
export function buildMaterialsMatrix(groups, groupBuckets, { materialById }) {
  // Map<materialId, { quantities: Array<number|null>, appliesTo: Set<idx> }>
  const totals = new Map();
  groupBuckets.forEach((bucket, idx) => {
    for (const line of bucket) {
      if (!totals.has(line.materialId)) {
        totals.set(line.materialId, {
          quantities: groups.map(() => null),
          appliesTo: new Set(),
        });
      }
      const entry = totals.get(line.materialId);
      entry.quantities[idx] = (entry.quantities[idx] || 0) + (Number(line.qty) || 0);
      entry.appliesTo.add(idx);
    }
  });

  const materialRows = [];
  for (const [materialId, entry] of totals) {
    const material = materialById.get(materialId);
    if (!material) continue;
    const primaryGroupIndex = Math.min(...entry.appliesTo);
    materialRows.push({
      material,
      quantities: entry.quantities,
      appliesTo: entry.appliesTo,
      primaryGroupIndex,
    });
  }
  materialRows.sort((a, b) => {
    if (a.primaryGroupIndex !== b.primaryGroupIndex) {
      return a.primaryGroupIndex - b.primaryGroupIndex;
    }
    return (a.material.partNumber || '').localeCompare(
      b.material.partNumber || '',
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });
  return materialRows;
}
