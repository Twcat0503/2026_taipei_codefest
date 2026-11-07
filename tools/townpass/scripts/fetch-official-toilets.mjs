#!/usr/bin/env node
/**
 * 從臺北市資料大平臺下載「臺北市公廁點位資訊」，產生 src/data/toilets.generated.ts。
 *
 * 為什麼要快照：data.taipei 的 API 與 CSV 都沒有開放跨網域（CORS），App 內的 WebView 無法直接讀取。
 * 這份資料是官方不定期更新的真實資料，快照會保留官方匯入時間，畫面上照實標示資料日期。
 *
 * 用法：node scripts/fetch-official-toilets.mjs
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATASET_ID = "ca205b54-a06f-4d84-894c-d6ab5079ce79";
const RESOURCE_ID = "9e0e6ad4-b9f9-4810-8551-0cffd1b915b3";
const PAGE = 1000;
const OUT = fileURLToPath(new URL("../src/data/toilets.generated.ts", import.meta.url));

const int = (value) => {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (value) => String(value ?? "").trim();

const rows = [];
let importedAt = "";
for (let offset = 0; ; offset += PAGE) {
  const url = `https://data.taipei/api/v1/dataset/${RESOURCE_ID}?scope=resourceAquire&limit=${PAGE}&offset=${offset}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  const { result } = await response.json();
  for (const r of result.results) {
    const date = r._importdate?.date?.slice(0, 10) ?? "";
    if (date > importedAt) importedAt = date;
    rows.push([
      str(r["行政區"]),
      str(r["公廁類別"]),
      str(r["公廁名稱"]),
      str(r["公廁地址"]),
      Number.parseFloat(r["緯度"]),
      Number.parseFloat(r["經度"]),
      int(r["座數"]),
      int(r["無障礙廁座數"]),
      int(r["親子廁座數"]),
      str(r["照護床位置"]),
    ]);
  }
  if (result.results.length < PAGE || rows.length >= result.count) break;
}
if (rows.length < 100) throw new Error(`資料筆數異常：${rows.length}`);

const body = `// 由 scripts/fetch-official-toilets.mjs 產生，請勿手動編輯；更新請重跑腳本。
// 來源：臺北市資料大平臺「臺北市公廁點位資訊」，提供機關：臺北市政府環境保護局。
// 依《政府資料開放授權條款－第1版》公眾釋出：https://data.gov.tw/license

/** [行政區, 公廁類別, 公廁名稱, 地址, 緯度, 經度, 座數, 無障礙廁座數, 親子廁座數, 照護床位置] */
export type ToiletRow = readonly [string, string, string, string, number, number, number, number, number, string];

export const TOILET_SNAPSHOT = {
  dataset: "臺北市公廁點位資訊",
  publisher: "臺北市政府環境保護局",
  url: "https://data.taipei/dataset/detail?id=${DATASET_ID}",
  /** 官方匯入資料的日期（data.taipei _importdate）。 */
  importedAt: "${importedAt}",
  rows: ${JSON.stringify(rows)} as readonly ToiletRow[],
};
`;
await writeFile(OUT, body);
console.log(`wrote ${rows.length} toilets (imported ${importedAt}) -> ${OUT}`);
