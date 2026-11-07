/** 上游資料集與其 schema。欄位對應 TownPass-Services 的 public/mock。 */

import { z } from "zod";

import type { Dataset } from "./client.js";

const STATIC_TTL = 10 * 60_000;
const LIVE_TTL = 30_000;

const wrapped = <T>(data: z.ZodType<T>): z.ZodType<T> => z.object({ data }).transform((v) => v.data as T);
const address = z.object({ text: z.string(), map: z.string().optional() });

const library = z.object({ id: z.string(), name: z.string(), area: z.string(), address, phone: z.string() });

const book = z.object({
  id: z.string(),
  book_name: z.string(),
  author: z.string(),
  publisher: z.string(),
  publish_date: z.string(),
  subject: z.string(),
  isbn: z.string(),
  click_count: z.number(),
  call_number: z.string().optional(),
  // 上游欄位名稱確實是全形底線。
  series: z.array(
    z.object({ "series＿name": z.string(), waiting_people: z.number(), is_reservation: z.boolean(), is_hot: z.boolean() }),
  ),
  libraries: z.array(library),
});
export type Book = z.output<typeof book>;

function dataset<T>(url: string, label: string, schema: z.ZodType<T>, ttlMs = STATIC_TTL): Dataset<T> {
  return { url, label, schema, ttlMs };
}

export const BOOKS = dataset("/mock/library/library_book_list.json", "館藏資料", wrapped(z.array(book)));
export const LIBRARIES = dataset("/mock/library/library_list.json", "分館資料", wrapped(z.array(library)));
export const NOTICES = dataset(
  "/mock/library/library_notice_list.json",
  "圖書館公告",
  wrapped(
    z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        title: z.string(),
        description: z.string(),
        is_open_outer_link: z.boolean(),
        outer_link: z.string().optional(),
      }),
    ),
  ),
);

export const COUNTERS = dataset(
  "/mock/counter_list.json",
  "臨櫃叫號資料",
  wrapped(
    z.array(
      z.object({
        name: z.string(),
        list: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            info: z.object({ address, tel: z.string() }),
            counters: z.array(
              z.object({ name: z.string(), current_number: z.string(), waiting_people: z.number() }),
            ),
          }),
        ),
      }),
    ),
  ),
);

export const FAQ = dataset(
  "/mock/qna_list.json",
  "常見問題",
  wrapped(
    z.array(
      z.object({
        name: z.string(),
        list: z.array(z.object({ id: z.string(), category: z.string(), name: z.string(), content: z.string() })),
      }),
    ),
  ),
);

export const APPLICATIONS = dataset(
  "/mock/service_list.json",
  "申辦項目",
  wrapped(
    z.array(
      z.object({
        name: z.string(),
        agency: z.array(
          z.object({
            name: z.string(),
            options: z.array(z.object({ id: z.string(), title: z.string(), subtitle: z.string() })),
          }),
        ),
      }),
    ),
  ),
);

export const FEES = dataset(
  "/mock/fee-payment/fee_payment_list.json",
  "繳費項目",
  wrapped(
    z.array(
      z.object({
        name: z.string(),
        data: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            is_hot: z.boolean(),
            search_type_list: z.array(
              z.object({
                name: z.string(),
                type: z.string(),
                form_format: z
                  .array(
                    z.object({
                      label: z.string().optional(),
                      required: z.boolean().optional(),
                      description: z.string().optional(),
                    }),
                  )
                  .optional(),
                notice: z.array(z.string()).optional(),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
);

const named = z.object({ id: z.string(), name: z.string() });

export const SUBSCRIPTIONS = dataset(
  "/mock/subscription_list.json",
  "市政訊息訂閱主題",
  wrapped(z.object({ data: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })) })),
);

export const CITIZEN_REPORTS = dataset(
  "/mock/citizen_report.json",
  "陳情分類",
  wrapped(
    z.object({
      hot_report: z.array(named),
      all_report: z.array(
        named.extend({ service_requesting: z.array(named), problem_reporting: z.array(named) }),
      ),
    }),
  ),
);

export const DISASTER_REPORTS = dataset(
  "/mock/disaster_reporting.json",
  "災情分類",
  wrapped(z.array(named.extend({ options: z.array(named) }))),
);

export const PERKS = dataset(
  "/mock/coupon_data.json",
  "優惠與票券",
  wrapped(
    z.object({
      hot_spot_list: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          introduce: z.string(),
          business_hours: z.array(z.string()),
          address,
        }),
      ),
      ticket_list: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          text: z.string(),
          price: z.number(),
          discount_text: z.string(),
        }),
      ),
      coupon_list: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          text: z.string(),
          discount_text: z.string(),
          deadline: z.string(),
          activity_date: z.string(),
          rule: z.string(),
        }),
      ),
    }),
  ),
);

export const YOUBIKE = dataset(
  "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json",
  "YouBike 即時資料",
  z.array(
    z.object({
      sno: z.string(),
      sna: z.string(),
      sarea: z.string(),
      ar: z.string(),
      act: z.string(),
      updateTime: z.string(),
      Quantity: z.number(),
      available_rent_bikes: z.number(),
      available_return_bikes: z.number(),
      latitude: z.number(),
      longitude: z.number(),
    }),
  ),
  LIVE_TTL,
);

export const PARKING = dataset(
  "/mock/find-place/TCMSV_alldesc.json",
  "停車場資料",
  z.array(
    z.object({
      id: z.string(),
      area: z.string(),
      name: z.string(),
      summary: z.string(),
      address: z.string(),
      tel: z.string(),
      payex: z.string(),
      serviceTime: z.string(),
      tw97x: z.string(),
      tw97y: z.string(),
      totalcar: z.number(),
      totalmotor: z.number(),
      EntranceCoord: z
        .object({ EntrancecoordInfo: z.array(z.object({ Xcod: z.string(), Ycod: z.string() })).optional() })
        .optional(),
    }),
  ),
);

export const TOILETS = dataset(
  "/mock/find-place/public_toilet_taipei.json",
  "公廁資料",
  z.array(
    z.object({
      number: z.string(),
      city: z.string(),
      name: z.string(),
      address: z.string(),
      latitude: z.string(),
      longitude: z.string(),
      grade: z.string(),
      type: z.string(),
    }),
  ),
);
