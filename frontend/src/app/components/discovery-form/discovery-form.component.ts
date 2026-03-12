import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { RecommendationRequest } from '../../models/recommendation.model';

type Purpose = 'enjoy' | 'learn' | 'reflect' | 'escape';
type Mood =
  | 'light' | 'intense' | 'melancholic' | 'inspiring' | 'mysterious' | 'calm';
type Length = 'short' | 'medium' | 'long';

const PLACEHOLDERS = [
  'Algo como Cien años de soledad pero más corto...',
  'Un thriller psicológico que no pueda soltar...',
  'Quiero aprender sobre estoicismo sin que sea un manual denso...',
  'Ficción japonesa contemporánea que no sea Murakami...',
  'Una novela histórica ambientada en el siglo XIX...',
  'Ciencia ficción que te haga pensar sin ser técnica...',
];

const PLACEHOLDER_INTERVAL_MS = 8_000;

export type FormMode = 'quick' | 'detailed';

@Component({
  selector: 'app-discovery-form',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './discovery-form.component.html',
  styleUrl: './discovery-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryFormComponent implements OnInit, OnDestroy, OnChanges {
  @Input() disabled = false;
  /** Increment to trigger clearing of optional filters */
  @Input() resetOptionalTrigger = 0;
  @Input() mode: FormMode = 'detailed';
  @Input() setInitialValues: RecommendationRequest | null = null;

  @Output() formSubmit = new EventEmitter<RecommendationRequest>();
  @Output() modeChange = new EventEmitter<FormMode>();

  // ── Form state ────────────────────────────────────────
  freetext = '';
  selectedPurpose: Purpose | null = null;
  selectedMood: Mood | null = null;
  selectedGenres: string[] = [];
  selectedLength: Length | null = null;
  languageEnabled = false;
  selectedLanguage: string | null = null;

  // ── Placeholder rotation ──────────────────────────────
  currentPlaceholder = PLACEHOLDERS[0];
  placeholderFading = false;
  private placeholderIdx = 0;
  private placeholderTimer?: ReturnType<typeof setInterval>;

  // ── Static data ───────────────────────────────────────
  readonly purposeOptions: { value: Purpose; icon: string; label: string; desc: string }[] = [
    { value: 'enjoy',   icon: 'auto_stories',    label: 'Disfrutar',   desc: 'Entretenimiento puro' },
    { value: 'learn',   icon: 'school',          label: 'Aprender',    desc: 'Adquirir conocimiento' },
    { value: 'reflect', icon: 'self_improvement', label: 'Reflexionar', desc: 'Crecimiento personal' },
    { value: 'escape',  icon: 'flight_takeoff',   label: 'Evadirme',    desc: 'Escapismo total' },
  ];

  readonly moodOptions: { value: Mood; label: string }[] = [
    { value: 'light',       label: 'Ligero y divertido' },
    { value: 'intense',     label: 'Intenso y absorbente' },
    { value: 'melancholic', label: 'Melancólico y profundo' },
    { value: 'inspiring',   label: 'Inspirador y motivante' },
    { value: 'mysterious',  label: 'Misterioso e intrigante' },
    { value: 'calm',        label: 'Tranquilo y contemplativo' },
  ];

  readonly genreOptions: { value: string; label: string }[] = [
    { value: 'ficcion_literaria',    label: 'Ficción literaria' },
    { value: 'ciencia_ficcion',      label: 'Ciencia ficción' },
    { value: 'fantasia',             label: 'Fantasía' },
    { value: 'thriller_misterio',    label: 'Thriller / Misterio' },
    { value: 'romance',              label: 'Romance' },
    { value: 'terror',               label: 'Terror' },
    { value: 'historica',            label: 'Histórica' },
    { value: 'no_ficcion_ensayo',    label: 'No ficción / Ensayo' },
    { value: 'biografia_memorias',   label: 'Biografía / Memorias' },
    { value: 'ciencia_divulgacion',  label: 'Ciencia y divulgación' },
    { value: 'filosofia',            label: 'Filosofía' },
    { value: 'negocios_productividad', label: 'Negocios y productividad' },
    { value: 'poesia',               label: 'Poesía' },
    { value: 'comic_novela_grafica', label: 'Cómic / Novela gráfica' },
  ];

  readonly lengthOptions: { value: Length; label: string; desc: string }[] = [
    { value: 'short',  label: 'Corto',  desc: '< 200 pág.' },
    { value: 'medium', label: 'Medio',  desc: '200–400 pág.' },
    { value: 'long',   label: 'Largo',  desc: '> 400 pág.' },
  ];

  readonly languageOptions: { value: string; label: string }[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'Inglés' },
    { value: 'fr', label: 'Francés' },
    { value: 'de', label: 'Alemán' },
    { value: 'ja', label: 'Japonés' },
    { value: 'ru', label: 'Ruso' },
    { value: 'it', label: 'Italiano' },
    { value: 'pt', label: 'Portugués' },
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.placeholderTimer = setInterval(() => this._rotatePlaceholder(), PLACEHOLDER_INTERVAL_MS);

    // Apply initial values if provided
    if (this.setInitialValues) {
      this.applyInitialValues(this.setInitialValues);
    }

    // Check for pending search query from sessionStorage
    const pending = sessionStorage.getItem('pending_search_query');
    if (pending) {
      try {
        const query = JSON.parse(pending) as RecommendationRequest;
        this.applyInitialValues(query);
        this.mode = 'detailed';
        sessionStorage.removeItem('pending_search_query');
      } catch {
        // ignore parsing errors
      }
    }
  }

  applyInitialValues(query: RecommendationRequest): void {
    this.selectedPurpose = query.purpose;
    this.selectedMood = query.mood as Mood | null;
    this.selectedGenres = [...(query.genres || [])];
    this.selectedLength = query.length as Length | null;
    this.selectedLanguage = query.language;
    this.languageEnabled = !!query.language;
    this.freetext = query.freetext || '';
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.placeholderTimer) clearInterval(this.placeholderTimer);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['resetOptionalTrigger'] &&
      !changes['resetOptionalTrigger'].firstChange
    ) {
      this.clearOptionalFilters();
    }
  }

  // ── Computed ──────────────────────────────────────────
  get canSubmit(): boolean {
    if (this.disabled) return false;
    // Quick mode: require freetext
    if (this.mode === 'quick') {
      return this.freetext.trim().length >= 3;
    }
    // Detailed mode: require purpose
    return !!this.selectedPurpose;
  }

  get canQuickSubmit(): boolean {
    return this.freetext.trim().length >= 3 && !this.disabled;
  }

  get showHint(): boolean {
    return !this.freetext.trim() && !this.selectedMood && this.selectedGenres.length === 0;
  }

  get isQuickMode(): boolean {
    return this.mode === 'quick';
  }

  get isDetailedMode(): boolean {
    return this.mode === 'detailed';
  }

  isGenreSelected(value: string): boolean {
    return this.selectedGenres.includes(value);
  }

  // ── Actions ───────────────────────────────────────────
  selectPurpose(value: Purpose): void {
    this.selectedPurpose = this.selectedPurpose === value ? null : value;
  }

  selectMood(value: Mood): void {
    this.selectedMood = this.selectedMood === value ? null : value;
  }

  toggleGenre(value: string): void {
    const idx = this.selectedGenres.indexOf(value);
    if (idx > -1) {
      this.selectedGenres.splice(idx, 1);
    } else {
      if (this.selectedGenres.length >= 3) {
        this.selectedGenres.shift(); // FIFO: remove oldest
      }
      this.selectedGenres.push(value);
    }
    // Trigger change detection for OnPush
    this.selectedGenres = [...this.selectedGenres];
  }

  selectLength(value: Length): void {
    this.selectedLength = this.selectedLength === value ? null : value;
  }

  clearOptionalFilters(): void {
    this.selectedMood = null;
    this.selectedGenres = [];
    this.selectedLength = null;
    this.languageEnabled = false;
    this.selectedLanguage = null;
    this.cdr.markForCheck();
  }

  toggleMode(): void {
    this.mode = this.mode === 'quick' ? 'detailed' : 'quick';
    this.modeChange.emit(this.mode);
  }

  setMode(mode: FormMode): void {
    this.mode = mode;
    this.modeChange.emit(this.mode);
  }

  onSubmit(): void {
    if (!this.canSubmit) return;
    this.formSubmit.emit({
      purpose: this.selectedPurpose!,
      mood: this.selectedMood,
      genres: [...this.selectedGenres],
      length: this.selectedLength,
      language: this.languageEnabled ? this.selectedLanguage : null,
      freetext: this.freetext.trim() || null,
      profile: null,
    });
  }

  private _rotatePlaceholder(): void {
    this.placeholderFading = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.placeholderIdx = (this.placeholderIdx + 1) % PLACEHOLDERS.length;
      this.currentPlaceholder = PLACEHOLDERS[this.placeholderIdx];
      this.placeholderFading = false;
      this.cdr.markForCheck();
    }, 450);
  }
}
