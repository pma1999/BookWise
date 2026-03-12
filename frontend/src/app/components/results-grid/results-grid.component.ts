import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

import { Book } from '../../models/book.model';
import { BookCardComponent, BookRating } from '../book-card/book-card.component';

@Component({
  selector: 'app-results-grid',
  imports: [BookCardComponent],
  templateUrl: './results-grid.component.html',
  styleUrl: './results-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsGridComponent {
  @Input({ required: true }) books: Book[] = [];
  @Input() savedTitles = new Set<string>();
  @Input() discardedTitles = new Set<string>();
  @Input() readTitles = new Set<string>();
  @Input() ratings = new Map<string, BookRating>();

  @Output() saved = new EventEmitter<Book>();
  @Output() unsaved = new EventEmitter<Book>();
  @Output() discarded = new EventEmitter<Book>();
  @Output() rated = new EventEmitter<{ book: Book; rating: BookRating }>();

  trackBook(_: number, book: Book): string {
    return book.id ?? book.title;
  }

  isSaved(book: Book): boolean {
    return this.savedTitles.has(book.title);
  }

  isDiscarded(book: Book): boolean {
    return this.discardedTitles.has(book.title);
  }

  isRead(book: Book): boolean {
    return this.readTitles.has(book.title);
  }

  getRating(book: Book): BookRating | null {
    return this.ratings.get(book.title) ?? null;
  }
}
