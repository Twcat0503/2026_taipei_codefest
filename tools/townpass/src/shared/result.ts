/** 所有查詢工具共用的回傳格式：一定標示資料性質，並區分查到與查無資料。 */

export interface DataSource {
  kind: "demo" | "snapshot" | "live";
  label: string;
  note: string;
}

export const DEMO: DataSource = {
  kind: "demo",
  label: "示範資料",
  note: "來自台北通示範站的內建資料，不代表真實館藏、號碼、費用或優惠；回覆使用者時必須說明。",
};

export const SNAPSHOT: DataSource = {
  kind: "snapshot",
  label: "靜態資料快照",
  note: "來自示範站內建的資料檔，更新時間未知，可能與現況不同；回覆使用者時必須說明。",
};

export const LIVE: DataSource = {
  kind: "live",
  label: "即時資料",
  note: "來自台北市公開資料的 YouBike 即時資訊，實際車輛數仍可能變動。",
};

export interface ListResult<T> {
  status: "found" | "not_found";
  total: number;
  count: number;
  truncated: boolean;
  data_source: DataSource;
  source_url: string;
  results: T[];
}

export function listResult<T>(items: T[], limit: number, dataSource: DataSource, sourceUrl: string): ListResult<T> {
  const results = items.slice(0, limit);
  return {
    status: items.length > 0 ? "found" : "not_found",
    total: items.length,
    count: results.length,
    truncated: results.length < items.length,
    data_source: dataSource,
    source_url: sourceUrl,
    results,
  };
}

/** 不分大小寫的部分比對；keyword 省略時視為全部符合。 */
export function matches(keyword: string | undefined, ...fields: Array<string | undefined>): boolean {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
