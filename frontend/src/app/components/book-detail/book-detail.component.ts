import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Book } from '../../models/book.model';
import { BookRating } from '../book-card/book-card.component';

@Component({
  selector: 'app-book-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-detail.component.html',
  styleUrl: './book-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookDetailComponent {
  @Input({ required: true }) book!: Book;
  @Input() isSaved = false;
  @Input() isDiscarded = false;
  @Input() isRead = false;
  @Input() bookRating: BookRating | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Book>();
  @Output() unsaved = new EventEmitter<Book>();
  @Output() discarded = new EventEmitter<Book>();
  @Output() rated = new EventEmitter<{ book: Book; rating: BookRating }>();
  @Output() similarRequested = new EventEmitter<Book>();

  showRatingModal = false;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  get coverUrl(): string | null {
    return this.book.cover_url_large || this.book.cover_url;
  }

  get googleBooksUrl(): string | null {
    if (this.book.isbn) {
      return `https://books.google.com/books?isbn=${this.book.isbn}`;
    }
    return null;
  }

  get allSubjects(): string[] {
    return this.book.subjects || [];
  }

  get ratingDisplay(): string {
    if (!this.book.rating) return '';
    return this.book.rating.toFixed(1);
  }

  close(): void {
    this.closed.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onSaveToggle(): void {
    if (this.isSaved) {
      this.unsaved.emit(this.book);
    } else {
      this.saved.emit(this.book);
    }
  }

  onDiscard(): void {
    this.discarded.emit(this.book);
  }

  onRead(): void {
    if (this.isRead) {
      this.showRatingModal = !this.showRatingModal;
    } else {
      this.showRatingModal = true;
    }
  }

  submitRating(rating: BookRating): void {
    this.rated.emit({ book: this.book, rating });
    this.showRatingModal = false;
  }

  closeRatingModal(): void {
    this.showRatingModal = false;
  }

  onSimilarRequest(): void {
    this.similarRequested.emit(this.book);
  }

  getRatingEmoji(rating: BookRating): string {
    switch (rating) {
      case 'loved':
        return '😍';
      case 'ok':
        return '🙂';
      case 'disliked':
        return '😕';
      default:
        return '';
    }
  }

  getRatingLabel(rating: BookRating): string {
    switch (rating) {
      case 'loved':
        return 'Me encantó';
      case 'ok':
        return 'Estuvo bien';
      case 'disliked':
        return 'No me gustó';
      default:
        return '';
    }
  }
}
