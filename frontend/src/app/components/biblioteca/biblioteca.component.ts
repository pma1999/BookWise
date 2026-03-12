import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
} from '@angular/core';
import { RouterLink, Router } from '@angular/router';

import { Book } from '../../models/book.model';
import { SavedBook } from '../../models/recommendation.model';
import { LocalStorageService } from '../../services/local-storage.service';
import { UserDataService } from '../../services/user-data.service';
import { BookCardComponent, BookRating } from '../book-card/book-card.component';

@Component({
  selector: 'app-biblioteca',
  standalone: true,
  imports: [RouterLink, BookCardComponent],
  templateUrl: './biblioteca.component.html',
  styleUrl: './biblioteca.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BibliotecaComponent implements OnInit {
  wantToRead: SavedBook[] = [];
  read: SavedBook[] = [];
  ratingFilter: 'all' | 'loved' | 'ok' | 'disliked' = 'all';

  readonly ratingFilterOptions = [
    { value: 'all' as const,      label: 'Todos' },
    { value: 'loved' as const,    label: '😍 Me encantó' },
    { value: 'ok' as const,       label: '🙂 Estuvo bien' },
    { value: 'disliked' as const, label: '😕 No me gustó' },
  ];

  private hasLoadedFromSupabase = false;

  constructor(
    private ls: LocalStorageService,
    private userData: UserDataService,
    private cdr: ChangeDetectorRef,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    // First try to load from Supabase if authenticated
    await this.userData.loadSavedBooks();
    this.hasLoadedFromSupabase = true;
    this._reload();

    // Subscribe to userData updates for real-time changes
    this.userData.savedBooks$.subscribe(() => {
      this._reload();
    });
  }

  get isEmpty(): boolean { return this.wantToRead.length === 0 && this.read.length === 0; }

  get filteredRead(): SavedBook[] {
    return this.ratingFilter === 'all'
      ? this.read
      : this.read.filter(b => b.rating === this.ratingFilter);
  }

  setFilter(f: typeof this.ratingFilter): void {
    this.ratingFilter = f;
    this.cdr.markForCheck();
  }

  toBook(saved: SavedBook): Book {
    return {
      id: saved.id,
      title: saved.title,
      author: saved.author,
      year: null,
      cover_url: saved.cover_url,
      cover_url_large: null,
      description: null,
      reason: saved.reason,
      subjects: [],
      edition_count: null,
      rating: null,
      openlibrary_url: null,
      isbn: null,
    };
  }

  async onMarkRead(book: Book, rating: BookRating): Promise<void> {
    await this.userData.markAsRead(book, rating);
    this._reload();
  }

  async onUnsave(book: Book): Promise<void> {
    await this.userData.unsaveBook(book);
    this._reload();
  }

  async onChangeRating(event: { book: Book; rating: BookRating }): Promise<void> {
    await this.userData.markAsRead(event.book, event.rating);
    this._reload();
  }

  onSimilarRequested(book: Book): void {
    // Navigate to home and trigger a similar books search
    sessionStorage.setItem('pending_similar_book', JSON.stringify({ title: book.title, author: book.author }));
    this.router.navigate(['/']);
  }

  private _reload(): void {
    const savedBooks = this.userData.getSavedBooks();

    // If we have data from Supabase (authenticated user), use it
    if (this.hasLoadedFromSupabase && savedBooks.length >= 0) {
      this.wantToRead = [...savedBooks.filter(b => b.status === 'want_to_read')].reverse();
      this.read = [...savedBooks.filter(b => b.status === 'read')].reverse();
    } else {
      // Fall back to localStorage for unauthenticated users
      const p = this.ls.getProfile();
      this.wantToRead = [...p.saved_books.filter(b => b.status === 'want_to_read')].reverse();
      this.read = [...p.saved_books.filter(b => b.status === 'read')].reverse();
    }
    this.cdr.markForCheck();
  }
}
