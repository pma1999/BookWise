import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { Book } from '../../models/book.model';
import {
  ManualSearchResponse,
  RecommendationService,
} from '../../services/recommendation.service';
import { UserDataService } from '../../services/user-data.service';
import { BookCardComponent, BookRating } from '../book-card/book-card.component';

@Component({
  selector: 'app-manual-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BookCardComponent],
  templateUrl: './manual-search.component.html',
  styleUrl: './manual-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManualSearchComponent implements OnDestroy {
  query = '';
  language: '' | 'eng' | 'spa' = '';
  yearFrom: number | null = null;
  yearTo: number | null = null;
  subject = '';

  books: Book[] = [];
  isLoading = false;
  error: string | null = null;
  searched = false;

  page = 1;
  readonly limit = 12;
  hasNextPage = false;
  totalResults = 0;

  savedTitles = new Set<string>();
  readTitles = new Set<string>();
  ratings = new Map<string, BookRating>();

  private searchSub?: Subscription;
  private stateSub?: Subscription;

  constructor(
    private recommendationService: RecommendationService,
    private userDataService: UserDataService,
    private cdr: ChangeDetectorRef,
  ) {
    this.userDataService.loadSavedBooks();
    this.stateSub = this.userDataService.savedBooks$.subscribe((books) => {
      this.savedTitles.clear();
      this.readTitles.clear();
      this.ratings.clear();

      for (const b of books) {
        if (b.status === 'want_to_read') this.savedTitles.add(b.title);
        if (b.status === 'read') {
          this.readTitles.add(b.title);
          if (b.rating) this.ratings.set(b.title, b.rating);
        }
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    this.stateSub?.unsubscribe();
  }

  search(reset = true): void {
    const cleanQuery = this.query.trim();
    if (!cleanQuery) {
      this.error = 'Escribe un título, autor o ISBN para buscar en OpenLibrary.';
      this.cdr.markForCheck();
      return;
    }

    if (reset) {
      this.page = 1;
      this.books = [];
    }

    this.error = null;
    this.isLoading = true;
    this.searched = true;
    this.searchSub?.unsubscribe();

    this.searchSub = this.recommendationService.searchOpenLibrary({
      q: cleanQuery,
      page: this.page,
      limit: this.limit,
      language: this.language || null,
      subject: this.subject.trim() || null,
      year_from: this.yearFrom,
      year_to: this.yearTo,
    }).subscribe({
      next: (res: ManualSearchResponse) => {
        this.totalResults = res.meta.num_found;
        this.hasNextPage = res.meta.has_next_page;
        this.books = reset ? res.books : [...this.books, ...res.books];
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: ({ error }) => {
        this.error = error?.message || 'No se ha podido completar la búsqueda.';
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  loadMore(): void {
    if (this.isLoading || !this.hasNextPage) return;
    this.page += 1;
    this.search(false);
  }

  async onSave(book: Book): Promise<void> {
    await this.userDataService.saveBook(book);
  }

  async onUnsave(book: Book): Promise<void> {
    await this.userDataService.unsaveBook(book);
  }

  async onRate(event: { book: Book; rating: BookRating }): Promise<void> {
    await this.userDataService.markAsRead(event.book, event.rating);
  }

  isBookSaved(book: Book): boolean {
    return this.savedTitles.has(book.title);
  }

  isBookRead(book: Book): boolean {
    return this.readTitles.has(book.title);
  }

  getBookRating(book: Book): BookRating | null {
    return this.ratings.get(book.title) ?? null;
  }
}
