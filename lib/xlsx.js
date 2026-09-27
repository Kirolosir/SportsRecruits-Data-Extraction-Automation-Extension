// Writes .xlsx files without any library.
// An xlsx is really just a zip full of XML. I'm storing the files uncompressed
// (STORE) so I didn't have to implement deflate - Excel, Numbers and Sheets all
// open it fine. Wrote this instead of using SheetJS because Manifest V3 won't
// let extensions load scripts from a CDN.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** Zips up a list of {name, data} into one archive. */
function zip(files) {
  const { time, date } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = utf8(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);   // version needed
    lv.setUint16(6, 0, true);    // flags
    lv.setUint16(8, 0, true);    // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);   // version made by
    cv.setUint16(6, 20, true);   // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, f.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

const XML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
// Excel refuses to open the file if these are in there, so drop them
const escapeXml = (s) =>
  String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/[&<>"']/g, (c) => XML_ESC[c]);

function colName(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const isNumeric = (v) =>
  typeof v === "number" ? Number.isFinite(v)
  : typeof v === "string" ? /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim().length < 15
  : false;

function sheetXml({ rows, columns = [], filter = false }) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    columns.length ? "<cols>" + columns.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${Number(c.width) || 24}" customWidth="1"/>`).join("") + "</cols>" : "",
    "<sheetData>",
  ];
  const headerHeight = Math.max(30, ...rows[0]?.map((cell, i) =>
    Math.min(120, Math.ceil(String(cell ?? "").length / (columns[i]?.width || 24)) * 15 + 6)) || []);
  rows.forEach((row, ri) => {
    parts.push(`<row r="${ri + 1}" ht="${ri === 0 ? headerHeight : 24}" customHeight="1">`);
    row.forEach((cell, ci) => {
      if (cell === null || cell === undefined || cell === "") return;
      const ref = `${colName(ci + 1)}${ri + 1}`;
      const column = columns[ci] || {};
      const numeric = ri > 0 && column.type !== "text" && isNumeric(cell);
      const style = ` s="${ri === 0 ? 1 : numeric && column.format === "decimal" ? 3 : column.type === "text" ? 2 : 0}"`;
      if (numeric) {
        parts.push(`<c r="${ref}"${style}><v>${Number(cell)}</v></c>`);
      } else {
        parts.push(`<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`);
      }
    });
    parts.push("</row>");
  });
  parts.push("</sheetData>");
  if (filter && rows.length && rows[0].length) parts.push(`<autoFilter ref="A1:${colName(rows[0].length)}${rows.length}"/>`);
  parts.push("</worksheet>");
  return parts.join("");
}

/**
 * Builds the whole workbook.
 * @param {Array<{name:string, rows:Array<Array>}>} sheets
 */
function buildXlsx(sheets) {
  const safe = sheets.map((s, i) => ({
    // Excel won't allow these characters in a tab name, and caps it at 31
    name: (s.name || `Sheet${i + 1}`).replace(/[:\\\/?*\[\]]/g, "-").slice(0, 31),
    rows: s.rows, columns: s.columns, filter: s.filter,
  }));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    safe.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  // Explicit text cells protect phone prefixes and leading zeros. Decimal GPA
  // formatting and wide columns keep contacts readable without manual resizing.
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF4B286D"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border/><border><right style="thin"><color rgb="FFE3E0E8"/></right><bottom style="hair"><color rgb="FFE3E0E8"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="left" indent="1"/></xf>' +
    '<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const files = [
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { name: "xl/styles.xml", data: utf8(styles) },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(sheetXml(s)) })),
  ];

  return zip(files);
}

globalThis.SRXlsx = { buildXlsx };
