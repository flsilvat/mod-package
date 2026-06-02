// The two project PDF exports: drawings and materials.
//
// Both are black-ink-only A4 portrait. Identifiers (drawing/part numbers)
// render in built-in Courier so they align monospaced; everything else is
// Inter. Matrix applicability is shown with small filled circles drawn in
// didDrawCell (font-independent, ink-light); material cells show quantities.
//
// Sectioning mirrors the web view: rows are grouped under their primary
// TO Part, columns are the merged aircraft-set groups (G1…Gn).

import autoTable from 'jspdf-autotable';
import {
  newDoc,
  drawHeader,
  drawGroupLegend,
  drawFooter,
  PAGE,
  CONTENT_WIDTH,
  INK,
  SOFT,
  RULE,
  TREE,
  MONO,
} from './pdfCommon';

// Group rows (drawingRows / materialRows) into sections keyed by their
// primaryPartIndex, in part order. Mirrors sectionsOf in ProjectViewPage.
function sectionsByPart(rows, parts) {
  const out = [];
  let last = -1;
  for (const row of rows) {
    if (row.primaryPartIndex !== last) {
      out.push({ part: parts[row.primaryPartIndex], rows: [row] });
      last = row.primaryPartIndex;
    } else {
      out[out.length - 1].rows.push(row);
    }
  }
  return out;
}

function sectionLabel(part, sbsById) {
  if (!part) return '(no TO Part)';
  const sb = part.config ? sbsById.get(part.config.sbId) : null;
  const bits = [`${part.to?.toNumber || '?'} · ${part.partLabel || '(no part)'}`];
  if (sb) bits.push(`${sb.sbRef}${sb.rev ? ` rev ${sb.rev}` : ''}`);
  if (part.config) bits.push(part.config.name);
  if (sb?.title) bits.push(sb.title);
  return bits.join('  ·  ');
}

// Frame a header string as a centered banner: an em-dash on each side sets
// section/kit header rows apart from the left-aligned content rows.
function bannerText(text) {
  return `\u2014  ${text}  \u2014`;
}

// Compute group column width that fits the content area, clamped to a
// sensible range so a handful of groups stay readable but many groups
// still fit before autotable wraps.
function groupColWidth(groupCount, min, max, labelReserve) {
  const avail = CONTENT_WIDTH - labelReserve;
  const w = avail / Math.max(1, groupCount);
  return Math.max(min, Math.min(max, w));
}

// ---------- Drawings PDF ----------

export function exportDrawingsPdf({
  project,
  parts,
  groups,
  drawingRows,
  drawingById,
  sbsById,
}) {
  const doc = newDoc();
  let y = drawHeader(doc, {
    projectName: project.name,
    subtitle: 'Drawings',
    description: project.description,
  });
  y = drawGroupLegend(doc, { groups, sbsById, startY: y });

  const totalCols = 2 + groups.length;
  const TREE_PAD = 1.5; // left inset before the first connector column
  const treeStep = 3; //   per-level indent inside the Drawing column

  // Build body + a per-row map of which group columns get a tick. A drawing
  // with reference children renders as a tree (root + refs, connectors drawn
  // in the Drawing column via didDrawCell); a childless drawing stays a plain
  // flush-left row exactly as before.
  const body = [];
  const tickMap = {}; // bodyRowIndex -> Set<groupIndex>
  let maxRefDepth = 0;

  for (const section of sectionsByPart(drawingRows, parts)) {
    body.push([
      {
        content: bannerText(sectionLabel(section.part, sbsById)),
        colSpan: totalCols,
        _section: true,
      },
    ]);
    for (const row of section.rows) {
      const d = row.drawing;
      const refIds = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
      if (!refIds.length) {
        // No children -> plain row, no tree.
        const arr = [d.docNumber || '', drawingDetail(d, false)];
        for (let i = 0; i < groups.length; i++) arr.push('');
        tickMap[body.length] = row.appliesTo;
        body.push(arr);
        continue;
      }
      // Has children -> the drawing and its ref tree, with connectors.
      const flat = [];
      flattenDrawingTree(d, drawingById, flat);
      flat.forEach((node, idx) => {
        const arr = [{ content: node.docNumber, _tree: node.tree }, node.detail];
        for (let i = 0; i < groups.length; i++) arr.push('');
        // Ticks belong to the root drawing only; refs inherit its columns.
        if (idx === 0) tickMap[body.length] = row.appliesTo;
        body.push(arr);
        if (node.tree.depth > maxRefDepth) maxRefDepth = node.tree.depth;
      });
    }
  }

  // The Drawing column widens with the deepest ref nesting so indented
  // numbers still fit; plain tables (no trees) keep the original width.
  const noW =
    maxRefDepth === 0
      ? 34
      : Math.min(
          66,
          Math.max(38, Math.ceil(TREE_PAD + (maxRefDepth + 1) * treeStep + 32))
        );
  const gW = groupColWidth(groups.length, 8, 13, noW + 56);
  const titleW = CONTENT_WIDTH - noW - gW * groups.length;

  const head = [['Drawing', 'Detail', ...groups.map((_, i) => `G${i + 1}`)]];

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'Inter',
      fontSize: 8,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0.1,
      cellPadding: 1.4,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      font: 'Inter',
      fontStyle: 'bold',
      fillColor: false,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0.2,
      halign: 'center',
    },
    columnStyles: {
      0: { font: MONO, cellWidth: noW },
      1: { cellWidth: titleW },
      ...Object.fromEntries(
        groups.map((_, i) => [i + 2, { cellWidth: gW, halign: 'center' }])
      ),
    },
    didParseCell: (data) => {
      const isSection =
        data.section === 'body' && data.cell.colSpan === totalCols;
      if (isSection) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.font = 'Inter';
        data.cell.styles.textColor = INK;
        data.cell.styles.fontSize = 8;
        data.cell.styles.halign = 'center';
      }
      // The first column header should be left-aligned to match its cells.
      if (data.section === 'head' && data.column.index <= 1) {
        data.cell.styles.halign = 'left';
      }
      // Indent a tree row's drawing number to leave room for its connectors.
      if (data.section === 'body' && data.column.index === 0 && !isSection) {
        const raw = data.cell.raw;
        const meta = raw && typeof raw === 'object' ? raw._tree : null;
        if (meta) {
          data.cell.styles.cellPadding = {
            top: 1.4,
            right: 1.4,
            bottom: 1.4,
            left: TREE_PAD + (meta.depth + 1) * treeStep,
          };
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
      // Tree connectors in the Drawing column (only for ref-tree rows).
      if (
        data.column.index === 0 &&
        !(data.cell.colSpan && data.cell.colSpan > 1)
      ) {
        const raw = data.cell.raw;
        const meta = raw && typeof raw === 'object' ? raw._tree : null;
        if (meta) {
          drawDrawingTreeCell(doc, data, meta, {
            startPad: TREE_PAD,
            step: treeStep,
          });
        }
      }
      if (data.column.index < 2) return;
      if (data.cell.colSpan && data.cell.colSpan > 1) return; // section row
      const ticks = tickMap[data.row.index];
      const gi = data.column.index - 2;
      if (ticks && ticks.has(gi)) {
        const cx = data.cell.x + data.cell.width / 2;
        const cy = data.cell.y + data.cell.height / 2;
        doc.setFillColor(...INK);
        doc.circle(cx, cy, 1.1, 'F');
      }
    },
  });

  drawFooter(doc);
  doc.save(pdfName(project.name, 'drawings'));
}

// Compose a drawing's "Detail" cell (rev / SAP dir / title), flagging cycles.
function drawingDetail(d, isCycle) {
  const bits = [];
  if (d.rev) bits.push(`rev ${d.rev}`);
  if (d.sapDir) bits.push(`(${d.sapDir})`);
  if (d.title) bits.push(d.title);
  if (isCycle) bits.push('\u2014 circular');
  return bits.join('  \u00b7  ');
}

// Flatten a drawing + its reference tree into ordered render nodes (root at
// depth 0, refs depth-first). Cycle-guarded. Mirrors flattenKit; each node
// carries the tree metadata the connector drawer needs.
function flattenDrawingTree(drawing, drawingById, out) {
  out.push({
    docNumber: drawing.docNumber || '',
    detail: drawingDetail(drawing, false),
    tree: {
      depth: 0,
      ancestorsContinue: [],
      isLast: true,
      isRoot: true,
      hasChildren:
        Array.isArray(drawing.refDrawingIds) &&
        drawing.refDrawingIds.length > 0,
    },
  });
  const walk = (refIds, ancestorsContinue, seen) => {
    refIds.forEach((id, i) => {
      const isLast = i === refIds.length - 1;
      const dr = drawingById.get(id);
      const isCycle = dr ? seen.has(id) : false;
      const childRefs =
        dr && !isCycle && Array.isArray(dr.refDrawingIds)
          ? dr.refDrawingIds
          : [];
      const hasChildren = childRefs.length > 0;
      out.push({
        docNumber: dr ? dr.docNumber || '' : '(missing)',
        detail: dr ? drawingDetail(dr, isCycle) : '',
        tree: {
          depth: ancestorsContinue.length + 1,
          ancestorsContinue: ancestorsContinue.slice(),
          isLast,
          isRoot: false,
          hasChildren,
        },
      });
      if (hasChildren) {
        const ns = new Set(seen);
        ns.add(id);
        walk(childRefs, [...ancestorsContinue, !isLast], ns);
      }
    });
  };
  walk(
    Array.isArray(drawing.refDrawingIds) ? drawing.refDrawingIds : [],
    [],
    new Set([drawing.id])
  );
}

// Draw the accent-blue ref-tree connectors inside a Drawing-column cell.
// Same geometry as the materials kit tree: ancestor pass-through bars, a
// connect-up stub + arm per node, a down-continue when more siblings follow,
// and a drop into the child column for nodes that have children. The drawing
// number text is indented (via cellPadding) to sit just past the arm.
function drawDrawingTreeCell(doc, data, meta, cfg) {
  const { startPad, step } = cfg;
  const x0 = data.cell.x;
  const top = data.cell.y;
  const bottom = data.cell.y + data.cell.height;
  const mid = data.cell.y + data.cell.height / 2;
  const vx = (k) => x0 + startPad + k * step;
  const D = meta.depth;
  const contentX = x0 + startPad + (D + 1) * step; // matches cellPadding.left

  doc.setDrawColor(...TREE);
  doc.setLineWidth(0.25);

  if (!meta.isRoot) {
    const d = meta.ancestorsContinue.length; // = D - 1
    meta.ancestorsContinue.forEach((cont, i) => {
      if (cont) doc.line(vx(i), top, vx(i), bottom);
    });
    doc.line(vx(d), top, vx(d), mid); // connect up
    if (!meta.isLast) doc.line(vx(d), mid, vx(d), bottom); // continue down
    doc.line(vx(d), mid, contentX - 1.5, mid); // arm to the drawing number
  } else {
    // root drawing: short arm linking the spine top to the number
    doc.line(vx(0), mid, contentX - 1.5, mid);
  }
  if (meta.hasChildren) {
    doc.line(vx(D), mid, vx(D), bottom); // drop to children
  }
}

// ---------- Materials PDF ----------

export function exportMaterialsPdf({
  project,
  parts,
  groups,
  materialRows,
  materialById,
  sbsById,
  alternatesMap,
}) {
  const doc = newDoc();
  let y = drawHeader(doc, {
    projectName: project.name,
    subtitle: 'Materials',
    description: project.description,
  });
  y = drawGroupLegend(doc, { groups, sbsById, startY: y });

  // --- main bucket matrix (kits opaque, cells = quantities) ---
  const totalCols = 2 + groups.length;
  const gW = groupColWidth(groups.length, 10, 16, 34 + 50);
  const noW = 34;
  const descW = CONTENT_WIDTH - noW - gW * groups.length;

  const body = [];
  for (const section of sectionsByPart(materialRows, parts)) {
    body.push([
      {
        content: bannerText(sectionLabel(section.part, sbsById)),
        colSpan: totalCols,
        _section: true,
      },
    ]);
    for (const row of section.rows) {
      const m = row.material;
      const desc = [m.description || '', m.isKit ? '[kit]' : '']
        .filter(Boolean)
        .join('  ');
      const set = alternatesMap && alternatesMap.get(m.id);
      const altCount = set ? set.size - 1 : 0;
      const arr = [{ content: m.partNumber || '', _alt: altCount }, desc];
      for (const q of row.quantities) {
        arr.push(q != null && q > 0 ? String(q) : '');
      }
      body.push(arr);
    }
  }

  doc.setFont('Inter', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text('Materials required per aircraft', PAGE.margin, y);
  y += 1;

  autoTable(doc, {
    startY: y + 1,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head: [['Part', 'Description', ...groups.map((_, i) => `G${i + 1}`)]],
    body,
    theme: 'grid',
    styles: {
      font: 'Inter',
      fontSize: 8,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0.1,
      cellPadding: 1.4,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      font: 'Inter',
      fontStyle: 'bold',
      fillColor: false,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0.2,
      halign: 'center',
    },
    columnStyles: {
      0: { font: MONO, cellWidth: noW },
      1: { cellWidth: descW },
      ...Object.fromEntries(
        groups.map((_, i) => [
          i + 2,
          { cellWidth: gW, halign: 'center', font: MONO },
        ])
      ),
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.cell.colSpan === totalCols) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.font = 'Inter';
        data.cell.styles.textColor = INK;
        data.cell.styles.fontSize = 8;
        data.cell.styles.halign = 'center';
      }
      if (data.section === 'head' && data.column.index <= 1) {
        data.cell.styles.halign = 'left';
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
      if (data.column.index !== 0) return;
      if (data.cell.colSpan && data.cell.colSpan > 1) return; // section row
      const raw = data.cell.raw;
      const altCount = raw && typeof raw === 'object' ? raw._alt : 0;
      if (!altCount) return;
      // Place the chip just after the part number, clamped to the cell's
      // right edge so it never spills into the description column.
      doc.setFont(MONO, 'normal');
      doc.setFontSize(8);
      const pnText = (raw && raw.content) || '';
      const pnW = doc.getTextWidth(String(pnText));
      const chipW = altChipWidth(doc, altCount);
      const padLeft = 1.4;
      const desiredX = data.cell.x + padLeft + pnW + 1.4;
      const maxX = data.cell.x + data.cell.width - chipW - 0.6;
      const chipX = Math.min(desiredX, Math.max(data.cell.x + padLeft, maxX));
      drawAltChip(doc, chipX, data.cell.y + data.cell.height / 2, altCount);
    },
  });

  // --- kit list: every kit in the bucket, fully expanded ---
  const kits = materialRows
    .map((r) => r.material)
    .filter((m) => m.isKit && Array.isArray(m.components) && m.components.length);

  if (kits.length) {
    let ky = doc.lastAutoTable.finalY + 8;
    // Start the kit list on a fresh page if there's little room left.
    if (ky > PAGE.height - 40) {
      doc.addPage();
      ky = PAGE.margin;
    }
    doc.setFont('Inter', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text('Kit list · fully expanded', PAGE.margin, ky);

    drawKitTreeSection(doc, kits, materialById, alternatesMap, ky + 4);
  }

  drawFooter(doc);
  doc.save(pdfName(project.name, 'materials'));
}

// Flatten a kit into an ordered list of render nodes for the rich tree.
// Node 0 is the kit itself (the root, drawn as a bold line with no quantity);
// the rest are its contents, depth-first. Cycle-guarded.
//
// Each node: { depth, ancestorsContinue, isLast, isRoot, hasChildren, qty,
// pn, desc, isKit, altCount, isCycle }. `ancestorsContinue[i]` is true where
// the ancestor at level i still has a later sibling (so a vertical line runs
// down through this row).
function flattenKit(kit, materialById, alternatesMap, out) {
  const altOf = (id) => {
    const s = alternatesMap && alternatesMap.get(id);
    return s ? s.size - 1 : 0;
  };
  out.push({
    depth: 0,
    ancestorsContinue: [],
    isLast: true,
    isRoot: true,
    hasChildren: Array.isArray(kit.components) && kit.components.length > 0,
    qty: null,
    pn: kit.partNumber || '',
    desc: kit.description || '',
    isKit: true,
    altCount: altOf(kit.id),
    isCycle: false,
  });
  const walk = (components, ancestorsContinue, seen) => {
    if (!Array.isArray(components)) return;
    components.forEach((comp, i) => {
      const isLast = i === components.length - 1;
      const child = materialById.get(comp.materialId);
      const isCycle = child ? seen.has(comp.materialId) : false;
      const hasChildren =
        !!(child && child.isKit) &&
        !isCycle &&
        Array.isArray(child.components) &&
        child.components.length > 0;
      out.push({
        depth: ancestorsContinue.length + 1,
        ancestorsContinue: ancestorsContinue.slice(),
        isLast,
        isRoot: false,
        hasChildren,
        qty: comp.qty,
        pn: child ? child.partNumber || '' : '(missing)',
        desc: child
          ? [child.description || '', isCycle ? '\u2014 circular' : '']
              .filter(Boolean)
              .join('  ')
          : '',
        isKit: !!(child && child.isKit),
        altCount: child ? altOf(comp.materialId) : 0,
        isCycle,
      });
      if (hasChildren) {
        const nextSeen = new Set(seen);
        nextSeen.add(comp.materialId);
        walk(child.components, [...ancestorsContinue, !isLast], nextSeen);
      }
    });
  };
  walk(kit.components, [], new Set([kit.id]));
}

// Small rounded "KIT" / "PART" type pill. Kit = light accent wash + accent
// text; part = light grey + muted text. Returns x after the pill.
const PILL = { h: 3.4, padX: 1.3, fontSize: 6 };

function pillWidth(doc, isKit) {
  doc.setFont('Inter', 'bold');
  doc.setFontSize(PILL.fontSize);
  return doc.getTextWidth(isKit ? 'KIT' : 'PART') + PILL.padX * 2;
}

function drawTypePill(doc, x, centerY, isKit) {
  const txt = isKit ? 'KIT' : 'PART';
  doc.setFont('Inter', 'bold');
  doc.setFontSize(PILL.fontSize);
  const w = doc.getTextWidth(txt) + PILL.padX * 2;
  const y = centerY - PILL.h / 2;
  if (isKit) {
    doc.setFillColor(223, 233, 245);
    doc.roundedRect(x, y, w, PILL.h, 0.7, 0.7, 'F');
    doc.setTextColor(...TREE);
  } else {
    doc.setFillColor(234, 234, 234);
    doc.roundedRect(x, y, w, PILL.h, 0.7, 0.7, 'F');
    doc.setTextColor(110, 110, 110);
  }
  doc.text(txt, x + PILL.padX, centerY + 0.05, { baseline: 'middle' });
  doc.setTextColor(...INK);
  return x + w;
}

// Draw one render node as a row of the rich kit tree and return the y of the
// row's bottom. Console-tree connectors (accent blue) link parents to
// children; the horizontal arm runs all the way to the start of the row's
// content. Content: quantity (accent, small x) - PN (mono) - type pill -
// alternates chip - description (pale, wraps). Page-break aware.
function drawKitNode(doc, node, cfg, y) {
  const { left, right, step, lineH, rowPadV, pageBottom } = cfg;
  const D = node.depth;
  const vx = (k) => left + k * step;
  // Content sits one full step past the children's drop column (vx(D)). This
  // keeps the per-level indentation uniform AND lets the parent's horizontal
  // arm extend well past the drop on the right, so the child-drop lands near
  // the centre of the arm rather than hugging its right end.
  const contentX = left + D * step + 5;

  // measure prefix widths so the description can wrap into the remaining room
  let qtyW = 0;
  const qtyStr = node.qty != null ? String(node.qty) : '';
  if (qtyStr) {
    doc.setFont(MONO, 'bold');
    doc.setFontSize(8.5);
    const numW = doc.getTextWidth(qtyStr);
    doc.setFontSize(6.2);
    const xW = doc.getTextWidth('\u00d7');
    qtyW = numW + 0.4 + xW + 1.8;
  }
  doc.setFont(MONO, node.isRoot ? 'bold' : 'normal');
  doc.setFontSize(8.5);
  const pnW = doc.getTextWidth(node.pn || '');
  const pW = pillWidth(doc, node.isKit);
  const chipW = node.altCount ? altChipWidth(doc, node.altCount) : 0;

  const pnX = contentX + qtyW;
  const pillX = pnX + pnW + 2;
  const chipX = pillX + pW + 2;
  const descX = chipX + (chipW ? chipW + 2 : 0);

  doc.setFont('Inter', 'normal');
  doc.setFontSize(8);
  const descLines = node.desc
    ? doc.splitTextToSize(node.desc, Math.max(24, right - descX))
    : [];
  const nLines = Math.max(1, descLines.length);
  const rowH = nLines * lineH + rowPadV * 2;

  if (y + rowH > pageBottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  const top = y;
  const bottom = y + rowH;
  const firstMid = y + rowPadV + lineH / 2;

  doc.setDrawColor(...TREE);
  doc.setLineWidth(0.25);

  if (!node.isRoot) {
    const d = node.ancestorsContinue.length; // = D - 1
    node.ancestorsContinue.forEach((cont, i) => {
      if (cont) doc.line(vx(i), top, vx(i), bottom);
    });
    doc.line(vx(d), top, vx(d), firstMid); // connect up
    if (!node.isLast) doc.line(vx(d), firstMid, vx(d), bottom); // continue down
    doc.line(vx(d), firstMid, contentX - 1.5, firstMid); // arm to content
  } else {
    // root: short arm linking the spine top to the kit label
    doc.line(vx(0), firstMid, contentX - 1.5, firstMid);
  }
  if (node.hasChildren) {
    // drop into the children's column; the first child's up-stub meets it
    doc.line(vx(D), firstMid, vx(D), bottom);
  }

  // quantity - accent blue, small x
  if (qtyStr) {
    doc.setTextColor(...TREE);
    doc.setFont(MONO, 'bold');
    doc.setFontSize(8.5);
    doc.text(qtyStr, contentX, firstMid, { baseline: 'middle' });
    const numW = doc.getTextWidth(qtyStr);
    doc.setFontSize(6.2);
    doc.text('\u00d7', contentX + numW + 0.4, firstMid, { baseline: 'middle' });
  }
  // part number - mono, bold for the root
  doc.setTextColor(...INK);
  doc.setFont(MONO, node.isRoot ? 'bold' : 'normal');
  doc.setFontSize(8.5);
  doc.text(node.pn || '', pnX, firstMid, { baseline: 'middle' });
  // type pill
  drawTypePill(doc, pillX, firstMid, node.isKit);
  // alternates chip
  if (node.altCount) drawAltChip(doc, chipX, firstMid, node.altCount);
  // description - slightly pale dark, wrapped
  if (descLines.length) {
    doc.setFont('Inter', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    let dy = firstMid;
    for (const ln of descLines) {
      doc.text(ln, descX, dy, { baseline: 'middle' });
      dy += lineH;
    }
    doc.setTextColor(...INK);
  }
  return bottom;
}

// Draw every kit as a fully-expanded rich tree. Returns the final y.
function drawKitTreeSection(doc, kits, materialById, alternatesMap, startY) {
  const cfg = {
    left: PAGE.margin,
    right: PAGE.width - PAGE.margin,
    step: 5,
    lineH: 4.2,
    rowPadV: 1.6,
    pageBottom: PAGE.height - 12,
  };
  let y = startY;
  kits.forEach((kit, idx) => {
    if (idx > 0) y += 3;
    // keep a kit's root with a couple of rows together on the same page
    if (y + 18 > cfg.pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    const nodes = [];
    flattenKit(kit, materialById, alternatesMap, nodes);
    for (const node of nodes) {
      y = drawKitNode(doc, node, cfg, y);
    }
  });
  return y;
}

// A small light-grey chip showing the interchange-alternates count, drawn
// after a part number. The swap symbol (⇄) isn't in the embedded font
// subsets, so it's drawn as two short vector arrows — black-ink-friendly
// and font-independent. Mirrors the web AlternatesChip.
const ALT_CHIP = { h: 3.3, padX: 1.0, arrowW: 2.2, gap: 0.8, fontSize: 6 };

function altChipWidth(doc, count) {
  doc.setFont('Inter', 'normal');
  doc.setFontSize(ALT_CHIP.fontSize);
  const txtW = doc.getTextWidth(String(count));
  return ALT_CHIP.padX * 2 + ALT_CHIP.arrowW + ALT_CHIP.gap + txtW;
}

function drawAltChip(doc, x, centerY, count) {
  const { h, padX, arrowW, gap, fontSize } = ALT_CHIP;
  doc.setFont('Inter', 'normal');
  doc.setFontSize(fontSize);
  const txt = String(count);
  const txtW = doc.getTextWidth(txt);
  const w = padX * 2 + arrowW + gap + txtW;
  const y = centerY - h / 2;

  // chip background
  doc.setFillColor(228, 228, 228);
  doc.roundedRect(x, y, w, h, 0.7, 0.7, 'F');

  // two stacked arrows: top points right, bottom points left
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.2);
  const ax = x + padX;
  const upY = centerY - 0.7;
  const loY = centerY + 0.7;
  // upper → right
  doc.line(ax, upY, ax + arrowW, upY);
  doc.line(ax + arrowW, upY, ax + arrowW - 0.55, upY - 0.45);
  doc.line(ax + arrowW, upY, ax + arrowW - 0.55, upY + 0.45);
  // lower ← left
  doc.line(ax, loY, ax + arrowW, loY);
  doc.line(ax, loY, ax + 0.55, loY - 0.45);
  doc.line(ax, loY, ax + 0.55, loY + 0.45);

  // count
  doc.setTextColor(60, 60, 60);
  doc.text(txt, ax + arrowW + gap, centerY, { baseline: 'middle' });

  // restore default text colour for subsequent cells
  doc.setTextColor(...INK);
}

function pdfName(projectName, kind) {
  const safe = (projectName || 'project')
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}-${kind}-${date}.pdf`;
}
