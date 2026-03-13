import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Output,
  EventEmitter,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { LocalStorageService } from '../../services/local-storage.service';
import { UserDataService } from '../../services/user-data.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { ApiKeyService } from '../../services/api-key.service';
import { Book } from '../../models/book.model';
import { BookwiseProfile, SavedBook, RejectedBook } from '../../models/recommendation.model';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, MatSnackBarModule],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPanelComponent {
  @Output() closed = new EventEmitter<void>();
  @Output() dataCleared = new EventEmitter<void>();

  activeTab: 'data' | 'api-key' | 'account' = 'data';
  deleteStep: 'idle' | 'confirming' = 'idle';
  deleteConfirmValue = '';
  importError: string | null = null;
  importPreview: { savedCount: number; rejectedCount: number } | null = null;
  private pendingImport: BookwiseProfile | null = null;

  // User account
  isAuthenticated = false;
  userEmail: string | null = null;
  userName: string | null = null;

  // API key
  apiKeyInput = '';
  apiKeyVisible = false;
  apiKeySaving = false;
  apiKeyDeleting = false;
  apiKeyError: string | null = null;
  apiKeyHasKey = false;
  apiKeyHint: string | null = null;

  constructor(
    private ls: LocalStorageService,
    private userData: UserDataService,
    private auth: AuthService,
    private supabase: SupabaseService,
    private apiKey: ApiKeyService,
    private cdr: ChangeDetectorRef,
  ) {
    this.auth.authState$.subscribe(state => {
      this.isAuthenticated = state.isAuthenticated;
      this.userEmail = state.user?.email ?? null;
      this.userName = state.user?.user_metadata?.['full_name'] ?? null;
      this.cdr.markForCheck();
    });
    this.apiKey.status$.subscribe(status => {
      this.apiKeyHasKey = status.hasKey;
      this.apiKeyHint = status.hint;
      this.cdr.markForCheck();
    });
  }

  get canConfirmDelete(): boolean { return this.deleteConfirmValue === 'BORRAR'; }

  onExport(): void {
    const json = JSON.stringify(this.ls.getProfile(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'bookwise-profile.json' });
    a.click();
    URL.revokeObjectURL(url);
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!this._isValid(data)) {
          this.importError = 'El archivo no es un perfil BookWise válido.';
          this.importPreview = null;
          this.pendingImport = null;
        } else {
          this.importError = null;
          this.pendingImport = data as BookwiseProfile;
          this.importPreview = {
            savedCount: data.saved_books?.length ?? 0,
            rejectedCount: data.rejected_books?.length ?? 0,
          };
        }
      } catch {
        this.importError = 'No se pudo leer el archivo. Asegúrate de que es JSON válido.';
        this.importPreview = null;
        this.pendingImport = null;
      }
      this.cdr.markForCheck();
    };
    reader.readAsText(file);
  }

  async confirmImport(): Promise<void> {
    if (!this.pendingImport) return;

    const merged = this._merge(this.ls.getProfile(), this.pendingImport);
    this.ls.importProfile(merged);

    // If authenticated, also sync to Supabase
    if (this.isAuthenticated && this.auth.getCurrentUser()) {
      await this._syncImportToSupabase(merged);
    }

    this.pendingImport = null;
    this.importPreview = null;
    this.cdr.markForCheck();
  }

  private async _syncImportToSupabase(profile: BookwiseProfile): Promise<void> {
    try {
      const userId = this.auth.getCurrentUser()?.id;
      if (!userId) return;

      // Get the Supabase client directly
      const client = this.supabase.getClient();

      // Prepare books for Supabase
      const booksToInsert = profile.saved_books.map(book => ({
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

      // Insert saved books in batches
      if (booksToInsert.length > 0) {
        for (let i = 0; i < booksToInsert.length; i += 50) {
          const batch = booksToInsert.slice(i, i + 50);
          const { error } = await client.from('saved_books').insert(batch);
          if (error) {
            console.error('Error inserting books batch:', error);
          }
        }
      }

      // Prepare rejected books
      const rejectedToInsert = profile.rejected_books.map(book => ({
        user_id: userId,
        title: book.title,
        author: book.author,
        rejected_at: book.rejected_at,
      }));

      // Insert rejected books in batches
      if (rejectedToInsert.length > 0) {
        for (let i = 0; i < rejectedToInsert.length; i += 50) {
          const batch = rejectedToInsert.slice(i, i + 50);
          const { error } = await client.from('rejected_books').insert(batch);
          if (error) {
            console.error('Error inserting rejected batch:', error);
          }
        }
      }

      // Reload data from Supabase
      await this.userData.loadSavedBooks();

      this.snackBar.open('Datos importados y sincronizados con la nube', 'Cerrar', { duration: 3000 });
    } catch (error) {
      console.error('Error syncing import to Supabase:', error);
      this.snackBar.open('Error al sincronizar con la nube', 'Cerrar', { duration: 3000 });
    }
  }

  // Need snackBar for notifications
  private snackBar = inject(MatSnackBar);

  cancelImport(): void {
    this.pendingImport = null;
    this.importPreview = null;
    this.importError = null;
    this.cdr.markForCheck();
  }

  startDelete(): void { this.deleteStep = 'confirming'; this.deleteConfirmValue = ''; this.cdr.markForCheck(); }
  cancelDelete(): void { this.deleteStep = 'idle'; this.deleteConfirmValue = ''; this.cdr.markForCheck(); }

  async confirmDelete(): Promise<void> {
    if (!this.canConfirmDelete) return;
    // Clear both localStorage and Supabase data if authenticated
    await this.userData.clearAllData();
    this.dataCleared.emit();
  }

  async onSaveApiKey(): Promise<void> {
    if (!this.apiKeyInput.trim()) return;
    this.apiKeySaving = true;
    this.apiKeyError = null;
    this.cdr.markForCheck();
    try {
      await this.apiKey.saveKey(this.apiKeyInput.trim());
      this.apiKeyInput = '';
      this.apiKeyVisible = false;
      this.snackBar.open('Clave de API guardada correctamente', 'Cerrar', { duration: 3000 });
    } catch (err: unknown) {
      this.apiKeyError = err instanceof Error ? err.message : 'Error al guardar la clave.';
    } finally {
      this.apiKeySaving = false;
      this.cdr.markForCheck();
    }
  }

  async onDeleteApiKey(): Promise<void> {
    this.apiKeyDeleting = true;
    this.apiKeyError = null;
    this.cdr.markForCheck();
    try {
      await this.apiKey.deleteKey();
      this.snackBar.open('Clave de API eliminada', 'Cerrar', { duration: 3000 });
    } catch (err: unknown) {
      this.apiKeyError = err instanceof Error ? err.message : 'Error al eliminar la clave.';
    } finally {
      this.apiKeyDeleting = false;
      this.cdr.markForCheck();
    }
  }

  async onLogout(): Promise<void> {
    await this.auth.signOut();
    this.closed.emit();
  }

  onLogin(): void {
    this.closed.emit();
    // Navigate to auth - handled by router
  }

  private _isValid(d: unknown): boolean {
    if (!d || typeof d !== 'object') return false;
    const o = d as Record<string, unknown>;
    return typeof o['version'] === 'number' && Array.isArray(o['saved_books']) &&
      Array.isArray(o['rejected_books']) && typeof o['created_at'] === 'string';
  }

  private _merge(current: BookwiseProfile, incoming: BookwiseProfile): BookwiseProfile {
    const created_at = current.created_at < incoming.created_at ? current.created_at : incoming.created_at;
    const savedMap = new Map<string, SavedBook>();
    for (const b of current.saved_books) savedMap.set(`${b.title}||${b.author}`, b);
    for (const b of incoming.saved_books) savedMap.set(`${b.title}||${b.author}`, b);
    const rejectedMap = new Map<string, RejectedBook>();
    for (const r of current.rejected_books) rejectedMap.set(`${r.title}||${r.author}`, r);
    for (const r of incoming.rejected_books) rejectedMap.set(`${r.title}||${r.author}`, r);
    const histMap = new Map(
      [...current.recommendation_history, ...incoming.recommendation_history].map(h => [h.id, h])
    );
    const history = [...histMap.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-50);
    return {
      version: 1, created_at, updated_at: new Date().toISOString(),
      saved_books: [...savedMap.values()],
      rejected_books: [...rejectedMap.values()].slice(-500),
      recommendation_history: history,
    };
  }
}
