import type { TownPassClient } from "../adapters/client.js";
import { BOOKS, LIBRARIES, NOTICES, type Book } from "../adapters/datasets.js";
import { DEMO, listResult } from "../shared/result.js";

export class LibraryService {
  constructor(private readonly client: TownPassClient) {}

  private page(path: string): string {
    return `${this.client.baseUrl}/library-service${path}`;
  }

  private summary(book: Book) {
    return {
      id: book.id,
      book_name: book.book_name,
      author: book.author,
      publisher: book.publisher,
      subject: book.subject,
      page_url: this.page(`/book-detail/${encodeURIComponent(book.id)}`),
    };
  }

  /** 比對規則與網頁的「全部」搜尋相同：五個欄位的區分大小寫部分比對。 */
  async search(keyword: string, limit: number) {
    const books = await this.client.load(BOOKS);
    const hits = books.filter((b) =>
      [b.book_name, b.author, b.publisher, b.subject, b.isbn].some((field) => field.includes(keyword)),
    );
    const sourceUrl = this.page(`/keyword-search?search=${encodeURIComponent(keyword)}&type=all`);
    return listResult(hits.map((b) => this.summary(b)), limit, DEMO, sourceUrl);
  }

  async getBook(bookId: string) {
    const books = await this.client.load(BOOKS);
    const book = books.find((b) => b.id === bookId);
    if (!book) return { status: "not_found" as const, data_source: DEMO, book: null };
    return {
      status: "found" as const,
      data_source: DEMO,
      book: {
        ...this.summary(book),
        publish_date: book.publish_date,
        subject: book.subject,
        isbn: book.isbn,
        call_number: book.call_number,
        click_count: book.click_count,
        volumes: book.series.map((s) => ({
          name: s["series＿name"],
          waiting_people: s.waiting_people,
          reservable: s.is_reservation,
          is_hot: s.is_hot,
        })),
        pickup_libraries: book.libraries.map((l) => ({ id: l.id, name: l.name, area: l.area, address: l.address.text })),
      },
    };
  }

  async ranking(limit: number) {
    const books = await this.client.load(BOOKS);
    const ranked = books
      .filter((b) => b.click_count >= 0)
      .sort((a, b) => b.click_count - a.click_count)
      .map((b, index) => ({ rank: index + 1, click_count: b.click_count, ...this.summary(b) }));
    return listResult(ranked, limit, DEMO, this.page("/ranking-list"));
  }

  async branches(area: string | undefined, limit: number) {
    const libraries = await this.client.load(LIBRARIES);
    const results = libraries
      .filter((l) => !area || l.area.includes(area))
      .map((l) => ({ id: l.id, name: l.name, area: l.area, address: l.address.text, phone: l.phone }));
    return listResult(results, limit, DEMO, this.page("/"));
  }

  async notices(limit: number) {
    const notices = await this.client.load(NOTICES);
    const results = notices.map((n) => ({
      id: n.id,
      date: n.date,
      title: n.title,
      description: n.description,
      link: n.is_open_outer_link && n.outer_link ? n.outer_link : this.page(`/notice-detail/${encodeURIComponent(n.id)}`),
    }));
    return listResult(results, limit, DEMO, this.page("/notice-list"));
  }
}
