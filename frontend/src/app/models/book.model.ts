export interface Book {
  id: string | null;
  work_id?: string | null;
  edition_id?: string | null;
  title: string;
  author: string;
  year: number | null;
  cover_url: string | null;
  cover_url_large: string | null;
  description: string | null;
  reason: string;
  subjects: string[];
  edition_count: number | null;
  rating: number | null;
  openlibrary_url: string | null;
  isbn: string | null;
  languages?: string[];
}
