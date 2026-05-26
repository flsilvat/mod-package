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
    if (!project) return { groups: [], drawingRows: [] };
    return buildProjectMatrix(project, {
      toPartsById,
      toPartsByTo,
      toById: tosById,
      configById: configsById,
      aircraftById,
      drawingById,
    });
  }, [
    project,
    toPartsById,
    toPartsByTo,
    tosById,
    configsById,
    aircraftById,
    drawingById,
  ]);

  // Per-group computed materials bucket, summed across the group's members
  // (a merged group can contain multiple TO Parts with different SB configs).
  const groupBuckets = useMemo(
    () =>
      matrix.groups.map((g) => {
        const memberBuckets = g.members.map((m) => {
          const config = m.config;
          const sb = config ? sbsById.get(config.sbId) : null;
          if (!config || !sb) return [];
          return computeConfigBucket(config, {
            sb,
            drawingById,
            materialById,
          });
        });
        return mergeBuckets(memberBuckets);
      }),
    [matrix.groups, sbsById, drawingById, materialById]
  );

  const materialRows = useMemo(
    () => buildMaterialsMatrix(matrix.groups, groupBuckets, { materialById }),
    [matrix.groups, groupBuckets, materialById]
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
              {/* Phase 2 — PDF export button slots here */}
            </div>
            {drawingRows.length === 0 ? (
              <p className="kit-empty">
                No drawings reach this project yet. Link drawings to the SB
                configurations referenced by this project's TO Parts.
              </p>
            ) : (
              <DrawingsMatrix
                groups={groups}
                rows={drawingRows}
                drawingById={drawingById}
                openDrawings={openDrawings}
                toggleDrawing={(id) =>
                  toggle(openDrawings, setOpenDrawings, id)
                }
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-titlebar">
              <h2 className="panel-title">Materials</h2>
              <span className="count">{materialRows.length}</span>
              {/* Phase 2 — PDF export button slots here */}
            </div>
            {materialRows.length === 0 ? (
              <p className="kit-empty">No materials reach this project yet.</p>
            ) : (
              <MaterialsMatrix
                groups={groups}
                rows={materialRows}
                materialById={materialById}
                openKits={openKits}
                toggleKit={(id) => toggle(openKits, setOpenKits, id)}
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

// ----- shared section iteration: rows grouped by primaryGroupIndex -----

function sectionsOf(rows, groups) {
  const out = [];
  let last = -1;
  for (const row of rows) {
    if (row.primaryGroupIndex !== last) {
      out.push({
        sectionIndex: row.primaryGroupIndex,
        group: groups[row.primaryGroupIndex],
        rows: [row],
      });
      last = row.primaryGroupIndex;
    } else {
      out[out.length - 1].rows.push(row);
    }
  }
  return out;
}

function SectionHeader({ group, sectionIndex, colCount }) {
  const first = group.members[0];
  const extras = group.members.length - 1;
  return (
    <tr className="matrix-section">
      <td colSpan={colCount}>
        <span className="project-legend-index">G{sectionIndex + 1}</span>{' '}
        {first.to?.toNumber || '?'} · {first.partLabel}
        {first.config && <span className="dim"> · {first.config.name}</span>}
        {extras > 0 && (
          <span className="dim">
            {' '}
            (+ {extras} more — same tails)
          </span>
        )}
      </td>
    </tr>
  );
}

// ----- drawings matrix -----

function DrawingsMatrix({
  groups,
  rows,
  drawingById,
  openDrawings,
  toggleDrawing,
}) {
  const sections = sectionsOf(rows, groups);
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
              <SectionHeader group={section.group} sectionIndex={section.sectionIndex} colCount={1 + groups.length} />
              {section.rows.map((row) => (
                <DrawingRow
                  key={row.drawing.id}
                  row={row}
                  groups={groups}
                  drawingById={drawingById}
                  isOpen={openDrawings.has(row.drawing.id)}
                  onToggle={() => toggleDrawing(row.drawing.id)}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrawingRow({ row, groups, drawingById, isOpen, onToggle }) {
  const d = row.drawing;
  const refIds = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
  const hasRefs = refIds.length > 0;
  return (
    <>
      <tr className="matrix-row">
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
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DrawingRefList({ refIds, drawingById, seen }) {
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
        return (
          <li key={id} className="kit-node">
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
  groups,
  rows,
  materialById,
  openKits,
  toggleKit,
}) {
  const sections = sectionsOf(rows, groups);
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
              <SectionHeader group={section.group} sectionIndex={section.sectionIndex} colCount={1 + groups.length} />
              {section.rows.map((row) => (
                <MaterialRow
                  key={row.material.id}
                  row={row}
                  groups={groups}
                  materialById={materialById}
                  isOpen={openKits.has(row.material.id)}
                  onToggle={() => toggleKit(row.material.id)}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MaterialRow({ row, groups, materialById, isOpen, onToggle }) {
  const m = row.material;
  const isKit =
    !!m.isKit && Array.isArray(m.components) && m.components.length > 0;
  return (
    <>
      <tr className="matrix-row">
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
              components={m.components}
              byId={materialById}
              seen={new Set([m.id])}
            />
          </td>
        </tr>
      )}
    </>
  );
}

