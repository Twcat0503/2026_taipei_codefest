/** Paths the tools hand out must resolve to a page: the Vue router renders a blank page, not an error, for a route it lacks. */

import { existsSync, readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DESTINATIONS } from "../src/destinations.js";
import { CATALOG } from "../src/services/catalog.js";

// This file lives in tools/townpass/tests; the router belongs to the Vue app in frontend/.
const ROUTER = new URL("../../../frontend/src/router/index.ts", import.meta.url);

/** Routes that only hold child routes and render nothing themselves, so they are not a valid jump target. */
const CONTAINER_ONLY = ["/fee-payment"];

interface Page {
  label: string;
  path: string;
}

/** Every in-app page path the tools can hand to a user: the service catalog plus the in-app destinations. */
const PAGES: Page[] = [
  ...CATALOG.map((entry) => ({ label: `catalog ${entry.id}`, path: entry.path })),
  ...DESTINATIONS.flatMap((destination) => {
    if (destination.path === undefined) return [];
    const pages = [{ label: `destination ${destination.id}`, path: destination.path }];
    if (destination.search) {
      pages.push({ label: `destination ${destination.id} search`, path: destination.search("keyword") });
    }
    return pages;
  }),
];

/** Drops the query string, hash and trailing slash; the root stays "/". */
const normalize = (path: string) => path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
const segments = (path: string) => path.split("/").filter(Boolean);

/**
 * Full path pattern of every route object in the router source. A child route's path is relative to its
 * parent unless it starts with "/", and an empty child path is the parent's own page. The source is parsed
 * with the TypeScript compiler (already a devDependency for typecheck) rather than matched with a regex, so
 * a child such as detail/:id only counts under its own parent, whatever the formatting.
 */
function routePatterns(source: string): string[] {
  const patterns: string[] = [];
  const visit = (node: ts.Node, parent: string) => {
    let current = parent;
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "path" &&
          ts.isStringLiteralLike(property.initializer)
        ) {
          const path = property.initializer.text;
          current = path.startsWith("/") ? path : `${parent}/${path}`;
          patterns.push(current);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, current));
  };
  visit(ts.createSourceFile("router.ts", source, ts.ScriptTarget.Latest), "");
  return patterns;
}

/** A pattern such as /fee-payment/detail/:id matches a path with the same segments; a :param stands for any one segment. */
function matchesRoute(pattern: string, path: string): boolean {
  const want = segments(pattern);
  const got = segments(path);
  return want.length === got.length && want.every((segment, index) => segment.startsWith(":") || segment === got[index]);
}

const routeExists = (routes: string[], path: string) => routes.some((route) => matchesRoute(route, normalize(path)));

describe("catalog routes", () => {
  it("清單與入口不指向只有子路由的容器路由", () => {
    const hits = PAGES.filter(({ path }) => CONTAINER_ONLY.includes(normalize(path)));
    expect(hits).toEqual([]);
  });

  it.runIf(existsSync(ROUTER))("清單與入口的路徑都對得上 Vue router 定義的路由", () => {
    const routes = routePatterns(readFileSync(ROUTER, "utf8"));
    const missing = PAGES.filter(({ path }) => !routeExists(routes, path));
    expect(missing).toEqual([]);
  });

  it.runIf(existsSync(ROUTER))("路由比對認得巢狀子路由，不會放過錯的父路由、缺參數或不存在的路徑", () => {
    const routes = routePatterns(readFileSync(ROUTER, "utf8"));
    const found = ["/", "/coupon/", "/fee-payment/detail/fee-6/", "/fee-payment/history/", "/library-service/keyword-search?search=a&type=all"];
    const absent = ["/fee-payment/nope/", "/coupon/detail/fee-6/", "/fee-payment/detail/", "/nope"];
    expect(found.filter((path) => !routeExists(routes, path))).toEqual([]);
    expect(absent.filter((path) => routeExists(routes, path))).toEqual([]);
  });
});
