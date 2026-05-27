import { useEffect, useState, useMemo, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { useScope } from '../lib/scope';
import {
  buildProjectMatrix,
  buildMaterialsMatrix,
} from '../lib/projects';
import { computeConfigBucket, mergeBuckets } from '../lib/bucket';
import CollapsibleKitTree from '../components/CollapsibleKitTree';
import AlternatesChip from '../components/AlternatesChip';
import FilterBar from '../components/FilterBar';

// ----- recursive filter helpers -----
//
// The filters on the Project view need to match nested instances too:
//   - a drawing whose docNumber/title sits inside another drawing's ref tree
//   - a material whose partNumber sits inside a kit's contents (any depth)
// These return true when a hit exists either on the entity itself or
// anywhere in its tree. Recursion is cycle-guarded via `seen`.

function matchesDrawingSelf(d, q) {
  if (!d) return false;
  return (
    (d.docNumber || '').toLowerCase().includes(q) ||
    (d.rev || '').toLowerCase().includes(q) ||
    (d.sapDir || '').toLowerCase().includes(q) ||
    (d.title || '').toLowerCase().includes(q)
  );
}
function matchesDrawingTree(id, q, drawingById, seen = new Set()) {
  if (seen.has(id)) return false;
  seen.add(id);
  const d = drawingById.get(id);
  if (!d) return false;
  if (matchesDrawingSelf(d, q)) return true;
  if (Array.isArray(d.refDrawingIds)) {
    for (const refId of d.refDrawingIds) {
      if (matchesDrawingTree(refId, q, drawingById, seen)) return true;
    }
  }
  return false;
}

function matchesMaterialSelf(m, q) {
  if (!m) return false;
  return (
    (m.partNumber || '').toLowerCase().includes(q) ||
    (m.description || '').toLowerCase().includes(q)
  );
}
function matchesMaterialTree(id, q, materialById, seen = new Set()) {
  if (seen.has(id)) return false;
  seen.add(id);
  const m = materialById.get(id);
  if (!m) return false;
  if (matchesMaterialSelf(m, q)) return true;
  if (m.isKit && Array.isArray(m.components)) {
    for (const c of m.components) {
      if (matchesMaterialTree(c.materialId, q, materialById, seen)) {
        return true;
      }
    }
  }
  return false;
}

// Full view for one Project: the group legend, the Drawings matrix, the
// Materials matrix. Rows are unique drawings/materials across the project;
// columns are TO Part groups; cells indicate applicability (drawings) or
// quantity (materials). Each row sits in a section under the first group
// (alphabetic) it appears in, so every drawing or material appears exactly
// once even when it spans multiple TO Parts.

export default function ProjectViewPage() {
  const { projectId } = useParams();
  const scope = useScope();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // expand/contract state — keyed by drawing or material id.
  const [openDrawings, setOpenDrawings] = useState(() => new Set());
  const [openKits, setOpenKits] = useState(() => new Set());

  // Per-section filter text — narrows the rows shown in each matrix.
  const [drawingFilter, setDrawingFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');

  function toggle(set, setSet, id) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!projectId) return undefined;
    const unsub = onSnapshot(
      doc(db, COLLECTIONS.PROJECT, projectId),
      (snap) => {
        if (snap.exists()) setProject({ id: snap.id, ...snap.data() });
        else setProject(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [projectId]);

  const {
    toParts,
    toPartsById,
    configsById,
    sbsById,
    tosById,
    materialById,
    drawingById,
    aircraftById,
  } = scope;

  // toParts grouped by their parent TO id — needed when a project member is
  // a whole TO (type: 'to') and should expand to all its parts.
  const toPartsByTo = useMemo(() => {
    const m = new Map();
    for (const p of toParts) {
      if (!m.has(p.technicalOrderId)) m.set(p.technicalOrderId, []);
      m.get(p.technicalOrderId).push(p);
    }
    return m;
  }, [toParts]);

  // Build the project matrix (groups + drawing rows) when the project is
  // ready. When it isn't, fall back to an empty shape so the hooks below
  // stay above any early return — needed to keep the rules of hooks happy.
  const matrix = useMemo(() => {
    if (!project) return { parts: [], groups: [], drawingRows: [] };
    return buildProjectMatrix(project, {
      toPartsById,
      toPartsByTo,
      toById: tosById,
      configById: configsById,
      aircraftById,
      drawingById,
      sbsById,
    });
  }, [
    project,
    toPartsById,
    toPartsByTo,
    tosById,
    configsById,
    aircraftById,
    drawingById,
    sbsById,
  ]);

  // Per-TO-Part bucket — used to determine each material's "primary section"
  // (which TO Part it sits under in the section list).
  const partBuckets = useMemo(
    () =>
      matrix.parts.map((p) => {
        if (!p.config || !p.sb) return [];
        return computeConfigBucket(p.config, {
          sb: p.sb,
          drawingById,
          materialById,
        });
      }),
    [matrix.parts, drawingById, materialById]
  );

  // Per-merged-group bucket — the sum of partBuckets for the group's members.
  // This is what fills the matrix cells (quantities per group).
  const groupBuckets = useMemo(
    () =>
      matrix.groups.map((g) => {
        const memberBuckets = g.members.map((m) => {
          const partIdx = matrix.parts.findIndex(
            (p) => p.part.id === m.part.id
          );
          return partIdx >= 0 ? partBuckets[partIdx] || [] : [];
        });
        return mergeBuckets(memberBuckets);
      }),
    [matrix.groups, matrix.parts, partBuckets]
  );

  const materialRows = useMemo(
    () =>
      buildMaterialsMatrix(
        matrix.parts,
        matrix.groups,
        partBuckets,
        groupBuckets,
        { materialById }
      ),
    [matrix.parts, matrix.groups, partBuckets, groupBuckets, materialById]
  );

  // Per-section text filter. Empty filter ⇒ pass-through. Drawings match
  // docNumber, rev, SAP DIR or title; materials match partNumber or
  // description. The match also descends into nested instances — drawing
  // refs and kit contents — so a kit whose component matches the filter
  // stays visible (with the kit row as the carrier), and a drawing whose
  // referenced child matches stays visible too. Empty sections naturally
  // disappear because sectionsOf only iterates rows that came through.
  const filteredDrawingRows = useMemo(() => {
    const q = drawingFilter.trim().toLowerCase();
    if (!q) return matrix.drawingRows;
    return matrix.drawingRows.filter((row) =>
      matchesDrawingTree(row.drawing.id, q, drawingById)
    );
  }, [matrix.drawingRows, drawingFilter, drawingById]);

  const filteredMaterialRows = useMemo(() => {
    const q = materialFilter.trim().toLowerCase();
    if (!q) return materialRows;
    return materialRows.filter((row) =>
      matchesMaterialTree(row.material.id, q, materialById)
    );
  }, [materialRows, materialFilter, materialById]);

  // Rows whose match lives in a descendant only (not the row entity itself)
  // get auto-opened, so the deep match is reachable without an extra click.
  // For drawings the ref-tree component already auto-expands recursively;
  // for materials the CollapsibleKitTree picks up `defaultOpen` from the
  // row, see MaterialRow below.
  const autoOpenDrawings = useMemo(() => {
    const q = drawingFilter.trim().toLowerCase();
    if (!q) return new Set();
    const out = new Set();
    for (const row of filteredDrawingRows) {
      if (matchesDrawingSelf(row.drawing, q)) continue;
      out.add(row.drawing.id);
    }
    return out;
  }, [filteredDrawingRows, drawingFilter]);

  const autoOpenKits = useMemo(() => {
    const q = materialFilter.trim().toLowerCase();
    if (!q) return new Set();
    const out = new Set();
    for (const row of filteredMaterialRows) {
      if (matchesMaterialSelf(row.material, q)) continue;
      out.add(row.material.id);
    }
    return out;
  }, [filteredMaterialRows, materialFilter]);

  // Effective open = user-toggled UNION auto-opened. Manual clicks keep
  // working on the user-open set; auto-opens just ride along while the
  // filter is active. Caveat: while a row is auto-open the user can't
  // "click to close" it — clicking just adds/removes from userOpen but
  // the union still includes it. Acceptable for a search-driven view.
  const effectiveOpenDrawings = useMemo(
    () => new Set([...openDrawings, ...autoOpenDrawings]),
    [openDrawings, autoOpenDrawings]
  );
  const effectiveOpenKits = useMemo(
    () => new Set([...openKits, ...autoOpenKits]),
    [openKits, autoOpenKits]
  );

  if (loading) {
    return (
      <div className="page-head">
        <p className="lede">Loading project…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page-head">
        <p className="notice notice-error">Couldn't load: {error}</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="page-head">
        <p className="eyebrow">Project</p>
        <h1>Project not found</h1>
        <p className="lede">It may have been deleted.</p>
        <Link to="/projects" className="btn btn-ghost btn-sm">
          ← back to projects
        </Link>
      </div>
    );
  }

  const { groups, drawingRows } = matrix;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/projects" className="btn btn-ghost btn-sm">
          ← back to projects
        </Link>
      </div>

      <div className="page-head">
        <p className="eyebrow">Project</p>
        <h1>{project.name}</h1>
        {project.description && <p className="lede">{project.description}</p>}
        <p className="lede">
          {matrix.parts.length} TO part{matrix.parts.length === 1 ? '' : 's'}
          {' '}in {groups.length} group{groups.length === 1 ? '' : 's'} ·{' '}
          {drawingRows.length} unique drawing
          {drawingRows.length === 1 ? '' : 's'} · {materialRows.length} unique
          material{materialRows.length === 1 ? '' : 's'}
        </p>
      </div>

      {groups.length === 0 ? (
        <section className="panel">
          <p className="notice">
            This project has no members yet. Add a TO or a TO Part on the
            Projects page.
          </p>
        </section>
      ) : (
        <>
          <GroupLegend groups={groups} sbsById={sbsById} />

          <section className="panel">
            <div className="panel-titlebar">
              <h2 className="panel-title">Drawings</h2>
              <span className="count">{drawingRows.length}</span>
              <FilterBar
                value={drawingFilter}
                onChange={setDrawingFilter}
                placeholder="Filter drawings…"
                count={filteredDrawingRows.length}
                total={drawingRows.length}
              />
              {/* Phase 2 — PDF export button slots here */}
            </div>
            {drawingRows.length === 0 ? (
              <p className="kit-empty">
                No drawings reach this project yet. Link drawings to the SB
                configurations referenced by this project's TO Parts.
              </p>
            ) : filteredDrawingRows.length === 0 ? (
              <p className="notice">No drawings match the filter.</p>
            ) : (
              <DrawingsMatrix
                parts={matrix.parts}
                groups={groups}
                rows={filteredDrawingRows}
                drawingById={drawingById}
                openDrawings={effectiveOpenDrawings}
                toggleDrawing={(id) =>
                  toggle(openDrawings, setOpenDrawings, id)
                }
                filterText={drawingFilter}
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-titlebar">
              <h2 className="panel-title">Materials</h2>
              <span className="count">{materialRows.length}</span>
              <FilterBar
                value={materialFilter}
                onChange={setMaterialFilter}
                placeholder="Filter materials…"
                count={filteredMaterialRows.length}
                total={materialRows.length}
              />
              {/* Phase 2 — PDF export button slots here */}
            </div>
            {materialRows.length === 0 ? (
              <p className="kit-empty">No materials reach this project yet.</p>
            ) : filteredMaterialRows.length === 0 ? (
              <p className="notice">No materials match the filter.</p>
            ) : (
              <MaterialsMatrix
                parts={matrix.parts}
                groups={groups}
                rows={filteredMaterialRows}
                materialById={materialById}
                openKits={effectiveOpenKits}
                toggleKit={(id) => toggle(openKits, setOpenKits, id)}
                filterText={materialFilter}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}

// ----- group legend: one card per TO Part, shown above both matrices -----

function GroupLegend({ groups, sbsById }) {
  return (
    <section className="panel">
      <p className="detail-section-title">
        Groups · merged by shared aircraft set
      </p>
      <div className="project-legend-grid">
        {groups.map((g, idx) => (
          <div key={idx} className="project-legend-card">
            <div className="project-legend-head">
              <span className="project-legend-index">G{idx + 1}</span>
              {g.members.length > 1 && (
                <span className="dim">
                  {g.members.length} TO Parts · same tails
                </span>
              )}
            </div>
            <div className="project-legend-members">
              {g.members.map((m, i) => {
                const sb = m.config ? sbsById.get(m.config.sbId) : null;
                return (
                  <div key={i} className="project-legend-member">
                    <div className="project-legend-member-head">
                      <span className="mono strong">
                        {m.to ? m.to.toNumber : '(no TO)'}
                      </span>
                      <span className="dim">·</span>
                      <span>{m.partLabel || '(no part)'}</span>
                    </div>
                    <div className="project-legend-sub">
                      {sb && (
                        <span className="mono">
                          {sb.sbRef}
                          {sb.rev ? ` rev ${sb.rev}` : ''}
                        </span>
                      )}
                      {m.config && (
                        <span className="dim"> · {m.config.name}</span>
                      )}
                    </div>
                    {sb?.title && (
                      <div
                        className="project-legend-title"
                        title={sb.title}
                      >
                        {sb.title}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="project-legend-aircraft">
              {g.aircraft.length === 0 ? (
                <span className="dim">no aircraft</span>
              ) : (
                g.aircraft.map((a) => (
                  <span key={a.id} className="chip chip-sm">
                    <span className="mono">{a.registration}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ----- shared section iteration: rows grouped by primaryPartIndex -----

function sectionsOf(rows, parts) {
  const out = [];
  let last = -1;
  for (const row of rows) {
    if (row.primaryPartIndex !== last) {
      out.push({
        sectionIndex: row.primaryPartIndex,
        part: parts[row.primaryPartIndex],
        rows: [row],
      });
      last = row.primaryPartIndex;
    } else {
      out[out.length - 1].rows.push(row);
    }
  }
  return out;
}

function SectionHeader({ part, colCount }) {
  if (!part) {
    return (
      <tr className="matrix-section">
        <td colSpan={colCount}>(no TO Part)</td>
      </tr>
    );
  }
  return (
    <tr className="matrix-section">
      <td colSpan={colCount}>
        <span className="mono strong">
          {part.to?.toNumber || '?'}
        </span>{' '}
        · {part.partLabel || '(no part)'}
        {part.sb && (
          <span className="dim">
            {' '}
            · {part.sb.sbRef}
            {part.sb.rev ? ` rev ${part.sb.rev}` : ''}
          </span>
        )}
        {part.config && (
          <span className="dim"> · {part.config.name}</span>
        )}
        {part.sb?.title && (
          <span className="matrix-section-title"> · {part.sb.title}</span>
        )}
      </td>
    </tr>
  );
}

// ----- drawings matrix -----

function DrawingsMatrix({
  parts,
  groups,
  rows,
  drawingById,
  openDrawings,
  toggleDrawing,
  filterText,
}) {
  const sections = sectionsOf(rows, parts);
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th className="matrix-row-label">Drawing</th>
            {groups.map((_, idx) => (
              <th key={idx} className="matrix-col">
                <span className="matrix-col-index">G{idx + 1}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.sectionIndex}>
              <SectionHeader
                part={section.part}
                colCount={1 + groups.length}
              />
              {section.rows.map((row) => (
                <DrawingRow
                  key={row.drawing.id}
                  row={row}
                  groups={groups}
                  drawingById={drawingById}
                  isOpen={openDrawings.has(row.drawing.id)}
                  onToggle={() => toggleDrawing(row.drawing.id)}
                  filterText={filterText}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrawingRow({ row, groups, drawingById, isOpen, onToggle, filterText }) {
  const d = row.drawing;
  const refIds = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
  const hasRefs = refIds.length > 0;

  // Classify the match so the row can carry a visual indicator. The colour
  // semantics are colour-blind-safe (blue for direct, amber for descendant).
  const q = (filterText || '').trim().toLowerCase();
  let matchKind = '';
  if (q) {
    if (matchesDrawingSelf(d, q)) matchKind = 'match-self';
    else if (hasRefs && matchesDrawingTree(d.id, q, drawingById)) {
      matchKind = 'match-descendant';
    }
  }
  const rowClass = `matrix-row${matchKind ? ` ${matchKind}` : ''}`;

  return (
    <>
      <tr className={rowClass}>
        <td className="matrix-row-label">
          <div className="matrix-row-head">
            {hasRefs ? (
              <button
                className="expand-btn"
                onClick={onToggle}
                aria-label={isOpen ? 'Collapse' : 'Expand'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="link-caret-spacer" />
            )}
            <span className="mono strong cell-nowrap">{d.docNumber}</span>
            {d.rev && <span className="tag tag-count">rev {d.rev}</span>}
            {d.sapDir && <span className="dim">({d.sapDir})</span>}
            {d.title && (
              <span className="kit-desc" title={d.title}>
                {d.title}
              </span>
            )}
          </div>
        </td>
        {groups.map((_, idx) => (
          <td key={idx} className="matrix-cell">
            {row.appliesTo.has(idx) && <span className="matrix-tick">●</span>}
          </td>
        ))}
      </tr>
      {isOpen && hasRefs && (
        <tr className="matrix-row matrix-subrow">
          <td colSpan={1 + groups.length} className="matrix-subrow-body">
            <DrawingRefList
              refIds={refIds}
              drawingById={drawingById}
              seen={new Set([d.id])}
              filterQuery={q}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DrawingRefList({ refIds, drawingById, seen, filterQuery }) {
  return (
    <ul className="kit-tree">
      {refIds.map((id, idx) => {
        const d = drawingById.get(id);
        if (!d) {
          return (
            <li key={idx} className="kit-node">
              <div className="kit-node-row">
                <span className="mono strong">(missing drawing)</span>
              </div>
            </li>
          );
        }
        const isCycle = seen.has(id);
        const childSeen = new Set(seen);
        childSeen.add(id);
        const childRefs = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
        const isMatch = filterQuery && matchesDrawingSelf(d, filterQuery);
        return (
          <li
            key={id}
            className={`kit-node${isMatch ? ' kit-node-match' : ''}`}
          >
            <div className="kit-node-row">
              <span className="mono strong">{d.docNumber}</span>
              {d.rev && <span className="tag tag-count">rev {d.rev}</span>}
              {d.sapDir && <span className="dim">({d.sapDir})</span>}
              {d.title && <span className="kit-desc">{d.title}</span>}
              {isCycle && (
                <span className="cycle-flag">circular — not expanded</span>
              )}
            </div>
            {!isCycle && childRefs.length > 0 && (
              <DrawingRefList
                refIds={childRefs}
                drawingById={drawingById}
                seen={childSeen}
                filterQuery={filterQuery}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ----- materials matrix -----

function MaterialsMatrix({
  parts,
  groups,
  rows,
  materialById,
  openKits,
  toggleKit,
  filterText,
}) {
  const sections = sectionsOf(rows, parts);
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th className="matrix-row-label">Material</th>
            {groups.map((_, idx) => (
              <th key={idx} className="matrix-col">
                <span className="matrix-col-index">G{idx + 1}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.sectionIndex}>
              <SectionHeader
                part={section.part}
                colCount={1 + groups.length}
              />
              {section.rows.map((row) => (
                <MaterialRow
                  key={row.material.id}
                  row={row}
                  groups={groups}
                  materialById={materialById}
                  isOpen={openKits.has(row.material.id)}
                  onToggle={() => toggleKit(row.material.id)}
                  filterText={filterText}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaterialRow({
  row,
  groups,
  materialById,
  isOpen,
  onToggle,
  filterText,
}) {
  const m = row.material;
  const isKit =
    !!m.isKit && Array.isArray(m.components) && m.components.length > 0;

  // Match classification for the row colour. Self = direct hit (blue);
  // descendant = something inside the kit matched (amber). Both palettes
  // are colour-blind safe — see CSS .match-self / .match-descendant.
  const q = (filterText || '').trim().toLowerCase();
  let matchKind = '';
  if (q) {
    if (matchesMaterialSelf(m, q)) matchKind = 'match-self';
    else if (isKit && matchesMaterialTree(m.id, q, materialById)) {
      matchKind = 'match-descendant';
    }
  }
  const rowClass = `matrix-row${matchKind ? ` ${matchKind}` : ''}`;

  // When the filter is non-empty we want the inner kit tree to start fully
  // expanded so a deep match is reachable without extra clicks. The `key`
  // toggles only on the empty ↔ non-empty boundary (not per keystroke),
  // so we don't remount the tree on every character typed.
  const filterActive = !!q;

  return (
    <>
      <tr className={rowClass}>
        <td className="matrix-row-label">
          <div className="matrix-row-head">
            {isKit ? (
              <button
                className="expand-btn"
                onClick={onToggle}
                aria-label={isOpen ? 'Collapse' : 'Expand'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="link-caret-spacer" />
            )}
            <span className="mono strong cell-nowrap">{m.partNumber}</span>
            <AlternatesChip materialId={m.id} />
            {m.description && (
              <span className="kit-desc" title={m.description}>
                {m.description}
              </span>
            )}
            {isKit && <span className="tag tag-kit">kit</span>}
          </div>
        </td>
        {row.quantities.map((q, idx) => (
          <td key={idx} className="matrix-cell">
            {q != null && q > 0 ? (
              <span className="matrix-qty">{q}</span>
            ) : null}
          </td>
        ))}
      </tr>
      {isOpen && isKit && (
        <tr className="matrix-row matrix-subrow">
          <td colSpan={1 + groups.length} className="matrix-subrow-body">
            <CollapsibleKitTree
              key={filterActive ? 'filter-active' : 'no-filter'}
              components={m.components}
              byId={materialById}
              seen={new Set([m.id])}
              defaultOpen={filterActive}
            />
          </td>
        </tr>
      )}
    </>
  );
}

