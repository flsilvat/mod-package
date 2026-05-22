// Read-only recursive view of what a kit contains — used where a kit appears
// as a linked material (e.g. on a drawing) and the parts inside it should be
// visible. Nested kits expand automatically, with a cycle guard.

import AlternatesChip from './AlternatesChip';

export default function KitContents({ components, byId, seen }) {
  return (
    <ul className="kit-tree">
      {components.map((component, index) => {
        const material = byId.get(component.materialId);

        if (!material) {
          return (
            <li key={index} className="kit-node">
              <div className="kit-node-row">
                <span className="kit-qty">{component.qty}×</span>
                <span className="mono strong">(missing material)</span>
              </div>
            </li>
          );
        }

        const isCycle = seen.has(material.id);
        const childSeen = new Set(seen);
        childSeen.add(material.id);
        const childComponents = Array.isArray(material.components)
          ? material.components
          : [];

        return (
          <li key={index} className="kit-node">
            <div className="kit-node-row">
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
            {material.isKit && !isCycle && childComponents.length > 0 && (
              <KitContents
                components={childComponents}
                byId={byId}
                seen={childSeen}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
