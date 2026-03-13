import {
  Component,
  ViewChild,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';

import { Book } from '../../models/book.model';
import { RecommendationRequest, ApiError } from '../../models/recommendation.model';
import { RecommendationService } from '../../services/recommendation.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { UserDataService } from '../../services/user-data.service';
import { AuthService } from '../../services/auth.service';
import { ApiKeyService } from '../../services/api-key.service';
import { DiscoveryFormComponent, FormMode } from '../discovery-form/discovery-form.component';
import { LoadingStateComponent } from '../loading-state/loading-state.component';
import { BookCardComponent, BookRating } from '../book-card/book-card.component';
import { BookDetailComponent } from '../book-detail/book-detail.component';
import { RelatedBooksComponent } from '../related-books/related-books.component';
import { ProfileQualityComponent } from '../profile-quality/profile-quality.component';

type AppState = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'timeout';

interface RelatedBooksState {
  book: Book;
  books: Book[];
  isLoading: boolean;
}

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    DiscoveryFormComponent,
    LoadingStateComponent,
    BookCardComponent,
    BookDetailComponent,
    RelatedBooksComponent,
    ProfileQualityComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  @ViewChild(DiscoveryFormComponent) discoveryForm?: DiscoveryFormComponent;

  appState: AppState = 'idle';
  books: Book[] = [];
  apiError: ApiError | null = null;
  currentRequest: RecommendationRequest | null = null;
  currentPurpose = '';
  resetOptionalTrigger = 0;

  // Form mode
  formMode: FormMode = 'quick';

  // Book detail panel
  selectedBook: Book | null = null;

  // Related books per book title
  relatedBooksMap = new Map<string, RelatedBooksState>();

  // Profile quality
  ratingCount = 0;

  // Card interaction state (persisted to localStorage)
  savedTitles = new Set<string>();
  discardedTitles = new Set<string>();
  readTitles = new Set<string>();
  ratings = new Map<string, BookRating>();

  private sub?: Subscription;
  private relatedSubs = new Map<string, Subscription>();

  constructor(
    private recommendationService: RecommendationService,
    private localStorageService: LocalStorageService,
    private userDataService: UserDataService,
    private authService: AuthService,
    private apiKeyService: ApiKeyService,
    private cdr: ChangeDetectorRef,
  ) {
    this.localStorageService.profileCleared$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.savedTitles = new Set();
      this.discardedTitles = new Set();
      this.readTitles = new Set();
      this.ratings = new Map();
      this.ratingCount = 0;
      this.appState = 'idle';
      this.books = [];
      this.cdr.markForCheck();
    });
    this._hydrateStateFromStorage();
  }

  ngOnInit(): void {
    // Load form mode from session storage
    const savedMode = sessionStorage.getItem('bookwise_form_mode') as FormMode;
    if (savedMode) {
      this.formMode = savedMode;
    }

    // Check for pending similar book search from biblioteca
    const pendingSimilar = sessionStorage.getItem('pending_similar_book');
    if (pendingSimilar) {
      try {
        const book = JSON.parse(pendingSimilar) as { title: string; author: string };
        sessionStorage.removeItem('pending_similar_book');
        // Trigger similar books search as main results
        setTimeout(() => {
          this.searchSimilarBooks(book.title, book.author);
        }, 0);
      } catch {
        // ignore parsing errors
      }
    }
  }

  // ── Form submission ───────────────────────────────────
  onFormSubmit(req: RecommendationRequest): void {
    this.sub?.unsubscribe();

    const builtProfile = this.userDataService.buildUserProfile();
    const hasProfile =
      builtProfile.liked.length > 0 ||
      builtProfile.disliked.length > 0 ||
      builtProfile.read.length > 0 ||
      (builtProfile.rejected?.length ?? 0) > 0;

    const enrichedReq: RecommendationRequest = {
      ...req,
      profile: hasProfile ? builtProfile : null,
    };

    this.currentRequest = enrichedReq;
    this.currentPurpose = req.purpose || 'enjoy';
    this.appState = 'loading';
    this.books = [];
    this.relatedBooksMap.clear();
    this.apiError = null;

    this.sub = this.recommendationService.recommend(enrichedReq).subscribe({
      next: resp => {
        this.books = resp.books;
        this.appState = resp.books.length > 0 ? 'results' : 'empty';
        this.userDataService.addToHistory(enrichedReq, resp.books.length);
        this.cdr.markForCheck();
      },
      error: (err: { error: ApiError }) => {
        this.apiError = err.error ?? {
          code: 'UNKNOWN',
          message: 'Ha ocurrido un error inesperado.',
          retryable: true,
        };
        this.appState = 'error';
        this.cdr.markForCheck();
      },
    });
  }

  onTimeout(): void {
    this.sub?.unsubscribe();
    this.appState = 'timeout';
    this.apiError = {
      code: 'TIMEOUT',
      message: 'Está tardando más de lo habitual. Los libros buenos se hacen esperar...',
      retryable: true,
    };
    this.cdr.markForCheck();
  }

  onRetry(): void {
    if (this.currentRequest) {
      this.onFormSubmit(this.currentRequest);
    }
  }

  onOpenApiKeySettings(): void {
    this.apiKeyService.requestOpenSettings();
  }

  onSimplifySearch(): void {
    if (!this.currentRequest) return;
    const simplified: RecommendationRequest = {
      ...this.currentRequest,
      mood: null,
      genres: [],
      length: null,
      language: null,
    };
    this.resetOptionalTrigger++;
    this.onFormSubmit(simplified);
    this.cdr.markForCheck();
  }

  onModifySearch(): void {
    this.sub?.unsubscribe();
    this.appState = 'idle';
    this.cdr.markForCheck();
  }

  // ── Form Mode ─────────────────────────────────────────
  onModeChange(mode: FormMode): void {
    this.formMode = mode;
    sessionStorage.setItem('bookwise_form_mode', mode);
  }

  // ── Book Detail ───────────────────────────────────────
  onBookClick(book: Book): void {
    this.selectedBook = book;
    this.cdr.markForCheck();
  }

  onBookDetailClose(): void {
    this.selectedBook = null;
    this.cdr.markForCheck();
  }

  // ── Similar Books ─────────────────────────────────────
  searchSimilarBooks(title: string, author: string): void {
    this.sub?.unsubscribe();

    const builtProfile = this.userDataService.buildUserProfile();
    const hasProfile =
      builtProfile.liked.length > 0 ||
      builtProfile.disliked.length > 0 ||
      builtProfile.read.length > 0;

    this.appState = 'loading';
    this.books = [];
    this.relatedBooksMap.clear();
    this.apiError = null;
    this.currentPurpose = 'enjoy';

    this.sub = this.recommendationService
      .getSimilarRecommendations({
        seed_book: { title, author },
        profile: hasProfile ? builtProfile : null,
        count: 6,
      })
      .subscribe({
        next: resp => {
          this.books = resp.books;
          this.appState = resp.books.length > 0 ? 'results' : 'empty';
          this.cdr.markForCheck();
        },
        error: (err: { error: ApiError }) => {
          this.apiError = err.error ?? {
            code: 'UNKNOWN',
            message: 'Ha ocurrido un error inesperado.',
            retryable: true,
          };
          this.appState = 'error';
          this.cdr.markForCheck();
        },
      });
  }

  onSimilarRequested(book: Book): void {
    const existing = this.relatedBooksMap.get(book.title);
    if (existing) {
      // Toggle if already exists
      this.relatedBooksMap.delete(book.title);
      this.relatedSubs.get(book.title)?.unsubscribe();
      this.relatedSubs.delete(book.title);
      this.cdr.markForCheck();
      return;
    }

    // Set loading state
    this.relatedBooksMap.set(book.title, {
      book,
      books: [],
      isLoading: true,
    });
    this.cdr.markForCheck();

    const builtProfile = this.userDataService.buildUserProfile();
    const hasProfile =
      builtProfile.liked.length > 0 ||
      builtProfile.disliked.length > 0 ||
      builtProfile.read.length > 0;

    const sub = this.recommendationService
      .getSimilarRecommendations({
        seed_book: { title: book.title, author: book.author },
        profile: hasProfile ? builtProfile : null,
        count: 6,
      })
      .subscribe({
        next: resp => {
          this.relatedBooksMap.set(book.title, {
            book,
            books: resp.books,
            isLoading: false,
          });
          this.cdr.markForCheck();
        },
        error: () => {
          this.relatedBooksMap.delete(book.title);
          this.cdr.markForCheck();
        },
      });

    this.relatedSubs.set(book.title, sub);
  }

  onRelatedBooksClosed(book: Book): void {
    this.relatedBooksMap.delete(book.title);
    this.relatedSubs.get(book.title)?.unsubscribe();
    this.relatedSubs.delete(book.title);
    this.cdr.markForCheck();
  }

  // ── Card actions ─────────────────────────────────────
  async onSave(book: Book): Promise<void> {
    await this.userDataService.saveBook(book);
    this.savedTitles = new Set([...this.savedTitles, book.title]);
    this.cdr.markForCheck();
  }

  async onUnsave(book: Book): Promise<void> {
    await this.userDataService.unsaveBook(book);
    this.savedTitles = new Set([...this.savedTitles].filter(t => t !== book.title));
    this.cdr.markForCheck();
  }

  async onDiscard(book: Book): Promise<void> {
    await this.userDataService.rejectBook(book);
    this.discardedTitles = new Set([...this.discardedTitles, book.title]);
    this.cdr.markForCheck();
  }

  async onRate(event: { book: Book; rating: BookRating }): Promise<void> {
    await this.userDataService.markAsRead(event.book, event.rating);
    this.readTitles = new Set([...this.readTitles, event.book.title]);
    this.ratings = new Map([...this.ratings, [event.book.title, event.rating]]);
    this.savedTitles = new Set([...this.savedTitles, event.book.title]);
    this.updateRatingCount();
    this.cdr.markForCheck();
  }

  // ── Helpers ───────────────────────────────────────────
  get isFormVisible(): boolean {
    return ['idle', 'results', 'empty', 'error', 'timeout'].includes(this.appState);
  }

  get isLoadingVisible(): boolean {
    return this.appState === 'loading';
  }

  get hasRelatedBooks(): boolean {
    return this.relatedBooksMap.size > 0;
  }

  getRelatedBooksState(book: Book): RelatedBooksState | undefined {
    return this.relatedBooksMap.get(book.title);
  }

  isBookSaved(book: Book): boolean {
    return this.savedTitles.has(book.title);
  }

  isBookDiscarded(book: Book): boolean {
    return this.discardedTitles.has(book.title);
  }

  isBookRead(book: Book): boolean {
    return this.readTitles.has(book.title);
  }

  getBookRating(book: Book): BookRating | null {
    return this.ratings.get(book.title) ?? null;
  }

  private updateRatingCount(): void {
    this.ratingCount = this.ratings.size;
  }

  private _hydrateStateFromStorage(): void {
    const profile = this.localStorageService.getProfile();
    // Also subscribe to userDataService updates when authenticated
    this.userDataService.savedBooks$.subscribe(books => {
      for (const b of books) {
        if (b.status === 'want_to_read') {
          this.savedTitles.add(b.title);
        } else {
          this.readTitles.add(b.title);
          if (b.rating) {
            this.ratings.set(b.title, b.rating);
          }
        }
      }
      this.updateRatingCount();
      this.cdr.markForCheck();
    });
    for (const b of profile.saved_books) {
      if (b.status === 'want_to_read') {
        this.savedTitles.add(b.title);
      } else {
        this.readTitles.add(b.title);
        if (b.rating) {
          this.ratings.set(b.title, b.rating);
        }
      }
    }
    for (const r of profile.rejected_books) {
      this.discardedTitles.add(r.title);
    }
    this.ratingCount = this.ratings.size;
  }
}
