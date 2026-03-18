import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";
import xlsx from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const ONS_TABLE2_2025_PROVISIONAL_ZIP =
  "https://www.ons.gov.uk/file?uri=/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/occupation2digitsocashetable2/2025provisional/ashetable22025provisional.zip";

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === ":" || s === "..") return null;
  const cleaned = s.replaceAll(",", "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function fetchToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

function pickLikelySheet(workbook) {
  const names = workbook.SheetNames || [];
  // These ONS workbooks consistently have an "All" tab for all employees.
  const all = names.find((n) => normKey(n) === "all");
  return all || names[0];
}

function findHeaderRow(rows) {
  // ONS Table 2 workbooks typically have:
  // Row with "Description" and "Code" as the main header.
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i].map((c) => normKey(c));
    if (r[0] === "description" && r[1] === "code") return i;
  }
  return -1;
}

function headerIndexMap(headerRow) {
  const map = new Map();
  headerRow.forEach((cell, idx) => {
    const k = normKey(cell);
    if (!k) return;
    if (!map.has(k)) map.set(k, idx);
  });
  return map;
}

function getIdx(map, predicates) {
  for (const pred of predicates) {
    for (const [k, idx] of map.entries()) {
      if (pred(k)) return idx;
    }
  }
  return -1;
}

function parsePayTable(rows) {
  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) {
    throw new Error(
      "Could not locate a header row in the spreadsheet (format may have changed)."
    );
  }

  const header = rows[headerRowIdx];
  const map = headerIndexMap(header);

  const idxDesc = 0;
  const idxCode = 1;
  const idxMedian = getIdx(map, [(k) => k === "median"]);
  const idxMean = getIdx(map, [(k) => k === "mean"]);

  if (idxMedian === -1 || idxMean === -1) {
    throw new Error(
      "Could not locate Median/Mean columns (format may have changed)."
    );
  }

  const roles = [];
  const valuesBySoc = {};

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[idxCode] ?? "").trim();
    const desc = String(row[idxDesc] ?? "").trim();
    if (!code || !desc) continue;

    // Use 2-digit SOC groups (e.g. 21, 22, 23, 31...)
    if (!/^\d{2}$/.test(code)) continue;

    roles.push({ soc2: code, title: desc });
    valuesBySoc[code] = {
      median: toNumber(row[idxMedian]),
      mean: toNumber(row[idxMean])
    };
  }

  const uniqueRoles = [];
  const seen = new Set();
  for (const r of roles) {
    if (seen.has(r.soc2)) continue;
    seen.add(r.soc2);
    uniqueRoles.push(r);
  }

  return { roles: uniqueRoles, valuesBySoc };
}

function readWorkbookFromZipEntry(entry) {
  const data = entry.getData();
  return xlsx.read(data, { type: "buffer" });
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: ""
  });
}

async function main() {
  const cacheDir = path.join(rootDir, ".cache");
  const publicDataDir = path.join(rootDir, "public", "data");
  await ensureDir(cacheDir);
  await ensureDir(publicDataDir);

  const zipPath = path.join(cacheDir, "ashe-table2.zip");
  await fetchToFile(ONS_TABLE2_2025_PROVISIONAL_ZIP, zipPath);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const weeklyEntry = entries.find((e) => {
    const n = e.entryName.toLowerCase();
    return (
      n.endsWith(".xlsx") &&
      n.includes("weekly pay - gross") &&
      !n.includes("cv")
    );
  });
  const annualEntry = entries.find((e) => {
    const n = e.entryName.toLowerCase();
    return (
      n.endsWith(".xlsx") &&
      n.includes("annual pay - gross") &&
      !n.includes("cv")
    );
  });

  if (!weeklyEntry || !annualEntry) {
    throw new Error(
      "Could not find the weekly/annual gross pay workbooks in the zip."
    );
  }

  const weeklyWb = readWorkbookFromZipEntry(weeklyEntry);
  const annualWb = readWorkbookFromZipEntry(annualEntry);

  const weeklySheet = pickLikelySheet(weeklyWb);
  const annualSheet = pickLikelySheet(annualWb);
  if (!weeklySheet || !annualSheet) throw new Error("No sheets found.");

  const weeklyRows = sheetRows(weeklyWb, weeklySheet);
  const annualRows = sheetRows(annualWb, annualSheet);

  const weekly = parsePayTable(weeklyRows);
  const annual = parsePayTable(annualRows);

  // Merge into a single lookup keyed by 2-digit SOC.
  const roles = weekly.roles;
  const earnings = {};
  for (const r of roles) {
    const soc = r.soc2;
    const w = weekly.valuesBySoc[soc];
    const a = annual.valuesBySoc[soc];
    earnings[soc] = {
      year: 2025,
      median_weekly_all: w?.median ?? null,
      mean_weekly_all: w?.mean ?? null,
      median_annual_all: a?.median ?? null,
      mean_annual_all: a?.mean ?? null
    };
  }

  // Best-effort: infer year from workbook props or file path.
  const meta = {
    source: "ONS ASHE Table 2 (occupation by 2-digit SOC)",
    dataset_page:
      "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/occupation2digitsocashetable2",
    edition: "2025 provisional",
    year: 2025,
    note:
      "Figures are official ASHE estimates. Some values may be suppressed (shown as “:” in ONS tables)."
  };

  await fs.writeFile(
    path.join(publicDataDir, "roles.json"),
    JSON.stringify(roles, null, 2) + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(publicDataDir, "earnings.json"),
    JSON.stringify(earnings, null, 2) + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(publicDataDir, "meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8"
  );

  const sampleCount = roles.length;
  console.log(`Wrote ${sampleCount} roles to public/data/*.json`);
  console.log(`Weekly workbook: ${weeklyEntry.entryName} (${weeklySheet})`);
  console.log(`Annual workbook: ${annualEntry.entryName} (${annualSheet})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

