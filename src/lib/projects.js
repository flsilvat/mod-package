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
//   - `parts`  — sorted per-TO-Part info (the section dimension).
//                Each part carries: { part, partLabel, to, toNumber, config,
//                configName, sb, aircraftIds, aircraft, drawings, aircraftKey }.
//   - `groups` — merged by canonical aircraft set (the column dimension).
//                Each group carries: { members: [partInfo, ...], aircraft,
//                drawings }.
//   - `partGroupIndex` — Map<partId, groupIndex> for cross-referencing.
//   - `drawingRows` — one row per unique drawing across the project, with
//                an `appliesTo: Set<groupIndex>` (for cell rendering) and a
//                `primaryPartIndex` (for sectioning — the TO Part this row
//                belongs to in the section list).
//
// Sectioning is by TO Part so each section header can identify the bulletin
// the drawings/materials come from. Columns are merged by aircraft set so
// physically-identical aircraft groups don't take up multiple columns.
export function buildProjectMatrix(
  project,
  {
    toPartsById,
    toPartsByTo,
    toById,
    configById,
    aircraftById,
    drawingById,
    sbsById,
  }
) {
  const parts = resolveProjectParts(project, { toPartsById, toPartsByTo });

  // Per-part info, sorted alphabetically by TO + part label.
  const partInfos = parts.map((part) => {
    const config = configById.get(part.sbConfigId) || null;
    const to = toById.get(part.technicalOrderId) || null;
    const sb = config ? sbsById.get(config.sbId) || null : null;
    const aircraftIdsSorted = (config?.aircraftIds || []).slice().sort();
    // Sort the resolved aircraft docs by registration for display (LEA,
    // LEB, LEC …). The merge key above stays ID-based so grouping is
    // unaffected; this only changes presentation order in the legend and
    // the PDF exports, which both read group.aircraft.
    const aircraft = aircraftIdsSorted
      .map((id) => aircraftById.get(id))
      .filter(Boolean)
      .sort((a, b) =>
        (a.registration || '').localeCompare(b.registration || '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      );
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
      sb,
      aircraftIds: aircraftIdsSorted,
      aircraft,
      drawings,
      aircraftKey: aircraftIdsSorted.length
        ? aircraftIdsSorted.join('|')
        : '__empty__',
    };
  });

  partInfos.sort((a, b) =>
    `${a.toNumber} ${a.partLabel}`.localeCompare(
      `${b.toNumber} ${b.partLabel}`,
      undefined,
      { numeric: true, sensitivity: 'base' }
    )
  );

  // Merge by aircraftKey for the column dimension.
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

  groups.sort((a, b) => {
    const ka = `${a.members[0].toNumber} ${a.members[0].partLabel}`;
    const kb = `${b.members[0].toNumber} ${b.members[0].partLabel}`;
    return ka.localeCompare(kb, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  // partId -> merged group index, used for `appliesTo` set during drawing
  // applicability computation below.
  const partGroupIndex = new Map();
  groups.forEach((g, groupIdx) => {
    for (const m of g.members) partGroupIndex.set(m.part.id, groupIdx);
  });

  // For each drawing, track:
  //   - appliesTo: Set<groupIndex>      → which columns get ticked
  //   - primaryPartIndex: number        → which TO Part section it sits under
  // The first part (alphabetic) the drawing appears in becomes its primary.
  const drawingApplicability = new Map();
  partInfos.forEach((info, partIdx) => {
    const groupIdx = partGroupIndex.get(info.part.id);
    for (const d of info.drawings) {
      if (!drawingApplicability.has(d.id)) {
        drawingApplicability.set(d.id, {
          drawing: d,
          appliesTo: new Set(),
          primaryPartIndex: partIdx,
        });
      }
      drawingApplicability.get(d.id).appliesTo.add(groupIdx);
    }
  });

  const drawingRows = [...drawingApplicability.values()];
  drawingRows.sort((a, b) => {
    if (a.primaryPartIndex !== b.primaryPartIndex) {
      return a.primaryPartIndex - b.primaryPartIndex;
    }
    return (a.drawing.docNumber || '').localeCompare(
      b.drawing.docNumber || '',
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });

  return { parts: partInfos, groups, partGroupIndex, drawingRows };
}

// Build the materials matrix on top of an already-built project matrix.
//
//   parts        — partInfos[] from buildProjectMatrix (the section dim).
//   groups       — merged groups[] (the column dim).
//   partBuckets  — computed bucket per TO Part (parts.map order), used to
//                  determine each material's `primaryPartIndex` (which
//                  section it belongs to).
//   groupBuckets — computed bucket per merged group (groups.map order),
//                  the source of per-group quantities (and the union of
//                  applicable materials for that group).
//
// Returns one row per unique materialId with:
//   - material
//   - quantities       (Array<number|null> aligned to groups[])
//   - primaryPartIndex (which TO Part section it sits under)
export function buildMaterialsMatrix(
  parts,
  groups,
  partBuckets,
  groupBuckets,
  { materialById }
) {
  // First-encounter wins: the alphabetically-first TO Part that demands a
  // given material becomes that material's section.
  const primaryByMaterial = new Map();
  partBuckets.forEach((bucket, partIdx) => {
    for (const line of bucket) {
      if (!primaryByMaterial.has(line.materialId)) {
        primaryByMaterial.set(line.materialId, partIdx);
      }
    }
  });

  // Per-group quantities for the row cells.
  const totals = new Map();
  groupBuckets.forEach((bucket, groupIdx) => {
    for (const line of bucket) {
      if (!totals.has(line.materialId)) {
        totals.set(line.materialId, {
          quantities: groups.map(() => null),
        });
      }
      const entry = totals.get(line.materialId);
      entry.quantities[groupIdx] =
        (entry.quantities[groupIdx] || 0) + (Number(line.qty) || 0);
    }
  });

  const rows = [];
  for (const [materialId, entry] of totals) {
    const material = materialById.get(materialId);
    if (!material) continue;
    rows.push({
      material,
      quantities: entry.quantities,
      primaryPartIndex: primaryByMaterial.get(materialId) ?? 0,
    });
  }
  rows.sort((a, b) => {
    if (a.primaryPartIndex !== b.primaryPartIndex) {
      return a.primaryPartIndex - b.primaryPartIndex;
    }
    return (a.material.partNumber || '').localeCompare(
      b.material.partNumber || '',
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });
  return rows;
}
