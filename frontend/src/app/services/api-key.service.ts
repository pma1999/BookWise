import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const LS_KEY = 'bookwise_gemini_api_key';

export interface ApiKeyStatus {
  hasKey: boolean;
  hint: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private statusSubject = new BehaviorSubject<ApiKeyStatus>({ hasKey: false, hint: null });
  private openSettingsSubject = new Subject<void>();

  /** In-memory cache for authenticated users — cleared on logout. */
  private _cachedKey: string | null = null;

  readonly status$ = this.statusSubject.asObservable();
  /** Emit to request the settings panel to open on the API key tab. */
  readonly openSettingsRequested$ = this.openSettingsSubject.asObservable();

  constructor(
    private auth: AuthService,
    private supabase: SupabaseService,
  ) {
    this.auth.authState$.subscribe(state => {
      if (state.isLoading) return;

      if (state.isAuthenticated && state.user) {
        // Load key from Supabase DB (once per session)
        this._loadKeyFromDB(state.user.id);
      } else {
        // Clear the in-memory cache and reflect guest localStorage state
        this._cachedKey = null;
        this._refreshGuestStatus();
      }
    });
  }

  /** Current snapshot (synchronous). */
  getStatus(): ApiKeyStatus {
    return this.statusSubject.value;
  }

  /**
   * Return headers to attach to every recommendation request.
   * Synchronous — the key is always cached in memory after initial load.
   *
   *  Auth users  → { 'X-Gemini-Api-Key': <key from DB, cached> }
   *  Guest users → { 'X-Gemini-Api-Key': <key from localStorage> }
   */
  getApiHeaders(): Record<string, string> {
    const key = this.auth.getCurrentUser()
      ? this._cachedKey
      : localStorage.getItem(LS_KEY);

    return key ? { 'X-Gemini-Api-Key': key } : {};
  }

  /**
   * Save the user's Gemini API key.
   *  - Auth users: upsert to Supabase user_api_keys table (RLS-protected), update cache.
   *  - Guests: store in localStorage.
   */
  async saveKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error('La clave de API no puede estar vacía.');

    const user = this.auth.getCurrentUser();
    if (user) {
      const { error } = await this.supabase.getClient()
        .from('user_api_keys')
        .upsert(
          { user_id: user.id, api_key: trimmed, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
      if (error) throw new Error(error.message);
      this._cachedKey = trimmed;
    } else {
      localStorage.setItem(LS_KEY, trimmed);
    }

    this.statusSubject.next({ hasKey: true, hint: this._makeHint(trimmed) });
  }

  /**
   * Delete the stored API key.
   *  - Auth users: delete from Supabase, clear cache.
   *  - Guests: remove from localStorage.
   */
  async deleteKey(): Promise<void> {
    const user = this.auth.getCurrentUser();
    if (user) {
      const { error } = await this.supabase.getClient()
        .from('user_api_keys')
        .delete()
        .eq('user_id', user.id);
      if (error) throw new Error(error.message);
      this._cachedKey = null;
    } else {
      localStorage.removeItem(LS_KEY);
    }

    this.statusSubject.next({ hasKey: false, hint: null });
  }

  /** Request the settings panel to open on the API key tab. */
  requestOpenSettings(): void {
    this.openSettingsSubject.next();
  }

  // ── Private ──────────────────────────────────────────────

  private async _loadKeyFromDB(userId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.getClient()
        .from('user_api_keys')
        .select('api_key')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[ApiKey] Error loading key from DB:', error.message);
        this.statusSubject.next({ hasKey: false, hint: null });
        return;
      }

      if (data?.api_key) {
        this._cachedKey = data.api_key;
        this.statusSubject.next({ hasKey: true, hint: this._makeHint(data.api_key) });
      } else {
        this._cachedKey = null;
        this.statusSubject.next({ hasKey: false, hint: null });
      }
    } catch (err) {
      console.error('[ApiKey] Unexpected error loading key:', err);
      this.statusSubject.next({ hasKey: false, hint: null });
    }
  }

  private _refreshGuestStatus(): void {
    const key = localStorage.getItem(LS_KEY);
    this.statusSubject.next({
      hasKey: !!key,
      hint: key ? this._makeHint(key) : null,
    });
  }

  private _makeHint(key: string): string {
    if (key.length < 9) return '***';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
}
