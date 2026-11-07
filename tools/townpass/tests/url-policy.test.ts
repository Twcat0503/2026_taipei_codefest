import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, UrlNotAllowedError } from "../src/registry/url-policy.js";

const publicHost = async () => ["93.184.216.34"];
const internalHost = async () => ["10.0.0.5"];

describe("服務網址政策", () => {
  it.each(["ftp://service.example/", "file:///etc/passwd", "javascript:alert(1)", "data:text/plain,hi"])(
    "只接受 http 與 https：%s",
    async (url) => {
      await expect(assertPublicHttpUrl(url, { resolveHost: publicHost })).rejects.toThrow(UrlNotAllowedError);
    },
  );

  it.each([
    "http://localhost:7331/",
    "http://api.localhost/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.16.5.4/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("拒絕本機、內網與連結本地位址：%s", async (url) => {
    await expect(assertPublicHttpUrl(url, { resolveHost: publicHost })).rejects.toThrow(UrlNotAllowedError);
  });

  it("網域名稱解析到內網位址時拒絕", async () => {
    await expect(assertPublicHttpUrl("https://intranet.example/", { resolveHost: internalHost })).rejects.toThrow(UrlNotAllowedError);
  });

  it("網域名稱解析到公開位址，或直接給公開 IP 時允許", async () => {
    await expect(assertPublicHttpUrl("https://service.example/search", { resolveHost: publicHost })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl("http://93.184.216.34/", { resolveHost: internalHost })).resolves.toBeInstanceOf(URL);
  });

  it("只有明確允許時才可連到本機（開發與測試用）", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:5173/", { allowPrivateHosts: true })).resolves.toBeInstanceOf(URL);
  });
});
