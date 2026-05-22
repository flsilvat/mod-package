import { useScope } from '../lib/scope';

// Small chip shown next to a material's part number wherever a part is
// listed — bucket lines, operation materials, kit contents, the catalogue.
// Renders nothing when the material has no interchange group. The native
// title tooltip lists the alternates and the group's note.
export default function AlternatesChip({ materialId }) {
  const { alternatesMap, groupByMaterialId, materialById } = useScope();
  const set = alternatesMap.get(materialId);
  if (!set || set.size <= 1) return null;

  const count = set.size - 1;
  const otherPNs = [];
  for (const id of set) {
    if (id === materialId) continue;
    const m = materialById.get(id);
    otherPNs.push(m ? m.partNumber : '(missing)');
  }
  const group = groupByMaterialId.get(materialId);
  const title =
    `Interchangeable with ${otherPNs.join(', ')}` +
    (group?.note ? ` — ${group.note}` : '');

  return (
    <span className="tag tag-alt" title={title}>
      ⇄ {count}
    </span>
  );
}
