export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** 兩點的大圓距離（公尺）。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** TWD97 TM2（中央經線 121°）轉 WGS84；停車場資料多數只有這組座標。 */
export function twd97ToWgs84(x: number, y: number): LatLng {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9999;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const C = ep2 * cos ** 2;
  const T = Math.tan(phi) ** 2;
  const N = a / Math.sqrt(1 - e2 * sin ** 2);
  const R = (a * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5;
  const D = (x - 250000) / (N * k0);
  const lat =
    phi -
    ((N * Math.tan(phi)) / R) *
      (D ** 2 / 2 -
        ((5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * ep2 - 3 * C ** 2) * D ** 6) / 720);
  const lng =
    toRad(121) +
    (D - ((1 + 2 * T + C) * D ** 3) / 6 + ((5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * ep2 + 24 * T ** 2) * D ** 5) / 120) / cos;
  return { lat: toDeg(lat), lng: toDeg(lng) };
}
