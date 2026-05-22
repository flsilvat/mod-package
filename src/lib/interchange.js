// Helpers for interchange groups — equivalence classes of materials that
// can be used in place of each other. Each group has a free-text note (the
// justification) and a list of materialIds. A material belongs to at most
// one group; membership is symmetric and transitive within the group.

// Map materialId → Set of materialIds in the same group (including itself).
// Materials with no group are not in the map.
export function buildAlternatesMap(groups) {
  const map = new Map();
  for (const g of groups) {
    const ids = Array.isArray(g.materialIds) ? g.materialIds : [];
    if (ids.length < 2) continue; // a group of 1 means nothing
    const set = new Set(ids);
    for (const id of ids) map.set(id, set);
  }
  return map;
}

// Map materialId → the group document the material belongs to.
export function buildGroupByMaterialId(groups) {
  const map = new Map();
  for (const g of groups) {
    const ids = Array.isArray(g.materialIds) ? g.materialIds : [];
    if (ids.length < 2) continue;
    for (const id of ids) map.set(id, g);
  }
  return map;
}
