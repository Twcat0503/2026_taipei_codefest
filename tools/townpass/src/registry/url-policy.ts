import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** 服務網址不允許：協定不是 http 或 https，或主機指向本機、內網與連結本地位址。 */
export class UrlNotAllowedError extends Error {}

export type UrlPolicy = {
  /** 只給本機開發與測試使用；預設關閉，服務網址不得指向本機或內網。 */
  allowPrivateHosts?: boolean;
  /** 解析網域名稱；預設使用系統 DNS，測試可替換。 */
  resolveHost?: (hostname: string) => Promise<string[]>;
};

// IPv4 與 IPv6 分開存放：BlockList 內部把 IPv4 表示為 IPv4 對映的 IPv6，
// 若把 ::ffff:0:0/96 放進同一份清單，會連公開的 IPv4 位址也被判為內網。
const nonPublicIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) nonPublicIpv4.addSubnet(address, prefix, "ipv4");
const nonPublicIpv6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["::ffff:0:0", 96],
] as const) nonPublicIpv6.addSubnet(address, prefix, "ipv6");

const isNonPublic = (address: string) =>
  isIP(address) === 6 ? nonPublicIpv6.check(address, "ipv6") : nonPublicIpv4.check(address, "ipv4");

const resolveWithDns = async (hostname: string) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

/**
 * 伺服器會替使用者連線到服務網址，所以只允許公開的 http／https 目標。
 * 網域名稱會先解析，解析結果中只要有一個本機或內網位址就拒絕。
 */
export async function assertPublicHttpUrl(input: string, policy: UrlPolicy = {}): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlNotAllowedError("只接受 http 與 https");
  if (policy.allowPrivateHosts) return url;
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new UrlNotAllowedError("不允許本機位址");
  const addresses = isIP(hostname) ? [hostname] : await (policy.resolveHost ?? resolveWithDns)(hostname);
  if (addresses.some(isNonPublic)) throw new UrlNotAllowedError("不允許內網或本機位址");
  return url;
}
