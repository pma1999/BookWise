import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LocalStorageService } from '../../services/local-storage.service';
import { UserDataService } from '../../services/user-data.service';
import { AuthService } from '../../services/auth.service';
import {
  RecommendationHistoryEntry,
  BookwiseProfile,
  RecommendationRequest,
} from '../../models/recommendation.model';

interface FormattedHistoryEntry {
  id: string;
  date: Date;
  timeAgo: string;
  summary: string;
  resultsCount: number;
  query: RecommendationRequest;
}

const PURPOSE_EMOJIS: Record<string, string> = {
  enjoy: '😊',
  learn: '📚',
  reflect: '🤔',
  escape: '🚀',
};

const MOOD_EMOJIS: Record<string, string> = {
  light: '🌤️',
  intense: '⚡',
  dark: '🌙',
  uplifting: '☀️',
  melancholic: '🌧️',
  mysterious: '🔮',
  adventurous: '🏔️',
  romantic: '💕',
  humorous: '😄',
  serious: '🎭',
};

@Component({
  selector: 'app-historial',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './historial.component.html',
  styleUrl: './historial.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistorialComponent implements OnInit {
  history: FormattedHistoryEntry[] = [];
  profile: BookwiseProfile | null = null;

  constructor(
    private localStorageService: LocalStorageService,
    private userData: UserDataService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    if (this.auth.getCurrentUser()) {
      // Load from Supabase for authenticated users
      const entries = await this.userData.getHistory();
      this.history = entries
        .slice()
        .reverse()
        .map((entry: any) => this.formatEntryFromSupabase(entry));
    } else {
      // Load from localStorage for unauthenticated users
      this.profile = this.localStorageService.getProfile();
      const entries = this.profile.recommendation_history || [];
      this.history = entries
        .slice()
        .reverse()
        .map(entry => this.formatEntry(entry));
    }

    this.cdr.markForCheck();
  }

  private formatEntryFromSupabase(entry: any): FormattedHistoryEntry {
    return {
      id: entry.id,
      date: new Date(entry.created_at),
      timeAgo: this.getTimeAgo(new Date(entry.created_at)),
      summary: this.buildSummary({
        purpose: entry.purpose || 'enjoy',
        mood: entry.mood,
        genres: entry.genres || [],
        length: entry.length,
        language: entry.language,
        freetext: entry.freetext,
        profile: null,
      } as RecommendationRequest),
      resultsCount: entry.results_count,
      query: {
        purpose: entry.purpose || 'enjoy',
        mood: entry.mood,
        genres: entry.genres || [],
        length: entry.length,
        language: entry.language,
        freetext: entry.freetext,
        profile: null,
      } as RecommendationRequest,
    };
  }

  private formatEntry(entry: RecommendationHistoryEntry): FormattedHistoryEntry {
    return {
      id: entry.id,
      date: new Date(entry.timestamp),
      timeAgo: this.getTimeAgo(new Date(entry.timestamp)),
      summary: this.buildSummary(entry.query),
      resultsCount: entry.results_count,
      query: entry.query,
    };
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) {
      return 'Justo ahora';
    } else if (diffMins < 60) {
      return `Hace ${diffMins} min`;
    } else if (diffHours < 24) {
      return `Hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    } else if (diffDays === 1) {
      return 'Ayer';
    } else if (diffDays < 7) {
      return `Hace ${diffDays} días`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`;
    } else {
      return date.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
      });
    }
  }

  private buildSummary(query: RecommendationRequest): string {
    const parts: string[] = [];

    // Purpose emoji
    if (query.purpose) {
      parts.push(PURPOSE_EMOJIS[query.purpose] || '📖');
    }

    // Mood emoji
    if (query.mood) {
      const moodEmoji = MOOD_EMOJIS[query.mood.toLowerCase()];
      if (moodEmoji) {
        parts.push(moodEmoji);
      }
    }

    // Genres (max 2)
    if (query.genres && query.genres.length > 0) {
      const genreLabels: Record<string, string> = {
        ficcion_literaria: 'Ficción literaria',
        ciencia_ficcion: 'Ciencia ficción',
        fantasia: 'Fantasía',
        thriller_misterio: 'Thriller',
        romance: 'Romance',
        terror: 'Terror',
        historica: 'Histórica',
        no_ficcion_ensayo: 'No ficción',
        biografia_memorias: 'Biografía',
        ciencia_divulgacion: 'Ciencia',
        filosofia: 'Filosofía',
        negocios_productividad: 'Negocios',
        poesia: 'Poesía',
        comic_novela_grafica: 'Cómic',
      };

      const genreNames = query.genres
        .slice(0, 2)
        .map(g => genreLabels[g] || g);
      parts.push(...genreNames);
    }

    // Free text (truncated if present)
    if (query.freetext) {
      const truncated =
        query.freetext.length > 30
          ? query.freetext.substring(0, 30) + '...'
          : query.freetext;
      parts.push(`"${truncated}"`);
    }

    if (parts.length === 0) {
      return 'Búsqueda genérica';
    }

    return parts.join(' · ');
  }

  onEntryClick(entry: FormattedHistoryEntry): void {
    // Store the query in sessionStorage to be picked up by the home component
    sessionStorage.setItem('pending_search_query', JSON.stringify(entry.query));
  }

  async clearHistory(): Promise<void> {
    if (confirm('¿Estás seguro de que quieres borrar todo el historial? Esta acción no se puede deshacer.')) {
      if (this.auth.getCurrentUser()) {
        // For authenticated users, we'd need to delete from Supabase
        // For now, just reload (in a full implementation, add a delete method to UserDataService)
        this.history = [];
      } else if (this.profile) {
        this.profile.recommendation_history = [];
        this.localStorageService.importProfile(this.profile);
      }
      this.loadHistory();
    }
  }
}
