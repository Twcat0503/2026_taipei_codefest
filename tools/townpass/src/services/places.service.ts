import type { TownPassClient } from "../adapters/client.js";
import { PARKING, PARKING_DATASET_URL, YOUBIKE } from "../adapters/datasets.js";
import { TOILET_SNAPSHOT } from "../data/toilets.generated.js";
import { InputError } from "../shared/errors.js";
import { distanceMeters, twd97ToWgs84, type LatLng } from "../shared/geo.js";
import { LIVE, listResult, matches, officialSnapshot, type DataSource } from "../shared/result.js";

export interface PlaceQuery {
  lat?: number | undefined;
  lng?: number | undefined;
  radius_m: number;
  area?: string | undefined;
  keyword?: string | undefined;
  /** 只要有無障礙設施的地點：公廁有無障礙廁座、停車場有身障或孕婦車位。 */
  accessible?: boolean | undefined;
  limit: number;
}

interface Spot<T> {
  coord: LatLng | null;
  area: string;
  searchText: string[];
  accessible: boolean;
  output: T;
}

function parseCoord(lat: string | undefined, lng: string | undefined): LatLng | null {
  const parsed = { lat: Number.parseFloat(lat ?? ""), lng: Number.parseFloat(lng ?? "") };
  return Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) ? parsed : null;
}

/** 擋掉 (0, 0) 這類明顯無效的座標；範圍涵蓋雙北，不是精確的行政區界。 */
function isInTaipeiRegion({ lat, lng }: LatLng): boolean {
  return lat > 24.6 && lat < 25.4 && lng > 121.2 && lng < 122.1;
}

const count = (value: string | undefined) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 官方時間格式如 "Mon Oct 19 10:26:00 CST 2026"，轉成 2026-10-19 10:26；無法解析時照原文顯示。 */
function officialTime(raw: string): string {
  const m = raw.match(/^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}):\d{2} \w+ (\d{4})$/);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = m ? months.indexOf(m[1]!) + 1 : 0;
  return m && month ? `${m[4]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")} ${m[3]}` : raw;
}

export class PlacesService {
  constructor(private readonly client: TownPassClient) {}

  private respond<T>(spots: Spot<T>[], query: PlaceQuery, dataSource: DataSource, sourceUrl: string) {
    const origin = this.origin(query);
    const inArea = spots.filter(
      (s) =>
        (!query.area || s.area.includes(query.area)) &&
        (!query.accessible || s.accessible) &&
        matches(query.keyword, ...s.searchText),
    );
    const rows = inArea.flatMap((s) => {
      if (!origin) return [{ distance_m: null as number | null, ...s.output, coord: s.coord }];
      if (!s.coord) return [];
      const distance = Math.round(distanceMeters(origin, s.coord));
      return distance <= query.radius_m ? [{ distance_m: distance as number | null, ...s.output, coord: s.coord }] : [];
    });
    rows.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    return listResult(rows, query.limit, dataSource, sourceUrl);
  }

  /** 至少要有一個條件，否則會把上千筆資料當結果回傳。 */
  private origin(query: PlaceQuery): LatLng | null {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) throw new InputError("lat 與 lng 必須同時提供");
    if (!hasLat && !query.area && !query.keyword) {
      throw new InputError("請至少提供 lat 與 lng、area 或 keyword 其中一項");
    }
    return hasLat ? { lat: query.lat as number, lng: query.lng as number } : null;
  }

  async youbike(query: PlaceQuery) {
    const stations = await this.client.load(YOUBIKE);
    const spots = stations
      .filter((s) => s.act === "1")
      .map((s) => ({
        coord: { lat: s.latitude, lng: s.longitude },
        area: s.sarea,
        searchText: [s.sna, s.ar, s.sarea],
        accessible: true,
        output: {
          id: s.sno,
          name: s.sna,
          area: s.sarea,
          address: s.ar,
          available_rent_bikes: s.available_rent_bikes,
          available_return_bikes: s.available_return_bikes,
          total_docks: s.Quantity,
          updated_at: s.updateTime,
        },
      }));
    return this.respond(spots, { ...query, accessible: false }, LIVE, "https://data.taipei/dataset/detail?id=c6bc8aed-557d-41d5-bfb1-8da24f78f2fb");
  }

  async parking(query: PlaceQuery) {
    const { data } = await this.client.load(PARKING);
    const spots = data.park.map((p) => {
      const entrance = p.EntranceCoord?.EntrancecoordInfo?.[0];
      const projected = parseCoord(p.tw97x, p.tw97y);
      // 上游的入口座標有 (0, 0) 和整筆錯位的資料，所以優先用 TWD97，缺少時才退回入口座標。
      const coord = projected ? twd97ToWgs84(projected.lat, projected.lng) : parseCoord(entrance?.Xcod, entrance?.Ycod);
      const handicap = count(p.Handicap_First);
      const pregnancy = count(p.Pregnancy_First);
      return {
        coord: coord && isInTaipeiRegion(coord) ? coord : null,
        area: p.area,
        searchText: [p.name, p.address, p.area],
        accessible: handicap > 0 || pregnancy > 0,
        output: {
          id: p.id,
          name: p.name,
          area: p.area,
          address: p.address,
          tel: p.tel,
          service_time: p.serviceTime,
          total_car_spaces: p.totalcar,
          total_motorcycle_spaces: p.totalmotor,
          handicap_spaces: handicap,
          pregnancy_spaces: pregnancy,
          handicap_discount: p.Handicap_Discount?.trim() || undefined,
          summary: p.summary,
          fee: p.payex,
        },
      };
    });
    const source = officialSnapshot(
      "臺北市政府交通局停車管理工程處",
      "臺北市停車場資訊",
      officialTime(data.UPDATETIME),
      "車位數是格位總數，不是即時空位；身障、孕婦車位請以現場為準。",
    );
    return this.respond(spots, query, source, PARKING_DATASET_URL);
  }

  async toilets(query: PlaceQuery) {
    const spots = TOILET_SNAPSHOT.rows.map(([area, type, name, address, lat, lng, seats, accessible, family, careBed], i) => ({
      coord: Number.isFinite(lat) && Number.isFinite(lng) && isInTaipeiRegion({ lat, lng }) ? { lat, lng } : null,
      area,
      searchText: [name, address, area, type, accessible > 0 ? "無障礙" : "", family > 0 ? "親子" : "", careBed ? "照護床" : ""],
      accessible: accessible > 0,
      output: {
        id: `toilet-${i}`,
        name,
        area,
        address,
        type,
        seats,
        accessible_seats: accessible,
        family_seats: family,
        care_bed: careBed || undefined,
      },
    }));
    const source = officialSnapshot(
      TOILET_SNAPSHOT.publisher,
      TOILET_SNAPSHOT.dataset,
      TOILET_SNAPSHOT.importedAt,
      "官方不定期更新，實際開放情形請以現場為準。",
    );
    return this.respond(spots, query, source, TOILET_SNAPSHOT.url);
  }
}
