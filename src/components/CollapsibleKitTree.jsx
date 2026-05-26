import { useState } from 'react';
import AlternatesChip from './AlternatesChip';

// A tree view of a kit's components where each nested kit can be
// individually expanded/collapsed. Mirrors the BucketLineView behaviour
// in the TO Part full view, so an engineer crawling a multi-level kit
// sees the same interaction in both places.
//
// `components` — the kit's direct children (array of { materialId, qty }).
// `byId`       — Map<materialId, material> for lookup.
// `seen`       — Set<materialId> for cycle-guarded recursion. The caller
//                should include the parent kit's id in `seen` before
//                passing the tree in.
export default function CollapsibleKitTree({ components, byId, seen }) {
  return (
    <ul className="kit-tree">
      {components.map((component, index) => (
        <KitNode
          key={index}
          component={component}
          byId={byId}
          seen={seen}
        />
      ))}
    </ul>
  );
}

function KitNode({ component, byId, seen }) {
  const [open, setOpen] = useState(false);
  const material = byId.get(component.materialId);

  if (!material) {
    return (
      <li className="kit-node">
        <div className="kit-node-row">
          <span className="link-caret-spacer" />
          <span className="kit-qty">{component.qty}×</span>
          <span className="mono strong">(missing material)</span>
        </div>
      </li>
    );
  }

  const isCycle = seen.has(material.id);
  const childComponents = Array.isArray(material.components)
    ? material.components
    : [];
  const isExpandable =
    !!material.isKit && childComponents.length > 0 && !isCycle;

  const childSeen = new Set(seen);
  childSeen.add(material.id);

  return (
    <li className="kit-node">
      <div className="kit-node-row">
        {isExpandable ? (
          <button
            className="expand-btn"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="link-caret-spacer" />
        )}
        <span className="kit-qty">{component.qty}×</span>
        <span className="mono strong">{material.partNumber}</span>
        <AlternatesChip materialId={material.id} />
        {material.description && (
          <span className="kit-desc">{material.description}</span>
        )}
        {material.isKit && <span className="tag tag-kit">kit</span>}
        {isCycle && (
          <span className="cycle-flag">circular — not expanded</span>
        )}
      </div>
      {open && isExpandable && (
        <CollapsibleKitTree
          components={childComponents}
          byId={byId}
          seen={childSeen}
        />
      )}
    </li>
  );
}
