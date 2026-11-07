import type { TownPassClient } from "../adapters/client.js";
import {
  APPLICATIONS,
  CITIZEN_REPORTS,
  COUNTERS,
  DISASTER_REPORTS,
  FAQ,
  FEES,
  PERKS,
  SUBSCRIPTIONS,
} from "../adapters/datasets.js";
import { DEMO, listResult, matches } from "../shared/result.js";

export type PerkKind = "hot_spot" | "ticket" | "coupon";

export class CivicService {
  constructor(private readonly client: TownPassClient) {}

  private page(path: string): string {
    return `${this.client.baseUrl}${path}`;
  }

  async counters(keyword: string | undefined, limit: number) {
    const groups = await this.client.load(COUNTERS);
    const results = groups.flatMap((group) =>
      group.list
        .filter((office) => matches(keyword, group.name, office.name, office.info.address.text))
        .map((office) => ({
          id: office.id,
          category: group.name,
          name: office.name,
          address: office.info.address.text,
          tel: office.info.tel,
          counters: office.counters,
        })),
    );
    return listResult(results, limit, DEMO, this.page("/counter-calling/"));
  }

  async faq(keyword: string | undefined, limit: number) {
    const groups = await this.client.load(FAQ);
    const results = groups
      .flatMap((group) => group.list)
      .filter((q) => matches(keyword, q.category, q.name, q.content))
      .map((q) => ({ id: q.id, category: q.category, question: q.name, answer: q.content }));
    return listResult(results, limit, DEMO, this.page("/qna"));
  }

  /** 只列可訂閱的主題；是否已訂閱屬於個人狀態，不提供。 */
  async subscriptions(keyword: string | undefined, limit: number) {
    const { data } = await this.client.load(SUBSCRIPTIONS);
    const results = data
      .filter((s) => matches(keyword, s.name, s.description))
      .map((s) => ({ id: s.id, name: s.name, description: s.description }));
    return listResult(results, limit, DEMO, this.page("/subscription"));
  }

  async applications(keyword: string | undefined, limit: number) {
    const groups = await this.client.load(APPLICATIONS);
    const results = groups.flatMap((group) =>
      group.agency.flatMap((agency) =>
        agency.options
          .filter((o) => matches(keyword, group.name, agency.name, o.title, o.subtitle))
          .map((o) => ({ id: o.id, type: group.name, agency: agency.name, title: o.title, description: o.subtitle })),
      ),
    );
    return listResult(results, limit, DEMO, this.page("/"));
  }

  async fees(keyword: string | undefined, limit: number) {
    const groups = await this.client.load(FEES);
    const results = groups.flatMap((group) =>
      group.data
        .filter((fee) => matches(keyword, group.name, fee.name))
        .map((fee) => ({
          id: fee.id,
          category: group.name,
          name: fee.name,
          is_hot: fee.is_hot,
          page_url: this.page(`/fee-payment/detail/${encodeURIComponent(fee.id)}/`),
          lookup_methods: fee.search_type_list.map((method) => ({
            name: method.name,
            fields: (method.form_format ?? []).map((f) => ({
              label: f.label,
              required: f.required ?? false,
              description: f.description,
            })),
            notice: method.notice ?? [],
          })),
        })),
    );
    return listResult(results, limit, DEMO, this.page("/fee-payment/others/"));
  }

  async reportCategories(kind: "citizen" | "disaster", limit: number) {
    if (kind === "citizen") {
      const { all_report } = await this.client.load(CITIZEN_REPORTS);
      const results = all_report.map((c) => ({
        id: c.id,
        name: c.name,
        items: [...c.service_requesting, ...c.problem_reporting].map((i) => i.name),
      }));
      return listResult(results, limit, DEMO, this.page("/citizen-report/"));
    }
    const categories = await this.client.load(DISASTER_REPORTS);
    const results = categories.map((c) => ({ id: c.id, name: c.name, items: c.options.map((o) => o.name) }));
    return listResult(results, limit, DEMO, this.page("/disaster-report"));
  }

  async perks(keyword: string | undefined, kind: PerkKind | undefined, limit: number) {
    const data = await this.client.load(PERKS);
    const spots = data.hot_spot_list.map((s) => ({
      kind: "hot_spot" as const,
      id: s.id,
      name: s.name,
      description: s.introduce,
      business_hours: s.business_hours,
      address: s.address.text,
      page_url: this.page(`/coupon/hotspot/${encodeURIComponent(s.id)}`),
    }));
    const tickets = data.ticket_list.map((t) => ({
      kind: "ticket" as const,
      id: t.id,
      name: t.name,
      description: t.text,
      ticket_type: t.type,
      price: t.price,
      discount: t.discount_text,
      page_url: this.page(`/coupon/ticket-detail/${encodeURIComponent(t.id)}`),
    }));
    const coupons = data.coupon_list.map((c) => ({
      kind: "coupon" as const,
      id: c.id,
      name: c.name,
      description: c.text,
      discount: c.discount_text,
      deadline: c.deadline,
      activity_date: c.activity_date,
      rule: c.rule,
      page_url: this.page(`/coupon/coupon-detail/${encodeURIComponent(c.id)}`),
    }));
    const results = [...spots, ...tickets, ...coupons].filter(
      (p) => (!kind || p.kind === kind) && matches(keyword, p.name, p.description),
    );
    return listResult(results, limit, DEMO, this.page("/coupon/"));
  }
}
