import { useState, useEffect, useMemo, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import KitContents from '../components/KitContents';

// Small helper — subscribe to a whole collection into state.
function useCollection(name) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, name), (snap) =>
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [name]);
  return items;
}

export default function TOPartViewPage() {
  const { partId } = useParams();

  // undefined = still loading, null = not found
  const [part, setPart] = useState(undefined);
  useEffect(() => {
    return onSnapshot(doc(db, COLLECTIONS.TO_PART, partId), (snap) => {
      setPart(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [partId]);

  const tos = useCollection(COLLECTIONS.TECHNICAL_ORDER);
  const sbs = useCollection(COLLECTIONS.SERVICE_BULLETIN);
  const configs = useCollection(COLLECTIONS.SB_CONFIG);
  const aircraft = useCollection(COLLECTIONS.AIRCRAFT);
  const htls = useCollection(COLLECTIONS.HTL);
  const gtls = useCollection(COLLECTIONS.GTL);
  const operations = useCollection(COLLECTIONS.OPERATION);
  const drawings = useCollection(COLLECTIONS.DRAWING);
  const materials = useCollection(COLLECTIONS.MATERIAL);

  const aircraftById = useMemo(() => {
    const m = new Map();
    for (const x of aircraft) m.set(x.id, x);
    return m;
  }, [aircraft]);
  const htlById = useMemo(() => {
    const m = new Map();
    for (const x of htls) m.set(x.id, x);
    return m;
  }, [htls]);
  const gtlById = useMemo(() => {
    const m = new Map();
    for (const x of gtls) m.set(x.id, x);
    return m;
  }, [gtls]);
  const drawingById = useMemo(() => {
    const m = new Map();
    for (const x of drawings) m.set(x.id, x);
    return m;
  }, [drawings]);
  const materialById = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  // Operations grouped by GTL, each group ordered by operation number.
  const operationsByGtl = useMemo(() => {
    const m = new Map();
    for (const o of operations) {
      if (!m.has(o.gtlId)) m.set(o.gtlId, []);
      m.get(o.gtlId).push(o);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (Number(a.opNumber) || 0) - (Number(b.opNumber) || 0));
    }
    return m;
  }, [operations]);

  const backLink = (
    <Link to="/technical-orders" className="btn btn-ghost btn-sm">
      ← Technical Orders
    </Link>
  );

  if (part === undefined) {
    return (
      <div className="page">
        {backLink}
        <p className="notice" style={{ marginTop: 16 }}>
          Loading…
        </p>
      </div>
    );
  }

  if (part === null) {
    return (
      <div className="page">
        {backLink}
        <p className="notice notice-error" style={{ marginTop: 16 }}>
          This TO part no longer exists.
        </p>
      </div>
    );
  }

  const to = tos.find((t) => t.id === part.technicalOrderId);
  const sb = to ? sbs.find((s) => s.id === to.sbId) : null;
  const config = configs.find((c) => c.id === part.sbConfigId);
  const htl = htls.find((h) => h.id === part.htlId);
  const configAircraft = config
    ? (config.aircraftIds || [])
        .map((id) => aircraftById.get(id))
        .filter(Boolean)
    : [];
  const htlChildren = htl && Array.isArray(htl.children) ? htl.children : [];

  return (
    <div className="page">
      <div style={{ marginBottom: 16 }}>{backLink}</div>

      <div className="page-head">
        <p className="eyebrow">
          {to ? to.toNumber : '(unknown TO)'}
          {sb ? ` · built from ${sb.sbRef}` : ''}
        </p>
        <h1>{to ? `TO ${to.toNumber} ${part.partLabel}` : part.partLabel}</h1>
        <p className="lede">
          Everything this Technical Order part links to — the configuration it
          covers and the full task list, assembled in one view.
        </p>
      </div>

      {/* ---- configuration ---- */}
      <section className="panel">
        <h2 className="panel-title">Configuration</h2>
        {!config ? (
          <p className="notice">No configuration assigned to this part.</p>
        ) : (
          <>
            <p className="config-name-static" style={{ margin: '0 0 10px' }}>
              {config.name}
            </p>
            {configAircraft.length === 0 ? (
              <p className="kit-empty">No aircraft in this configuration.</p>
            ) : (
              <div className="chip-row">
                {configAircraft.map((a) => (
                  <span key={a.id} className="chip">
                    <span className="mono">{a.registration}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- task list ---- */}
      <section className="panel">
        <h2 className="panel-title">Task list</h2>
        {!htl ? (
          <p className="notice">No HTL assigned to this part.</p>
        ) : (
          <>
            <p
              className="detail-section-title"
              style={{ marginBottom: 12 }}
            >
              HTL {htl.htlRef}
            </p>
            {htlChildren.length === 0 ? (
              <p className="kit-empty">This HTL contains no GTLs or HTLs.</p>
            ) : (
              <HTLTreeView
                items={htlChildren}
                htlById={htlById}
                gtlById={gtlById}
                operationsByGtl={operationsByGtl}
                drawingById={drawingById}
                materialById={materialById}
                seen={new Set([htl.id])}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ----- recursive HTL tree: GTLs carry operations, HTLs nest -----

function HTLTreeView({
  items,
  htlById,
  gtlById,
  operationsByGtl,
  drawingById,
  materialById,
  seen,
}) {
  return (
    <ul className="kit-tree">
      {items.map((child, index) => {
        if (child.type === 'gtl') {
          const g = gtlById.get(child.id);
          const ops = g ? operationsByGtl.get(g.id) || [] : [];
          return (
            <li key={'g' + index} className="kit-node">
              <div className="kit-node-row">
                <span className="tag tag-part">GTL</span>
                <span className="mono strong">
                  {g ? g.gtlRef : '(missing GTL)'}
                </span>
                <span className="kit-desc">
                  {ops.length} operation{ops.length === 1 ? '' : 's'}
                </span>
              </div>
              {ops.length > 0 && (
                <div className="kit-subtree">
                  {ops.map((op) => (
                    <OperationRow
                      key={op.id}
                      op={op}
                      drawingById={drawingById}
                      materialById={materialById}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        }

        // child.type === 'htl'
        const h = htlById.get(child.id);
        if (!h) {
          return (
            <li key={'h' + index} className="kit-node">
              <div className="kit-node-row">
                <span className="tag tag-kit">HTL</span>
                <span className="mono strong">(missing HTL)</span>
              </div>
            </li>
          );
        }
        const isCycle = seen.has(h.id);
        const childSeen = new Set(seen);
        childSeen.add(h.id);
        const grandChildren = Array.isArray(h.children) ? h.children : [];

        return (
          <li key={'h' + index} className="kit-node">
            <div className="kit-node-row">
              <span className="tag tag-kit">HTL</span>
              <span className="mono strong">{h.htlRef}</span>
              {isCycle && (
                <span className="cycle-flag">circular — not expanded</span>
              )}
            </div>
            {!isCycle && grandChildren.length > 0 && (
              <HTLTreeView
                items={grandChildren}
                htlById={htlById}
                gtlById={gtlById}
                operationsByGtl={operationsByGtl}
                drawingById={drawingById}
                materialById={materialById}
                seen={childSeen}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ----- one operation: text always shown, links behind an expand -----

function OperationRow({ op, drawingById, materialById }) {
  const [open, setOpen] = useState(false);
  const [openKits, setOpenKits] = useState(() => new Set());

  const drawingIds = op.drawingIds || [];
  const matLinks = op.materials || [];

  function toggleKit(id) {
    setOpenKits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="op-card">
      <div className="op-head">
        <button
          className="expand-btn"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        
        <span className="op-number">{op.opNumber}</span>
        <span className="op-snippet">
          {op.text || <span className="dim">(no instruction)</span>}
        </span>
        <div className="op-head-meta">
          {op.engineerType && (
            <span className="tag tag-skill">{op.engineerType}</span>
          )}
          {matLinks.length > 0 && (
            <span className="tag tag-count">{matLinks.length}× material</span>
          )}
          {drawingIds.length > 0 && (
            <span className="tag tag-count">{drawingIds.length}× dwg</span>
          )}
        </div>

      </div>

      {open && (
        <div className="op-body">
          <div className="op-sub">
            <p className="detail-section-title">Drawings</p>
            {drawingIds.length === 0 ? (
              <p className="kit-empty">No drawings linked.</p>
            ) : (
              <ul className="link-list">
                {drawingIds.map((id) => {
                  const d = drawingById.get(id);
                  return (
                    <li key={id} className="link-row">
                      <span className="mono strong">
                        {d ? d.docNumber : '(missing drawing)'}
                      </span>
                      {d?.rev && <span className="kit-qty">rev {d.rev}</span>}
                      {d?.title && (
                        <span className="kit-desc">{d.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="op-sub">
            <p className="detail-section-title">Materials</p>
            {matLinks.length === 0 ? (
              <p className="kit-empty">No materials linked.</p>
            ) : (
              <ul className="link-list">
                {matLinks.map((link) => {
                  const m = materialById.get(link.materialId);
                  const comps = Array.isArray(m?.components)
                    ? m.components
                    : [];
                  const isKit = !!m?.isKit && comps.length > 0;
                  const kitOpen = isKit && openKits.has(link.materialId);
                  return (
                    <Fragment key={link.materialId}>
                      <li className="link-row">
                        {isKit ? (
                          <button
                            className="expand-btn"
                            onClick={() => toggleKit(link.materialId)}
                            aria-label={kitOpen ? 'Collapse' : 'Expand'}
                          >
                            {kitOpen ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="link-caret-spacer" />
                        )}
                        <span className="kit-qty">{link.qty}×</span>
                        <span className="mono strong">
                          {m ? m.partNumber : '(missing material)'}
                        </span>
                        {m?.description && (
                          <span className="kit-desc">{m.description}</span>
                        )}
                        {m?.isKit && <span className="tag tag-kit">kit</span>}
                      </li>
                      {kitOpen && (
                        <li className="kit-subtree">
                          <KitContents
                            components={comps}
                            byId={materialById}
                            seen={new Set([m.id])}
                          />
                        </li>
                      )}
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
