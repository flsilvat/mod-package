import { useState, useEffect, useMemo, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { computeConfigBucket, reconcileBucket } from '../lib/bucket';
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

// Walk an HTL's children, gathering every operation reachable through GTLs
// and nested HTLs. Cycle-guarded.
function collectReachableOperations(
  htlId,
  htlById,
  operationsByGtl,
  seen = new Set()
) {
  if (seen.has(htlId)) return [];
  seen.add(htlId);
  const htl = htlById.get(htlId);
  if (!htl || !Array.isArray(htl.children)) return [];
  const result = [];
  for (const child of htl.children) {
    if (child.type === 'gtl') {
      const ops = operationsByGtl.get(child.id) || [];
      result.push(...ops);
    } else if (child.type === 'htl') {
      result.push(
        ...collectReachableOperations(
          child.id,
          htlById,
          operationsByGtl,
          seen
        )
      );
    }
  }
  return result;
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

  // Open/closed state for individual operations on this page. Lifted up so
  // an Expand-all / Collapse-all control can flip everything at once.
  const [openOpIds, setOpenOpIds] = useState(() => new Set());
  // Transient flag so the "Copy operations" button can show a "Copied"
  // confirmation for a couple of seconds.
  const [copied, setCopied] = useState(false);

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
  const operationsById = useMemo(() => {
    const m = new Map();
    for (const x of operations) m.set(x.id, x);
    return m;
  }, [operations]);

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

  // ----- bucket + reconciliation -----
  // Compute the bucket from the SB config (parent SB + applicable drawings),
  // then gather every operation entry reachable from this part's HTL and
  // reconcile.
  const bucket =
    config && sb
      ? computeConfigBucket(config, { sb, drawingById, materialById })
      : [];
  const reachableOps = htl
    ? collectReachableOperations(htl.id, htlById, operationsByGtl)
    : [];
  const entries = reachableOps.flatMap((op) =>
    (op.materials || []).map((e) => ({
      materialId: e.materialId,
      qty: Number(e.qty) || 0,
      fromKitId: e.fromKitId || null,
      opId: op.id,
    }))
  );
  // Not memoized — reconcileBucket is a cheap pure function over small
  // inputs, and useMemo here would have to sit below the early returns,
  // which violates the Rules of Hooks. Just call it directly.
  const recon = reconcileBucket(bucket, entries, materialById);

  // ----- task-list controls -----

  function toggleOp(id) {
    setOpenOpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenOpIds(new Set(reachableOps.map((o) => o.id)));
  }

  function collapseAll() {
    setOpenOpIds(new Set());
  }

  // Copy every reachable operation's text to the clipboard, in walk order.
  // Each block is "Op {n} · {engineerType}" followed by the instruction.
  async function copyAllOpsText() {
    const text = reachableOps
      .map((op) => {
        const header = `Op ${op.opNumber}${
          op.engineerType ? ` · ${op.engineerType}` : ''
        }`;
        return `${header}\n${op.text || '(no instruction)'}`;
      })
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  }

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
          covers, the materials bucket assembled from it, and the full task
          list.
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

      {/* ---- materials bucket ---- */}
      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Materials bucket</h2>
          {bucket.length > 0 && (
            <span className="count">{bucket.length}</span>
          )}
        </div>
        {!config || !sb ? (
          <p className="notice">
            No configuration assigned — the bucket can't be computed yet.
          </p>
        ) : bucket.length === 0 ? (
          <p className="kit-empty">
            Nothing in this configuration's bucket yet.
          </p>
        ) : (
          <ul className="link-list">
            {recon.lines.map((line) => (
              <BucketLineView
                key={line.materialId}
                line={line}
                materialById={materialById}
                operationsById={operationsById}
                gtlById={gtlById}
              />
            ))}
          </ul>
        )}

        {recon.extras.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p className="detail-section-title">
              Not in bucket{' '}
              <span className="dim">
                · {recon.extras.length} entr
                {recon.extras.length === 1 ? 'y' : 'ies'}
              </span>
            </p>
            <ul className="link-list">
              {recon.extras.map((e, i) => (
                <ExtraRow
                  key={i}
                  entry={e}
                  materialById={materialById}
                  operationsById={operationsById}
                  gtlById={gtlById}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---- task list ---- */}
      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Task list</h2>
          {reachableOps.length > 0 && (
            <div className="task-controls">
              <button
                className="btn btn-ghost btn-sm"
                onClick={expandAll}
              >
                Expand all
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={collapseAll}
              >
                Collapse all
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={copyAllOpsText}
              >
                {copied ? '✓ Copied' : 'Copy operations'}
              </button>
            </div>
          )}
        </div>
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
                openOpIds={openOpIds}
                toggleOp={toggleOp}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ----- bucket scoreboard rows -----

function BucketLineView({ line, materialById, operationsById, gtlById }) {
  const [open, setOpen] = useState(false);
  const m = materialById.get(line.materialId);
  const expandable = line.state !== 'untouched';
  const hasBody =
    line.state === 'cracked' ||
    (line.distributions && line.distributions.length > 0);

  return (
    <Fragment>
      <li className="link-row">
        {expandable && hasBody ? (
          <button
            className="expand-btn"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="link-caret-spacer" />
        )}
        <span className="kit-qty">{line.requiredQty}×</span>
        <span className="mono strong">
          {m ? m.partNumber : '(missing material)'}
        </span>
        {m?.description && <span className="kit-desc">{m.description}</span>}
        {line.isKit && <span className="tag tag-kit">kit</span>}
        <StatusBadge line={line} />
      </li>
      {open && hasBody && (
        <li className="kit-subtree">
          {line.state === 'cracked' ? (
            <ul className="link-list">
              {line.crackedSub.map((sub, i) => (
                <BucketSubLineView
                  key={i}
                  sub={sub}
                  parentKitId={line.materialId}
                  materialById={materialById}
                  operationsById={operationsById}
                  gtlById={gtlById}
                />
              ))}
            </ul>
          ) : (
            <DistributionList
              distributions={line.distributions}
              operationsById={operationsById}
              gtlById={gtlById}
            />
          )}
        </li>
      )}
    </Fragment>
  );
}

// Recursive sub-line view for components inside a cracked kit.
function BucketSubLineView({
  sub,
  parentKitId,
  materialById,
  operationsById,
  gtlById,
}) {
  const [open, setOpen] = useState(false);
  const m = materialById.get(sub.materialId);
  const parent = materialById.get(parentKitId);
  const expandable = sub.state !== 'untouched';
  const hasBody =
    sub.state === 'cracked' ||
    (sub.distributions && sub.distributions.length > 0);

  return (
    <Fragment>
      <li className="link-row">
        {expandable && hasBody ? (
          <button
            className="expand-btn"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="link-caret-spacer" />
        )}
        <span className="kit-qty">{sub.requiredQty}×</span>
        <span className="mono strong">
          {m ? m.partNumber : '(missing material)'}
        </span>
        {m?.description && <span className="kit-desc">{m.description}</span>}
        {sub.isKit && <span className="tag tag-kit">kit</span>}
        {parent && (
          <span className="dim">from {parent.partNumber}</span>
        )}
        <StatusBadge line={sub} />
      </li>
      {open && hasBody && (
        <li className="kit-subtree">
          {sub.state === 'cracked' ? (
            <ul className="link-list">
              {sub.crackedSub.map((deeper, i) => (
                <BucketSubLineView
                  key={i}
                  sub={deeper}
                  parentKitId={sub.materialId}
                  materialById={materialById}
                  operationsById={operationsById}
                  gtlById={gtlById}
                />
              ))}
            </ul>
          ) : (
            <DistributionList
              distributions={sub.distributions}
              operationsById={operationsById}
              gtlById={gtlById}
            />
          )}
        </li>
      )}
    </Fragment>
  );
}

function DistributionList({ distributions, operationsById, gtlById }) {
  if (!distributions || distributions.length === 0) return null;
  return (
    <ul className="link-list">
      {distributions.map((d, i) => {
        const op = operationsById.get(d.opId);
        const gtl = op ? gtlById.get(op.gtlId) : null;
        return (
          <li key={i} className="link-row">
            <span className="link-caret-spacer" />
            <span className="kit-qty">{d.qty}×</span>
            <span className="dim">to</span>
            {gtl && <span className="mono">{gtl.gtlRef}</span>}
            {op && <span className="mono strong">op {op.opNumber}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ExtraRow({ entry, materialById, operationsById, gtlById }) {
  const m = materialById.get(entry.materialId);
  const op = operationsById.get(entry.opId);
  const gtl = op ? gtlById.get(op.gtlId) : null;
  const fromKit = entry.fromKitId ? materialById.get(entry.fromKitId) : null;
  return (
    <li className="link-row">
      <span className="link-caret-spacer" />
      <span className="kit-qty">{entry.qty}×</span>
      <span className="mono strong">
        {m ? m.partNumber : '(unknown material)'}
      </span>
      {m?.description && <span className="kit-desc">{m.description}</span>}
      <span className="dim">in</span>
      {gtl && <span className="mono">{gtl.gtlRef}</span>}
      {op && <span className="mono strong">op {op.opNumber}</span>}
      {entry.fromKitId && (
        <span className="dim">
          tagged from {fromKit ? fromKit.partNumber : '(missing kit)'}
        </span>
      )}
      <span className="tag tag-warn">not in bucket</span>
    </li>
  );
}

function StatusBadge({ line }) {
  const { state, distributedWhole, requiredQty, isKit } = line;
  switch (state) {
    case 'complete':
      return (
        <span className="tag tag-ready">{isKit ? 'whole' : 'complete'}</span>
      );
    case 'short':
      return (
        <span className="tag tag-warn">
          {distributedWhole}/{requiredQty}
        </span>
      );
    case 'over':
      return (
        <span className="tag tag-warn">
          over by {distributedWhole - requiredQty}
        </span>
      );
    case 'cracked':
      return <span className="tag tag-count">cracked</span>;
    case 'mixed':
      return <span className="tag tag-warn">mixed</span>;
    case 'untouched':
    default:
      return <span className="dim">untouched</span>;
  }
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
  openOpIds,
  toggleOp,
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
                      isOpen={openOpIds.has(op.id)}
                      onToggle={() => toggleOp(op.id)}
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
                openOpIds={openOpIds}
                toggleOp={toggleOp}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ----- one operation: text always shown, links behind an expand -----

// ----- one operation: compact head with pills, snippet preview when
//       closed; full text + drawings + materials when open. The open state
//       is owned by the page so the Expand/Collapse-all buttons can flip
//       everything at once. -----

function OperationRow({ op, drawingById, materialById, isOpen, onToggle }) {
  const [openKits, setOpenKits] = useState(() => new Set());
  // Per-row clipboard state so the button can flash "Copied" briefly.
  const [copied, setCopied] = useState(false);

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

  async function copyOpText() {
    if (!op.text) return;
    try {
      await navigator.clipboard.writeText(op.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  }

  return (
    <div className="op-card">
      <div className="op-head">
        <button
          className="expand-btn"
          onClick={onToggle}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <span className="op-number">{op.opNumber}</span>
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

      {!isOpen && (
        <div className="op-snippet-row">
          <span className="op-snippet-preview">
            {op.text || <span className="dim">(no instruction)</span>}
          </span>
        </div>
      )}

      {isOpen && (
        <div className="op-body">
          <div className="op-readtext-wrap">
            <p className="op-readtext">
              {op.text || <span className="dim">(no instruction)</span>}
            </p>
            {op.text && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={copyOpText}
              >
                {copied ? '✓ Copied' : 'Copy operation'}
              </button>
            )}
          </div>

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
                  const fromKit = link.fromKitId
                    ? materialById.get(link.fromKitId)
                    : null;
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
                        {link.fromKitId && (
                          <span className="tag tag-count">
                            from{' '}
                            {fromKit ? fromKit.partNumber : '(missing kit)'}
                          </span>
                        )}
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
