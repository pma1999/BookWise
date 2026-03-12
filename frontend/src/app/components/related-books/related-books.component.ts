import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookCardComponent, BookRating } from '../book-card/book-card.component';
import { Book } from '../../models/book.model';

@Component({
  selector: 'app-related-books',
  standalone: true,
  imports: [CommonModule, BookCardComponent],
  templateUrl: './related-books.component.html',
  styleUrl: './related-books.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelatedBooksComponent {
  @Input({ required: true }) seedBook!: Book;
  @Input() books: Book[] = [];
  @Input() isLoading = false;
  @Input() expanded = true;
  @Input() savedTitles = new Set<string>();
  @Input() discardedTitles = new Set<string>();
  @Input() readTitles = new Set<string>();
  @Input() ratings = new Map<string, BookRating>();

  @Output() closed = new EventEmitter<void>();
  @Output() bookSaved = new EventEmitter<Book>();
  @Output() bookUnsaved = new EventEmitter<Book>();
  @Output() bookDiscarded = new EventEmitter<Book>();
  @Output() bookRated = new EventEmitter<{ book: Book; rating: BookRating }>();
  @Output() bookClicked = new EventEmitter<Book>();
  @Output() similarRequested = new EventEmitter<Book>();

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    if (!this.expanded) {
      this.closed.emit();
    }
  }

  close(): void {
    this.closed.emit();
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

  onSave(book: Book): void {
    this.bookSaved.emit(book);
  }

  onUnsave(book: Book): void {
    this.bookUnsaved.emit(book);
  }

  onDiscard(book: Book): void {
    this.bookDiscarded.emit(book);
  }

  onRate(event: { book: Book; rating: BookRating }): void {
    this.bookRated.emit(event);
  }

  onCardClick(book: Book): void {
    this.bookClicked.emit(book);
  }

  onSimilarRequested(book: Book): void {
    this.similarRequested.emit(book);
  }
}
