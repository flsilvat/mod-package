// The "scope" — a cross-cutting filter that narrows entity pages to just
// what's relevant to one or more TO Parts. State lives in React context
// (in-memory; clears on refresh). The Provider subscribes once to the
// scope-related collections (TO Parts, SB Configs, Service Bulletins,
// Technical Orders, Materials, Drawings, HTLs) and derives an in-scope id
// Set for each filterable entity type. Each set is `null` when the user has
// no scope selected — pages treat that as "show all".

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './collections';
import { collectDescendants } from './materials';
import { collectRefDescendants } from './drawings';
import { drawingAppliesToConfig, computeConfigBucket } from './bucket';
import { buildAlternatesMap, buildGroupByMaterialId } from './interchange';

const ScopeContext = createContext(null);

export function ScopeProvider({ children }) {
  // User-selected scope items. Each: { kind: 'toPart', id }.
  const [items, setItems] = useState([]);

  // Scope-related collections.
  const [toParts, setToParts] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [sbs, setSbs] = useState([]);
  const [tos, setTos] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [htls, setHtls] = useState([]);
  const [interchangeGroups, setInterchangeGroups] = useState([]);

  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, COLLECTIONS.TO_PART), (snap) =>
        setToParts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.SB_CONFIG), (snap) =>
        setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.SERVICE_BULLETIN), orderBy('sbRef')),
        (snap) => setSbs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.TECHNICAL_ORDER), (snap) =>
        setTos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.MATERIAL), (snap) =>
        setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.DRAWING), (snap) =>
        setDrawings(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.HTL), (snap) =>
        setHtls(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.INTERCHANGE_GROUP), (snap) =>
        setInterchangeGroups(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        )
      ),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // Lookup maps used for resolution and for picker labels.
  const toPartsById = useMemo(() => {
    const m = new Map();
    for (const x of toParts) m.set(x.id, x);
    return m;
  }, [toParts]);
  const configsById = useMemo(() => {
    const m = new Map();
    for (const x of configs) m.set(x.id, x);
    return m;
  }, [configs]);
  const sbsById = useMemo(() => {
    const m = new Map();
    for (const x of sbs) m.set(x.id, x);
    return m;
  }, [sbs]);
  const tosById = useMemo(() => {
    const m = new Map();
    for (const x of tos) m.set(x.id, x);
    return m;
  }, [tos]);
  const materialById = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);
  const drawingById = useMemo(() => {
    const m = new Map();
    for (const x of drawings) m.set(x.id, x);
    return m;
  }, [drawings]);
  const htlById = useMemo(() => {
    const m = new Map();
    for (const x of htls) m.set(x.id, x);
    return m;
  }, [htls]);

  // Interchange group maps — alternatesMap is materialId -> Set of all
  // materialIds in the same group (including itself), and groupByMaterialId
  // is materialId -> the group document.
  const alternatesMap = useMemo(
    () => buildAlternatesMap(interchangeGroups),
    [interchangeGroups]
  );
  const groupByMaterialId = useMemo(
    () => buildGroupByMaterialId(interchangeGroups),
    [interchangeGroups]
  );

  // The user's items resolve to a set of SB Config IDs.
  const configIds = useMemo(
    () => resolveScopeConfigIds(items, toPartsById),
    [items, toPartsById]
  );

  // In-scope id sets per entity. `null` when the scope is empty (= no
  // filtering applied — pages show everything).
  const materialIds = useMemo(() => {
    if (configIds.size === 0) return null;
    const ids = materialIdsForConfigs(configIds, {
      configsById,
      sbsById,
      drawingById,
      materialById,
    });
    // Expand by interchangeable alternates so the Materials page shows any
    // PN the engineer might reach for as a substitute.
    for (const id of [...ids]) {
      const alts = alternatesMap.get(id);
      if (alts) for (const a of alts) ids.add(a);
    }
    return ids;
  }, [configIds, configsById, sbsById, drawingById, materialById, alternatesMap]);

  const drawingIds = useMemo(() => {
    if (configIds.size === 0) return null;
    return drawingIdsForConfigs(configIds, { drawingById });
  }, [configIds, drawingById]);

  const sbIds = useMemo(() => {
    if (configIds.size === 0) return null;
    return sbIdsForConfigs(configIds, configsById);
  }, [configIds, configsById]);

  const htlGtlIds = useMemo(() => {
    if (configIds.size === 0) return { htlIds: null, gtlIds: null };
    return htlGtlIdsForConfigs(configIds, toParts, htlById);
  }, [configIds, toParts, htlById]);

  function addItem(item) {
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id && i.kind === item.kind)) {
        return prev;
      }
      return [...prev, item];
    });
  }
  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
  function clear() {
    setItems([]);
  }

  const value = {
    items,
    addItem,
    removeItem,
    clear,
    configIds,
    materialIds,
    drawingIds,
    sbIds,
    htlIds: htlGtlIds.htlIds,
    gtlIds: htlGtlIds.gtlIds,
    // picker data
    toParts,
    toPartsById,
    configsById,
    sbsById,
    tosById,
    // material catalogue and interchange data
    materials,
    materialById,
    interchangeGroups,
    alternatesMap,
    groupByMaterialId,
  };

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used within a ScopeProvider');
  return ctx;
}

// ----- pure resolution helpers (exported for tests / reuse) -----

export function resolveScopeConfigIds(items, toPartsById) {
  const ids = new Set();
  for (const item of items) {
    if (item.kind === 'toPart') {
      const part = toPartsById.get(item.id);
      if (part?.sbConfigId) ids.add(part.sbConfigId);
    }
  }
  return ids;
}

export function materialIdsForConfigs(
  configIds,
  { configsById, sbsById, drawingById, materialById }
) {
  const out = new Set();
  for (const configId of configIds) {
    const config = configsById.get(configId);
    if (!config) continue;
    const sb = sbsById.get(config.sbId);
    if (!sb) continue;
    const bucket = computeConfigBucket(config, {
      sb,
      drawingById,
      materialById,
    });
    for (const line of bucket) {
      // include the line material AND its recursive kit contents
      collectDescendants(line.materialId, materialById, out);
    }
  }
  return out;
}

export function drawingIdsForConfigs(
  configIds,
  { drawingById }
) {
  const out = new Set();
  for (const drawing of drawingById.values()) {
    let hits = false;
    for (const configId of configIds) {
      if (drawingAppliesToConfig(drawing, configId)) {
        hits = true;
        break;
      }
    }
    if (hits) collectRefDescendants(drawing.id, drawingById, out);
  }
  return out;
}

export function sbIdsForConfigs(configIds, configsById) {
  const out = new Set();
  for (const configId of configIds) {
    const config = configsById.get(configId);
    if (config) out.add(config.sbId);
  }
  return out;
}

export function htlGtlIdsForConfigs(configIds, toParts, htlById) {
  const htlIds = new Set();
  const gtlIds = new Set();
  for (const part of toParts) {
    if (!configIds.has(part.sbConfigId) || !part.htlId) continue;
    collectHtlSubtreeIds(part.htlId, htlById, htlIds, gtlIds);
  }
  return { htlIds, gtlIds };
}

function collectHtlSubtreeIds(htlId, htlById, htlIds, gtlIds, seen = new Set()) {
  if (seen.has(htlId)) return;
  seen.add(htlId);
  htlIds.add(htlId);
  const h = htlById.get(htlId);
  if (!h || !Array.isArray(h.children)) return;
  for (const child of h.children) {
    if (child.type === 'gtl') gtlIds.add(child.id);
    else if (child.type === 'htl') {
      collectHtlSubtreeIds(child.id, htlById, htlIds, gtlIds, seen);
    }
  }
}
