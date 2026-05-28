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
        content: sectionLabel(section.part, sbsById),
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
        content: sectionLabel(section.part, sbsById),
        colSpan: totalCols,
        _section: true,
      },
    ]);
    for (const row of section.rows) {
      const m = row.material;
      const desc = [m.description || '', m.isKit ? '[kit]' : '']
        .filter(Boolean)
        .join('  ');
      const arr = [m.partNumber || '', desc];
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
      }
      if (data.section === 'head' && data.column.index <= 1) {
        data.cell.styles.halign = 'left';
      }
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
    for (const kit of kits) {
      kitBody.push([
        {
          content: `${kit.partNumber || ''}${kit.description ? '  —  ' + kit.description : ''}`,
          colSpan: 3,
          _kit: true,
        },
      ]);
      appendKitRows(kitBody, kit.components, materialById, 1, new Set([kit.id]));
    }

    autoTable(doc, {
      startY: ky + 2,
      margin: { left: PAGE.margin, right: PAGE.margin },
      head: [['Qty', 'Part', 'Description']],
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
        0: { cellWidth: 16, halign: 'right', font: MONO },
        1: { cellWidth: 44, font: MONO },
        2: { cellWidth: CONTENT_WIDTH - 16 - 44 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.cell.colSpan === 3) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.font = 'Inter';
          data.cell.styles.textColor = INK;
        }
        if (data.section === 'head' && data.column.index === 2) {
          data.cell.styles.halign = 'left';
        }
      },
    });
  }

  drawFooter(doc);
  doc.save(pdfName(project.name, 'materials'));
}

// Recursively append a kit's contents as indented rows. Cycle-guarded.
function appendKitRows(body, components, materialById, depth, seen) {
  for (const comp of components) {
    const child = materialById.get(comp.materialId);
    const indent = '   '.repeat(depth - 1) + (depth > 1 ? '- ' : '');
    if (!child) {
      body.push([String(comp.qty ?? ''), indent + '(missing)', '']);
      continue;
    }
    const isCycle = seen.has(comp.materialId);
    const desc = [child.description || '', child.isKit ? '[kit]' : '', isCycle ? '— circular' : '']
      .filter(Boolean)
      .join('  ');
    body.push([
      String(comp.qty ?? ''),
      indent + (child.partNumber || ''),
      desc,
    ]);
    if (child.isKit && !isCycle && Array.isArray(child.components)) {
      const nextSeen = new Set(seen);
      nextSeen.add(comp.materialId);
      appendKitRows(body, child.components, materialById, depth + 1, nextSeen);
    }
  }
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
