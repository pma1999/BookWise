import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

import { RecommendationRequest, RecommendationResponse, ApiError, UserProfile } from '../models/recommendation.model';
import { Book } from '../models/book.model';
import { environment } from '../../environments/environment';
import { ApiKeyService } from './api-key.service';

const API_BASE = (environment.apiUrl || 'http://localhost:5000') + '/api';
const REQUEST_TIMEOUT_MS = 120_000;

export interface SimilarRecommendationRequest {
  seed_book: { title: string; author: string };
  profile?: UserProfile | null;
  count?: number;
}

export interface IntentInferenceResponse {
  purpose: 'enjoy' | 'learn' | 'reflect' | 'escape';
  mood: string | null;
  inferred_genres: string[];
}

export interface ManualSearchRequest {
  q: string;
  page?: number;
  limit?: number;
  language?: string | null;
  subject?: string | null;
  year_from?: number | null;
  year_to?: number | null;
}

export interface ManualSearchResponse {
  books: Book[];
  meta: {
    num_found: number;
    start: number;
    page: number;
    limit: number;
    has_next_page: boolean;
    processing_time_ms: number;
  };
}

@Injectable({ providedIn: 'root' })
export class RecommendationService {
  constructor(
    private http: HttpClient,
    private apiKeyService: ApiKeyService,
  ) {}

  recommend(request: RecommendationRequest): Observable<RecommendationResponse> {
    const headers = new HttpHeaders(this.apiKeyService.getApiHeaders());
    return this.http
      .post<RecommendationResponse>(`${API_BASE}/recommend`, request, { headers })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(err => this._handleError(err)),
      );
  }

  getSimilarRecommendations(request: SimilarRecommendationRequest): Observable<RecommendationResponse> {
    const headers = new HttpHeaders(this.apiKeyService.getApiHeaders());
    return this.http
      .post<RecommendationResponse>(`${API_BASE}/recommend/similar`, request, { headers })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(err => this._handleError(err)),
      );
  }

  searchOpenLibrary(request: ManualSearchRequest): Observable<ManualSearchResponse> {
    const params = new URLSearchParams();
    params.set('q', request.q.trim());
    if (request.page) params.set('page', `${request.page}`);
    if (request.limit) params.set('limit', `${request.limit}`);
    if (request.language) params.set('language', request.language);
    if (request.subject) params.set('subject', request.subject);
    if (request.year_from) params.set('year_from', `${request.year_from}`);
    if (request.year_to) params.set('year_to', `${request.year_to}`);

    return this.http
      .get<ManualSearchResponse>(`${API_BASE}/books/search?${params.toString()}`)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(err => this._handleError(err)),
      );
  }

  private _handleError(err: unknown): Observable<never> {
    let apiError: ApiError;

    if (err instanceof TimeoutError) {
      apiError = {
        code: 'TIMEOUT',
        message: 'La búsqueda está tardando demasiado. Inténtalo de nuevo.',
        retryable: true,
      };
    } else if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body?.error?.code) {
        apiError = body.error as ApiError;
      } else if (err.status === 0) {
        apiError = {
          code: 'NETWORK_ERROR',
          message: 'Sin conexión al servidor. Comprueba que el backend está ejecutándose.',
          retryable: true,
        };
      } else {
        apiError = {
          code: 'SERVER_ERROR',
          message: `Error del servidor (${err.status}). Inténtalo de nuevo.`,
          retryable: true,
        };
      }
    } else {
      apiError = {
        code: 'UNKNOWN_ERROR',
        message: 'Ha ocurrido un error inesperado.',
        retryable: true,
      };
    }

    return throwError(() => ({ error: apiError }));
  }
}
