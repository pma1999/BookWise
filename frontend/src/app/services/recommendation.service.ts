import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

import { RecommendationRequest, RecommendationResponse, ApiError, UserProfile } from '../models/recommendation.model';
import { Book } from '../models/book.model';
import { environment } from '../../environments/environment';

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

@Injectable({ providedIn: 'root' })
export class RecommendationService {
  constructor(private http: HttpClient) {}

  recommend(request: RecommendationRequest): Observable<RecommendationResponse> {
    return this.http
      .post<RecommendationResponse>(`${API_BASE}/recommend`, request)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(err => this._handleError(err)),
      );
  }

  getSimilarRecommendations(request: SimilarRecommendationRequest): Observable<RecommendationResponse> {
    return this.http
      .post<RecommendationResponse>(`${API_BASE}/recommend/similar`, request)
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
      // Backend returned a structured error
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
