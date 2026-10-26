/**
 * The first sheet of an Excel workbook (.xlsx), as rows of text — the same
 * shape `parseCsv` gives, so the import reads it the same way.
 *
 * Studios keep their bookings in Excel and Google Sheets as often as they
 * export CSV, and the import refused anything but CSV (review, 2026-10-26).
 * An .xlsx is a zip of XML; the browser's own DecompressionStream inflates it,
 * so this needs no library. Dates and times are stored as numbers formatted
 * as dates: they come back as "2027-06-12" and "15:00", which the spreadsheet
 * reader already understands. Browser-only (DOMParser, DecompressionStream).
 */

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function entries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("XLSX_NOT_A_WORKBOOK");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    found.push({ name, method, compressedSize, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

async function read(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("XLSX_UNSUPPORTED_COMPRESSION");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
const tagged = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));

/** "B12" → column 1 (zero-based). */
function columnOf(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

/** Excel's day count (1900 system) as "YYYY-MM-DD", or a fraction of a day as "HH:MM". */
function fromSerial(serial: number, timeOnly: boolean): string {
  if (timeOnly || (serial > 0 && serial < 1)) {
    const minutes = Math.round((serial % 1) * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

export async function readXlsx(file: Blob): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = entries(bytes);
  const get = async (name: string) => {
    const entry = zip.find((candidate) => candidate.name === name);
    return entry ? read(bytes, entry) : null;
  };

  // The first sheet, by the workbook's own order.
  const workbook = xml((await get("xl/workbook.xml")) ?? "");
  const relationships = xml((await get("xl/_rels/workbook.xml.rels")) ?? "");
  const firstSheet = tagged(workbook, "sheet")[0];
  const relationId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const target = tagged(relationships, "Relationship").find((relation) => relation.getAttribute("Id") === relationId)?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheetText = await get(sheetPath);
  if (!sheetText) throw new Error("XLSX_NO_SHEET");

  const shared = tagged(xml((await get("xl/sharedStrings.xml")) ?? "<sst/>"), "si").map((item) =>
    tagged(item, "t").map((text) => text.textContent ?? "").join(""),
  );

  // Which cell styles are dates or times.
  const styles = xml((await get("xl/styles.xml")) ?? "<styleSheet/>");
  const custom = new Map(tagged(styles, "numFmt").map((format) => [Number(format.getAttribute("numFmtId")), format.getAttribute("formatCode") ?? ""]));
  const cellXfs = tagged(styles, "cellXfs")[0];
  const formats = cellXfs ? tagged(cellXfs, "xf").map((xf) => Number(xf.getAttribute("numFmtId") ?? 0)) : [];
  const kindOf = (style: number): "date" | "time" | null => {
    const id = formats[style] ?? 0;
    if ((id >= 14 && id <= 17) || id === 22) return "date";
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return "time";
    const code = (custom.get(id) ?? "").toLowerCase().replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (/[dy]/.test(code)) return "date";
    if (/h/.test(code) && /m|s/.test(code)) return "time";
    return null;
  };

  const rows: string[][] = [];
  for (const row of tagged(xml(sheetText), "row")) {
    const cells: string[] = [];
    for (const cell of tagged(row, "c")) {
      const type = cell.getAttribute("t");
      const value = tagged(cell, "v")[0]?.textContent ?? "";
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = tagged(cell, "t").map((node) => node.textContent ?? "").join("");
      else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
      else if (type === "str" || type === "e") text = value;
      else if (value !== "") {
        const kind = kindOf(Number(cell.getAttribute("s") ?? 0));
        text = kind ? fromSerial(Number(value), kind === "time") : value;
      }
      cells[columnOf(cell.getAttribute("r") ?? "A1")] = text;
    }
    rows.push(Array.from(cells, (text) => text ?? ""));
  }
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows
    .map((row) => [...row, ...Array<string>(width - row.length).fill("")])
    .filter((cells) => cells.some((cell) => cell.trim() !== ""));
}
