// Shared building blocks for the project PDF exports.
//
// Everything here is black-ink-only: white page, black text, thin grey
// rules for structure, no fills, no colour. Body text is Inter (embedded);
// part numbers and drawing numbers use the built-in Courier so they line
// up monospaced without a second embedded font.
//
// This whole module (and the Inter base64) is loaded via dynamic import
// from ProjectViewPage, so none of it ships in the main bundle.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { INTER_REGULAR, INTER_BOLD } from './interFont';

// --- palette (greyscale only) ---
export const INK = [17, 17, 17]; //   near-black body text
export const RULE = [120, 120, 120]; // thin structural rules
export const SOFT = [90, 90, 90]; //   muted secondary text
export const SECTION_BG = [238, 238, 238]; // very light grey section band

// A4 portrait geometry, in mm.
export const PAGE = {
  width: 210,
  height: 297,
  margin: 14,
};
export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

// Register Inter with a jsPDF instance. The VFS entries are per-document,
// so we register on each fresh doc we create.
function registerFonts(doc) {
  doc.addFileToVFS('Inter-Regular.ttf', INTER_REGULAR);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', INTER_BOLD);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
}

export function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  registerFonts(doc);
  doc.setFont('Inter', 'normal');
  doc.setTextColor(...INK);
  return doc;
}

// Draw the document header. Returns the y position to continue drawing from.
export function drawHeader(doc, { projectName, subtitle, description }) {
  const x = PAGE.margin;
  let y = PAGE.margin;

  doc.setFont('Inter', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(projectName || 'Project', x, y + 4);

  // Generated date, right-aligned on the same baseline.
  doc.setFont('Inter', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SOFT);
  const stamp = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(`Generated ${stamp}`, PAGE.width - PAGE.margin, y + 4, {
    align: 'right',
  });

  y += 9;
  doc.setFont('Inter', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(subtitle || '', x, y);

  if (description) {
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(...SOFT);
    const lines = doc.splitTextToSize(description, CONTENT_WIDTH);
    doc.text(lines, x, y);
    y += lines.length * 4;
  }

  y += 2;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(x, y, PAGE.width - PAGE.margin, y);

  return y + 4;
}

// Draw the group legend as a compact table. `groups` is the merged-group
// array from buildProjectMatrix; `sbsById` resolves SB titles. Returns the
// y position after the table.
export function drawGroupLegend(doc, { groups, sbsById, startY }) {
  doc.setFont('Inter', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Groups · merged by shared aircraft set', PAGE.margin, startY);

  const body = groups.map((g, idx) => {
    // A merged group may contain several TO Parts. Stack them in the cell.
    const members = g.members
      .map((m) => {
        const sb = m.config ? sbsById.get(m.config.sbId) : null;
        const sbBit = sb
          ? ` — ${sb.sbRef}${sb.rev ? ` rev ${sb.rev}` : ''}`
          : '';
        const cfgBit = m.config ? ` · ${m.config.name}` : '';
        const title = sb?.title ? `\n    ${sb.title}` : '';
        return `${m.to?.toNumber || '?'} / ${m.partLabel || '(no part)'}${sbBit}${cfgBit}${title}`;
      })
      .join('\n');
    const tails =
      g.aircraft.length === 0
        ? '—'
        : g.aircraft.map((a) => a.registration).join(', ');
    return [`G${idx + 1}`, members, tails];
  });

  autoTable(doc, {
    startY: startY + 2,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head: [['#', 'TO Part(s) · SB · config', 'Aircraft']],
    body,
    theme: 'grid',
    styles: {
      font: 'Inter',
      fontSize: 8,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0.1,
      cellPadding: 1.5,
      valign: 'top',
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
      0: { cellWidth: 10, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: 116 },
      2: { cellWidth: CONTENT_WIDTH - 10 - 116 },
    },
  });

  return doc.lastAutoTable.finalY + 5;
}

// Footer page numbers on every page. Call once after all content is drawn.
export function drawFooter(doc) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('Inter', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SOFT);
    doc.text(
      `Page ${i} of ${total}`,
      PAGE.width - PAGE.margin,
      PAGE.height - 6,
      { align: 'right' }
    );
  }
}
