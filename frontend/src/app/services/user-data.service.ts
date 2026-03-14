import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, map, of, switchMap, tap } from 'rxjs';
import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { LocalStorageService } from './local-storage.service';
import { Book } from '../models/book.model';
import {
  SavedBook,
  RejectedBook,
  UserProfile,
  RecommendationRequest,
  BookwiseProfile,
} from '../models/recommendation.model';

export interface MigrationResult {
  success: boolean;
  booksMigrated: number;
  rejectedMigrated: number;
  historyMigrated: number;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class UserDataService {
  private savedBooksSubject = new BehaviorSubject<SavedBook[]>([]);
  private rejectedBooksSubject = new BehaviorSubject<RejectedBook[]>([]);
  private hasAttemptedMigration = false;

  readonly savedBooks$ = this.savedBooksSubject.asObservable();
  readonly rejectedBooks$ = this.rejectedBooksSubject.asObservable();

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService,
    private localStorage: LocalStorageService,
  ) {
    // Load data when auth state changes
    this.auth.authState$.subscribe((state) => {
      if (state.isAuthenticated && state.user) {
        this.loadUserData();
      } else {
        this.clearCache();
      }
    });
  }

  // ========== Saved Books ==========

  async loadSavedBooks(): Promise<void> {
    const userId = this.auth.getUserId();
    if (!userId) return;

    const { data, error } = await this.supabase
      .getClient()
      .from('saved_books')
      .select('*')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });

    if (error) {
      console.error('[UserData] Error loading saved books:', error);
      return;
    }

    this.savedBooksSubject.next(data || []);
  }

  getSavedBooks(): SavedBook[] {
    return this.savedBooksSubject.value;
  }

  async saveBook(book: Book): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      // Fallback to localStorage for unauthenticated users
      this.localStorage.saveBook(book);
      return {};
    }

    const { error } = await this.supabase.getClient().from('saved_books').insert({
      user_id: userId,
      openlibrary_id: book.work_id || book.id,
      title: book.title,
      author: book.author,
      cover_url: book.cover_url,
      reason: book.reason,
      status: 'want_to_read',
      saved_at: new Date().toISOString(),
    });

    if (!error) {
      await this.loadSavedBooks();
    }

    return { error };
  }

  async unsaveBook(book: Book): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      this.localStorage.unsaveBook(book);
      return {};
    }

    const { error } = await this.supabase
      .getDb()('saved_books')
      .delete()
      .eq('user_id', userId)
      .eq('title', book.title)
      .eq('author', book.author);

    if (!error) {
      await this.loadSavedBooks();
    }

    return { error };
  }

  async markAsRead(
    book: Book,
    rating: 'loved' | 'ok' | 'disliked',
  ): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      this.localStorage.markAsRead(book, rating);
      return {};
    }

    // Check if book exists
    const { data: existing } = await this.supabase
      .getDb()('saved_books')
      .select('id')
      .eq('user_id', userId)
      .eq('title', book.title)
      .eq('author', book.author)
      .single();

    if (existing) {
      // Update existing
      const { error } = await this.supabase
        .getDb()('saved_books')
        .update({
          status: 'read',
          rating,
          read_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (!error) await this.loadSavedBooks();
      return { error };
    } else {
      // Insert new
      const { error } = await this.supabase.getClient().from('saved_books').insert({
        user_id: userId,
        openlibrary_id: book.work_id || book.id,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url,
        reason: book.reason,
        status: 'read',
        rating,
        saved_at: new Date().toISOString(),
        read_at: new Date().toISOString(),
      });

      if (!error) await this.loadSavedBooks();
      return { error };
    }
  }

  isSaved(book: Book): boolean {
    return this.savedBooksSubject.value.some(
      (b) => b.title === book.title && b.author === book.author && b.status === 'want_to_read',
    );
  }

  isRead(book: Book): boolean {
    return this.savedBooksSubject.value.some(
      (b) => b.title === book.title && b.author === book.author && b.status === 'read',
    );
  }

  getBookRating(book: Book): 'loved' | 'ok' | 'disliked' | null {
    const saved = this.savedBooksSubject.value.find(
      (b) => b.title === book.title && b.author === book.author,
    );
    return saved?.rating ?? null;
  }

  // ========== Rejected Books ==========

  async loadRejectedBooks(): Promise<void> {
    const userId = this.auth.getUserId();
    if (!userId) return;

    const { data, error } = await this.supabase
      .getDb()('rejected_books')
      .select('*')
      .eq('user_id', userId)
      .order('rejected_at', { ascending: false });

    if (error) {
      console.error('[UserData] Error loading rejected books:', error);
      return;
    }

    this.rejectedBooksSubject.next(data || []);
  }

  async rejectBook(book: Book): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      this.localStorage.rejectBook(book);
      return {};
    }

    const { error } = await this.supabase.getClient().from('rejected_books').insert({
      user_id: userId,
      title: book.title,
      author: book.author,
      rejected_at: new Date().toISOString(),
    });

    if (!error) {
      await this.loadRejectedBooks();
    }

    return { error };
  }

  isRejected(book: Book): boolean {
    return this.rejectedBooksSubject.value.some(
      (b) => b.title === book.title && b.author === book.author,
    );
  }

  // ========== Recommendation History ==========

  async addToHistory(
    query: RecommendationRequest,
    resultsCount: number,
  ): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      this.localStorage.addToHistory(query, resultsCount);
      return {};
    }

    const { error } = await this.supabase.getClient().from('recommendation_history').insert({
      user_id: userId,
      purpose: query.purpose,
      mood: query.mood,
      genres: query.genres,
      length: query.length,
      language: query.language,
      freetext: query.freetext,
      results_count: resultsCount,
    });

    return { error };
  }

  async getHistory(): Promise<any[]> {
    const userId = this.auth.getUserId();
    if (!userId) {
      return this.localStorage.getProfile().recommendation_history;
    }

    const { data, error } = await this.supabase
      .getDb()('recommendation_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[UserData] Error loading history:', error);
      return [];
    }

    return data || [];
  }

  // ========== User Profile for Backend ==========

  buildUserProfile(): UserProfile {
    const userId = this.auth.getUserId();
    if (!userId) {
      return this.localStorage.buildUserProfile();
    }

    const saved = this.savedBooksSubject.value;
    const rejected = this.rejectedBooksSubject.value;

    return {
      liked: saved
        .filter((b) => b.rating === 'loved')
        .slice(-15)
        .map((b) => ({ title: b.title, author: b.author })),
      disliked: saved
        .filter((b) => b.rating === 'disliked')
        .slice(-10)
        .map((b) => ({ title: b.title, author: b.author })),
      read: saved
        .filter((b) => b.status === 'read')
        .slice(-30)
        .map((b) => ({ title: b.title, author: b.author, rating: b.rating ?? '' })),
      rejected: rejected.slice(-20).map((r) => ({ title: r.title, author: r.author })),
    };
  }

  // ========== Migration ==========

  hasLocalData(): boolean {
    const profile = this.localStorage.getProfile();
    return (
      profile.saved_books.length > 0 ||
      profile.rejected_books.length > 0 ||
      profile.recommendation_history.length > 0
    );
  }

  async hasMigratedData(): Promise<boolean> {
    const userId = this.auth.getUserId();
    if (!userId) return false;

    const { data } = await this.supabase
      .getDb()('user_migrations')
      .select('id')
      .eq('user_id', userId)
      .single();

    return !!data;
  }

  async migrateFromLocalStorage(): Promise<MigrationResult> {
    const userId = this.auth.getUserId();
    if (!userId) {
      return { success: false, booksMigrated: 0, rejectedMigrated: 0, historyMigrated: 0, error: 'No authenticated user' };
    }

    // Check if already migrated
    const alreadyMigrated = await this.hasMigratedData();
    if (alreadyMigrated) {
      return { success: true, booksMigrated: 0, rejectedMigrated: 0, historyMigrated: 0 };
    }

    const localProfile = this.localStorage.getProfile();
    let booksMigrated = 0;
    let rejectedMigrated = 0;
    let historyMigrated = 0;

    try {
      // Migrate saved books
      if (localProfile.saved_books.length > 0) {
        const booksToInsert = localProfile.saved_books.map((book) => ({
          user_id: userId,
          openlibrary_id: book.id,
          title: book.title,
          author: book.author,
          cover_url: book.cover_url,
          reason: book.reason,
          status: book.status,
          rating: book.rating,
          saved_at: book.saved_at,
          read_at: book.status === 'read' ? book.saved_at : null,
        }));

        // Insert in batches of 50
        for (let i = 0; i < booksToInsert.length; i += 50) {
          const batch = booksToInsert.slice(i, i + 50);
          const { error } = await this.supabase.getClient().from('saved_books').insert(batch);
          if (error) throw error;
          booksMigrated += batch.length;
        }
      }

      // Migrate rejected books
      if (localProfile.rejected_books.length > 0) {
        const rejectedToInsert = localProfile.rejected_books.map((book) => ({
          user_id: userId,
          title: book.title,
          author: book.author,
          rejected_at: book.rejected_at,
        }));

        for (let i = 0; i < rejectedToInsert.length; i += 50) {
          const batch = rejectedToInsert.slice(i, i + 50);
          const { error } = await this.supabase.getClient().from('rejected_books').insert(batch);
          if (error) throw error;
          rejectedMigrated += batch.length;
        }
      }

      // Migrate history
      if (localProfile.recommendation_history.length > 0) {
        const historyToInsert = localProfile.recommendation_history.map((entry) => ({
          user_id: userId,
          purpose: entry.query.purpose,
          mood: entry.query.mood,
          genres: entry.query.genres,
          length: entry.query.length,
          language: entry.query.language,
          freetext: entry.query.freetext,
          results_count: entry.results_count,
          created_at: entry.timestamp,
        }));

        for (let i = 0; i < historyToInsert.length; i += 50) {
          const batch = historyToInsert.slice(i, i + 50);
          const { error } = await this.supabase.getClient().from('recommendation_history').insert(batch);
          if (error) throw error;
          historyMigrated += batch.length;
        }
      }

      // Record migration
      await this.supabase.getClient().from('user_migrations').insert({
        user_id: userId,
        books_migrated: booksMigrated,
        rejected_migrated: rejectedMigrated,
        history_migrated: historyMigrated,
      });

      // Clear localStorage after successful migration
      this.localStorage.clearAll();

      // Reload data
      await this.loadUserData();

      return {
        success: true,
        booksMigrated,
        rejectedMigrated,
        historyMigrated,
      };
    } catch (error: any) {
      console.error('[UserData] Migration error:', error);
      return {
        success: false,
        booksMigrated,
        rejectedMigrated,
        historyMigrated,
        error: error.message,
      };
    }
  }

  async skipMigration(): Promise<void> {
    const userId = this.auth.getUserId();
    if (!userId) return;

    await this.supabase.getClient().from('user_migrations').insert({
      user_id: userId,
      books_migrated: 0,
      rejected_migrated: 0,
      history_migrated: 0,
    });
  }

  // ========== Clear Data ==========

  async clearAllData(): Promise<{ error?: PostgrestError | null }> {
    const userId = this.auth.getUserId();
    if (!userId) {
      this.localStorage.clearAll();
      return {};
    }

    // Delete all user data
    await this.supabase.getClient().from('saved_books').delete().eq('user_id', userId);
    await this.supabase.getClient().from('rejected_books').delete().eq('user_id', userId);
    await this.supabase.getClient().from('recommendation_history').delete().eq('user_id', userId);

    this.clearCache();
    return {};
  }

  // ========== Helper Methods ==========

  private async loadUserData(): Promise<void> {
    await Promise.all([this.loadSavedBooks(), this.loadRejectedBooks()]);
  }

  private clearCache(): void {
    this.savedBooksSubject.next([]);
    this.rejectedBooksSubject.next([]);
  }
}
