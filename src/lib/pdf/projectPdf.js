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
  const gW = groupColWidth(groups.length, 8, 13, 34 + 60);
  const noW = 34;
  const titleW = CONTENT_WIDTH - noW - gW * groups.length;

  // Build body + a per-row map of which group columns get a tick.
  const body = [];
  const tickMap = {}; // bodyRowIndex -> Set<groupIndex>

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
      const titleBits = [];
      if (d.rev) titleBits.push(`rev ${d.rev}`);
      if (d.sapDir) titleBits.push(`(${d.sapDir})`);
      if (d.title) titleBits.push(d.title);
      const arr = [d.docNumber || '', titleBits.join('  ·  ')];
      for (let i = 0; i < groups.length; i++) arr.push('');
      tickMap[body.length] = row.appliesTo;
      body.push(arr);

      // Ref tree, indented, no ticks (refs inherit their parent's columns).
      const refIds = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
      appendDrawingRefRows(body, refIds, drawingById, 1, new Set([d.id]), groups.length);
    }
  }

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
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
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

// Append indented ref-tree rows for a drawing's refDrawingIds. Cycle-guarded.
function appendDrawingRefRows(body, refIds, drawingById, depth, seen, groupCount) {
  for (const id of refIds) {
    const d = drawingById.get(id);
    const indent = '   '.repeat(depth) + '- ';
    if (!d) {
      const arr = [indent + '(missing)', ''];
      for (let i = 0; i < groupCount; i++) arr.push('');
      body.push(arr);
      continue;
    }
    const isCycle = seen.has(id);
    const titleBits = [];
    if (d.rev) titleBits.push(`rev ${d.rev}`);
    if (d.sapDir) titleBits.push(`(${d.sapDir})`);
    if (d.title) titleBits.push(d.title);
    if (isCycle) titleBits.push('— circular');
    const arr = [indent + (d.docNumber || ''), titleBits.join('  ·  ')];
    for (let i = 0; i < groupCount; i++) arr.push('');
    body.push(arr);
    if (!isCycle) {
      const childRefs = Array.isArray(d.refDrawingIds) ? d.refDrawingIds : [];
      if (childRefs.length) {
        const nextSeen = new Set(seen);
        nextSeen.add(id);
        appendDrawingRefRows(body, childRefs, drawingById, depth + 1, nextSeen, groupCount);
      }
    }
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

    const kitBody = [];
    let maxDepth = 1;
    for (const kit of kits) {
      kitBody.push([
        {
          content: bannerText(
            `KIT · ${kit.partNumber || ''}${kit.description ? '  ·  ' + kit.description : ''}`
          ),
          colSpan: 4,
          _kit: true,
        },
      ]);
      const d = appendKitRows(
        kitBody,
        kit.components,
        materialById,
        new Set([kit.id]),
        alternatesMap,
        []
      );
      maxDepth = Math.max(maxDepth, d);
    }

    // Tree column auto-sizes to the deepest nesting (one "step" per level),
    // clamped so it never starves the description column.
    const treeStep = 3.4;
    const qtyW = 12;
    const treeW = Math.min(Math.max(maxDepth * treeStep + 2, 6), 30);
    const partW = 40;
    const kitDescW = CONTENT_WIDTH - qtyW - treeW - partW;

    autoTable(doc, {
      startY: ky + 2,
      margin: { left: PAGE.margin, right: PAGE.margin },
      head: [['Qty', '', 'Part', 'Description']],
      body: kitBody,
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
      },
      columnStyles: {
        0: { cellWidth: qtyW, halign: 'right', font: MONO },
        1: { cellWidth: treeW },
        2: { cellWidth: partW, font: MONO },
        3: { cellWidth: kitDescW },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.cell.colSpan === 4) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.font = 'Inter';
          data.cell.styles.textColor = INK;
          data.cell.styles.halign = 'center';
        }
        if (data.section === 'head' && data.column.index === 3) {
          data.cell.styles.halign = 'left';
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        if (data.cell.colSpan && data.cell.colSpan > 1) return; // kit header
        // Tree connectors in the dedicated tree column.
        if (data.column.index === 1) {
          drawTreeCell(doc, data, treeStep);
          return;
        }
        // Alternates chip in the part-number column.
        if (data.column.index === 2) {
          const raw = data.cell.raw;
          const altCount = raw && typeof raw === 'object' ? raw._alt : 0;
          if (!altCount) return;
          doc.setFont(MONO, 'normal');
          doc.setFontSize(8);
          const txt = (raw && raw.content) || '';
          const txtW = doc.getTextWidth(String(txt));
          const chipW = altChipWidth(doc, altCount);
          const padLeft = 1.4;
          const desiredX = data.cell.x + padLeft + txtW + 1.4;
          const maxX = data.cell.x + data.cell.width - chipW - 0.6;
          const chipX = Math.min(
            desiredX,
            Math.max(data.cell.x + padLeft, maxX)
          );
          drawAltChip(doc, chipX, data.cell.y + data.cell.height / 2, altCount);
        }
      },
    });
  }

  drawFooter(doc);
  doc.save(pdfName(project.name, 'materials'));
}

// Recursively append a kit's contents as table rows. Cycle-guarded.
//
// Each row is [Qty, TreeCell, PartCell, Description]:
//   - TreeCell carries `_tree = { ancestorsContinue, isLast }` so the tree
//     connectors can be drawn as vector lines in didDrawCell. `ancestorsContinue`
//     is one boolean per ancestor level: true where that ancestor has a later
//     sibling (so a vertical line continues down through this row).
//   - PartCell carries `_alt` (interchange alternates count) for the chip.
//
// `ancestorsContinue` passed in describes the levels above `components`.
// Returns the deepest level reached, so the caller can size the tree column.
function appendKitRows(
  body,
  components,
  materialById,
  seen,
  alternatesMap,
  ancestorsContinue
) {
  let maxDepth = ancestorsContinue.length + 1;
  components.forEach((comp, i) => {
    const isLast = i === components.length - 1;
    const child = materialById.get(comp.materialId);
    if (!child) {
      body.push([
        String(comp.qty ?? ''),
        { content: '', _tree: { ancestorsContinue: ancestorsContinue.slice(), isLast, hasChildren: false } },
        '(missing)',
        '',
      ]);
      return;
    }
    const isCycle = seen.has(comp.materialId);
    const hasChildren =
      !!child.isKit &&
      !isCycle &&
      Array.isArray(child.components) &&
      child.components.length > 0;
    const tree = {
      ancestorsContinue: ancestorsContinue.slice(),
      isLast,
      hasChildren,
    };
    const desc = [
      child.description || '',
      child.isKit ? '[kit]' : '',
      isCycle ? '— circular' : '',
    ]
      .filter(Boolean)
      .join('  ');
    const set = alternatesMap && alternatesMap.get(comp.materialId);
    const altCount = set ? set.size - 1 : 0;
    body.push([
      String(comp.qty ?? ''),
      { content: '', _tree: tree },
      { content: child.partNumber || '', _alt: altCount },
      desc,
    ]);
    if (hasChildren) {
      const nextSeen = new Set(seen);
      nextSeen.add(comp.materialId);
      const childMax = appendKitRows(
        body,
        child.components,
        materialById,
        nextSeen,
        alternatesMap,
        [...ancestorsContinue, !isLast]
      );
      maxDepth = Math.max(maxDepth, childMax);
    }
  });
  return maxDepth;
}

// Draw the tree connectors for one kit-list row into its tree-column cell.
//
// Because part numbers live in a separate column (not inline with the tree),
// a parent must explicitly link to its children: when a node has children it
// reaches one column to the right and drops a vertical line, which the first
// child's connect-up stub meets. Sibling spines are carried by the per-node
// down-continue plus the ancestor pass-through bars.
function drawTreeCell(doc, data, step) {
  const raw = data.cell.raw;
  const meta = raw && typeof raw === 'object' ? raw._tree : null;
  if (!meta) return;
  const x0 = data.cell.x;
  const top = data.cell.y;
  const bottom = data.cell.y + data.cell.height;
  const mid = data.cell.y + data.cell.height / 2;
  const lineX = (k) => x0 + k * step + 1.6;
  const d = meta.ancestorsContinue.length; // 0-based column of this node

  doc.setDrawColor(...TREE);
  doc.setLineWidth(0.35);

  // Pass-through vertical bars for ancestor levels with later siblings.
  meta.ancestorsContinue.forEach((cont, i) => {
    if (cont) doc.line(lineX(i), top, lineX(i), bottom);
  });

  // This node: connect up to the parent/sibling spine, continue down if it
  // isn't the last sibling.
  doc.line(lineX(d), top, lineX(d), mid);
  if (!meta.isLast) doc.line(lineX(d), mid, lineX(d), bottom);

  if (meta.hasChildren) {
    // Reach over to the children's column and drop, starting their spine —
    // the first child's connect-up stub meets this drop.
    doc.line(lineX(d), mid, lineX(d + 1), mid);
    doc.line(lineX(d + 1), mid, lineX(d + 1), bottom);
  } else {
    // Leaf: a short arm pointing toward the part number.
    doc.line(lineX(d), mid, lineX(d) + step * 0.6, mid);
  }
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
