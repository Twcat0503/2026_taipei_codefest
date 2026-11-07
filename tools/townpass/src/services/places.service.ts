import type { TownPassClient } from "../adapters/client.js";
import { PARKING, TOILETS, YOUBIKE } from "../adapters/datasets.js";
import { InputError } from "../shared/errors.js";
import { distanceMeters, twd97ToWgs84, type LatLng } from "../shared/geo.js";
import { LIVE, SNAPSHOT, listResult, matches, type DataSource } from "../shared/result.js";

export interface PlaceQuery {
  lat?: number | undefined;
  lng?: number | undefined;
  radius_m: number;
  area?: string | undefined;
  keyword?: string | undefined;
  limit: number;
}

interface Spot<T> {
  coord: LatLng | null;
  area: string;
  searchText: string[];
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

export class PlacesService {
  constructor(private readonly client: TownPassClient) {}

  private respond<T>(spots: Spot<T>[], query: PlaceQuery, dataSource: DataSource) {
    const origin = this.origin(query);
    const inArea = spots.filter(
      (s) => (!query.area || s.area.includes(query.area)) && matches(query.keyword, ...s.searchText),
    );
    const rows = inArea.flatMap((s) => {
      if (!origin) return [{ distance_m: null as number | null, ...s.output, coord: s.coord }];
      if (!s.coord) return [];
      const distance = Math.round(distanceMeters(origin, s.coord));
      return distance <= query.radius_m ? [{ distance_m: distance as number | null, ...s.output, coord: s.coord }] : [];
    });
    rows.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    return listResult(rows, query.limit, dataSource, `${this.client.baseUrl}/surrounding-service/`);
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
    return this.respond(spots, query, LIVE);
  }

  async parking(query: PlaceQuery) {
    const lots = await this.client.load(PARKING);
    const spots = lots.map((p) => {
      const entrance = p.EntranceCoord?.EntrancecoordInfo?.[0];
      const projected = parseCoord(p.tw97x, p.tw97y);
      // 上游的入口座標有 (0, 0) 和整筆錯位的資料，所以優先用 TWD97，缺少時才退回入口座標。
      const coord = projected ? twd97ToWgs84(projected.lat, projected.lng) : parseCoord(entrance?.Xcod, entrance?.Ycod);
      return {
        coord: coord && isInTaipeiRegion(coord) ? coord : null,
        area: p.area,
        searchText: [p.name, p.address, p.area],
        output: {
          id: p.id,
          name: p.name,
          area: p.area,
          address: p.address,
          tel: p.tel,
          service_time: p.serviceTime,
          total_car_spaces: p.totalcar,
          total_motorcycle_spaces: p.totalmotor,
          summary: p.summary,
          fee: p.payex,
        },
      };
    });
    return this.respond(spots, query, SNAPSHOT);
  }

  async toilets(query: PlaceQuery) {
    const toilets = await this.client.load(TOILETS);
    const spots = toilets.map((t) => ({
      coord: parseCoord(t.latitude, t.longitude),
      area: t.city,
      searchText: [t.name, t.address, t.city, t.type],
      output: { id: t.number, name: t.name, area: t.city, address: t.address, type: t.type, grade: t.grade },
    }));
    return this.respond(spots, query, SNAPSHOT);
  }
}
