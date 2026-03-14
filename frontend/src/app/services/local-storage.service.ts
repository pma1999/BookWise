import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Book } from '../models/book.model';
import {
  BookwiseProfile,
  SavedBook,
  RejectedBook,
  UserProfile,
  RecommendationRequest,
} from '../models/recommendation.model';

const STORAGE_KEY = 'bookwise_profile';
const MAX_REJECTED = 500;
const MAX_SAVED = 200;
const MAX_HISTORY = 50;

@Injectable({ providedIn: 'root' })
export class LocalStorageService {

  private readonly _clearedSubject = new Subject<void>();
  readonly profileCleared$ = this._clearedSubject.asObservable();

  getProfile(): BookwiseProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as BookwiseProfile;
      }
    } catch {
      // corrupted data — fall through to default
    }
    return this._defaultProfile();
  }

  saveBook(book: Book): void {
    const profile = this.getProfile();
    const exists = profile.saved_books.some(
      b => b.title === book.title && b.author === book.author,
    );
    if (!exists) {
      const entry: SavedBook = {
        id: book.work_id || book.id,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url,
        reason: book.reason,
        saved_at: new Date().toISOString(),
        status: 'want_to_read',
        rating: null,
      };
      profile.saved_books.push(entry);
      if (profile.saved_books.length > MAX_SAVED) {
        console.warn(`[BookWise] saved_books limit (${MAX_SAVED}) reached.`);
      }
      this._persist(profile);
    }
  }

  unsaveBook(book: Book): void {
    const profile = this.getProfile();
    profile.saved_books = profile.saved_books.filter(
      b => !(b.title === book.title && b.author === book.author),
    );
    this._persist(profile);
  }

  rejectBook(book: Book): void {
    const profile = this.getProfile();
    const exists = profile.rejected_books.some(
      r => r.title === book.title && r.author === book.author,
    );
    if (!exists) {
      const entry: RejectedBook = {
        title: book.title,
        author: book.author,
        rejected_at: new Date().toISOString(),
      };
      profile.rejected_books.push(entry);
      // FIFO limit
      if (profile.rejected_books.length > MAX_REJECTED) {
        profile.rejected_books = profile.rejected_books.slice(-MAX_REJECTED);
      }
      this._persist(profile);
    }
  }

  markAsRead(book: Book, rating: 'loved' | 'ok' | 'disliked'): void {
    const profile = this.getProfile();
    const idx = profile.saved_books.findIndex(
      b => b.title === book.title && b.author === book.author,
    );
    if (idx >= 0) {
      profile.saved_books[idx].status = 'read';
      profile.saved_books[idx].rating = rating;
    } else {
      profile.saved_books.push({
        id: book.work_id || book.id,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url,
        reason: book.reason,
        saved_at: new Date().toISOString(),
        status: 'read',
        rating,
      });
    }
    this._persist(profile);
  }

  isSaved(book: Book): boolean {
    return this.getProfile().saved_books.some(
      b => b.title === book.title && b.author === book.author && b.status === 'want_to_read',
    );
  }

  isRead(book: Book): boolean {
    return this.getProfile().saved_books.some(
      b => b.title === book.title && b.author === book.author && b.status === 'read',
    );
  }

  getBookRating(book: Book): 'loved' | 'ok' | 'disliked' | null {
    return (
      this.getProfile().saved_books.find(
        b => b.title === book.title && b.author === book.author,
      )?.rating ?? null
    );
  }

  addToHistory(query: RecommendationRequest, results_count: number): void {
    const profile = this.getProfile();
    profile.recommendation_history.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      query,
      results_count,
    });
    // FIFO: mantener solo los últimos 50
    profile.recommendation_history = profile.recommendation_history.slice(-MAX_HISTORY);
    this._persist(profile);
  }

  buildUserProfile(): UserProfile {
    const profile = this.getProfile();
    const saved = profile.saved_books;
    return {
      liked: saved
        .filter(b => b.rating === 'loved')
        .slice(-15)
        .map(b => ({ title: b.title, author: b.author })),
      disliked: saved
        .filter(b => b.rating === 'disliked')
        .slice(-10)
        .map(b => ({ title: b.title, author: b.author })),
      read: saved
        .slice(-30)
        .map(b => ({ title: b.title, author: b.author, rating: b.rating ?? '' })),
      rejected: profile.rejected_books
        .slice(-20)
        .map(r => ({ title: r.title, author: r.author })),
    };
  }

  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this._clearedSubject.next();
    } catch (e) {
      console.error('[BookWise] Failed to clear profile', e);
    }
  }

  importProfile(profile: BookwiseProfile): void {
    this._persist(profile);
  }

  private _persist(profile: BookwiseProfile): void {
    profile.updated_at = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('[BookWise] Failed to persist profile to localStorage', e);
    }
  }

  private _defaultProfile(): BookwiseProfile {
    const now = new Date().toISOString();
    return {
      version: 1,
      created_at: now,
      updated_at: now,
      saved_books: [],
      rejected_books: [],
      recommendation_history: [],
    };
  }
}
