import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Book } from '../../models/book.model';

export type BookRating = 'loved' | 'ok' | 'disliked';
export type BookCardVariant = 'discovery' | 'library';

@Component({
  selector: 'app-book-card',
  imports: [DecimalPipe],
  templateUrl: './book-card.component.html',
  styleUrl: './book-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCardComponent {
  @Input({ required: true }) book!: Book;
  @Input() variant: BookCardVariant = 'discovery';
  @Input() isSaved = false;
  @Input() isDiscarded = false;
  @Input() isRead = false;
  @Input() bookRating: BookRating | null = null;
  @Input() loadingSimilar = false;

  @Output() saved = new EventEmitter<Book>();
  @Output() unsaved = new EventEmitter<Book>();
  @Output() discarded = new EventEmitter<Book>();
  @Output() rated = new EventEmitter<{ book: Book; rating: BookRating }>();
  @Output() similarRequested = new EventEmitter<Book>();
  @Output() cardClicked = new EventEmitter<Book>();

  showRatingModal = false;

  get visibleSubjects(): string[] {
    return (this.book.subjects || []).slice(0, 3);
  }

  getPlaceholderGradient(title: string): string {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const hue2 = (hue + 45) % 360;
    return `linear-gradient(145deg, hsl(${hue}, 55%, 32%), hsl(${hue2}, 60%, 22%))`;
  }

  getInitials(title: string): string {
    return (title || '')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  onSaveToggle(event: Event): void {
    event.stopPropagation();
    if (this.isSaved) {
      this.unsaved.emit(this.book);
    } else {
      this.saved.emit(this.book);
    }
  }

  onDiscard(event: Event): void {
    event.stopPropagation();
    this.discarded.emit(this.book);
  }

  onRead(event: Event): void {
    event.stopPropagation();
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

  onSimilar(event: Event): void {
    event.stopPropagation();
    this.similarRequested.emit(this.book);
  }

  onCardClick(): void {
    // Only emit if not clicking on buttons
    this.cardClicked.emit(this.book);
  }
}
