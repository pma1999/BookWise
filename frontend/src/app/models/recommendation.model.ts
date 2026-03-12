import { Book } from './book.model';

export interface UserProfile {
  liked: Array<{ title: string; author: string }>;
  disliked: Array<{ title: string; author: string }>;
  read: Array<{ title: string; author: string; rating: string }>;
  rejected?: Array<{ title: string; author: string }>;
}

export interface RecommendationRequest {
  purpose: 'enjoy' | 'learn' | 'reflect' | 'escape';
  mood: string | null;
  genres: string[];
  length: 'short' | 'medium' | 'long' | null;
  language: string | null;
  freetext: string | null;
  profile: UserProfile | null;
}

export interface RecommendationMeta {
  total_generated: number;
  total_validated: number;
  retry_needed: boolean;
  processing_time_ms: number;
}

export interface RecommendationResponse {
  books: Book[];
  meta: RecommendationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

// localStorage persistence types
export interface SavedBook {
  id: string | null;
  title: string;
  author: string;
  cover_url: string | null;
  reason: string;
  saved_at: string;
  status: 'want_to_read' | 'read';
  rating: 'loved' | 'ok' | 'disliked' | null;
}

export interface RejectedBook {
  title: string;
  author: string;
  rejected_at: string;
}

export interface BookwiseProfile {
  version: number;
  created_at: string;
  updated_at: string;
  saved_books: SavedBook[];
  rejected_books: RejectedBook[];
  recommendation_history: RecommendationHistoryEntry[];
}

export interface RecommendationHistoryEntry {
  id: string;
  timestamp: string;
  query: RecommendationRequest;
  results_count: number;
}
