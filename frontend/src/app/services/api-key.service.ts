import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

const API_BASE = (environment.apiUrl || 'http://localhost:5000') + '/api';
const LS_KEY = 'bookwise_gemini_api_key';

export interface ApiKeyStatus {
  hasKey: boolean;
  hint: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private statusSubject = new BehaviorSubject<ApiKeyStatus>({ hasKey: false, hint: null });
  private openSettingsSubject = new Subject<void>();

  readonly status$ = this.statusSubject.asObservable();
  /** Emit to request that the settings panel opens on the API key tab. */
  readonly openSettingsRequested$ = this.openSettingsSubject.asObservable();

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private supabase: SupabaseService,
  ) {
    // Re-evaluate key status whenever auth state changes
    this.auth.authState$.subscribe(state => {
      if (state.isLoading) return;
      if (state.isAuthenticated) {
        this.loadKeyStatus();
      } else {
        this._refreshGuestStatus();
      }
    });
  }

  /** Current snapshot of key status. */
  getStatus(): ApiKeyStatus {
    return this.statusSubject.value;
  }

  /**
   * Save the API key.
   *  - Authenticated users: encrypted + stored in backend DB
   *  - Guest users: stored in localStorage
   */
  async saveKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error('La clave de API no puede estar vacía.');

    if (this.auth.getCurrentUser()) {
      const token = await this._getAccessToken();
      if (!token) throw new Error('No se pudo obtener el token de autenticación.');

      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      const resp = await firstValueFrom(
        this.http.post<{ hint: string }>(`${API_BASE}/user/api-key`, { api_key: trimmed }, { headers })
      );
      this.statusSubject.next({ hasKey: true, hint: resp.hint });
    } else {
      localStorage.setItem(LS_KEY, trimmed);
      this.statusSubject.next({ hasKey: true, hint: this._makeHint(trimmed) });
    }
  }

  /**
   * Delete the stored API key.
   *  - Authenticated users: removed from backend DB
   *  - Guest users: removed from localStorage
   */
  async deleteKey(): Promise<void> {
    if (this.auth.getCurrentUser()) {
      const token = await this._getAccessToken();
      if (!token) throw new Error('No se pudo obtener el token de autenticación.');

      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      await firstValueFrom(
        this.http.delete(`${API_BASE}/user/api-key`, { headers, responseType: 'text' })
      );
    } else {
      localStorage.removeItem(LS_KEY);
    }
    this.statusSubject.next({ hasKey: false, hint: null });
  }

  /**
   * Build the HTTP headers to attach to every recommendation request.
   *  - Authenticated users: `Authorization: Bearer <supabase_jwt>` (backend decrypts key)
   *  - Guest users: `X-Gemini-Api-Key: <plaintext>` (key from localStorage)
   */
  async getApiHeaders(): Promise<Record<string, string>> {
    if (this.auth.getCurrentUser()) {
      const token = await this._getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    const key = localStorage.getItem(LS_KEY);
    return key ? { 'X-Gemini-Api-Key': key } : {};
  }

  /** Fetch key status from backend for the authenticated user. */
  async loadKeyStatus(): Promise<void> {
    try {
      const token = await this._getAccessToken();
      if (!token) {
        this.statusSubject.next({ hasKey: false, hint: null });
        return;
      }
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      const resp = await firstValueFrom(
        this.http.get<{ has_key: boolean; hint: string | null }>(`${API_BASE}/user/api-key/status`, { headers })
      );
      this.statusSubject.next({ hasKey: resp.has_key, hint: resp.hint });
    } catch {
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

  private async _getAccessToken(): Promise<string | null> {
    const { data: { session } } = await this.supabase.getAuth().getSession();
    return session?.access_token ?? null;
  }

  /** Request the settings panel to open on the API key tab. */
  requestOpenSettings(): void {
    this.openSettingsSubject.next();
  }

  private _makeHint(key: string): string {
    if (key.length < 9) return '***';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
}
