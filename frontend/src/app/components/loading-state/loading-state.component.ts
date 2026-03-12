import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';

type Purpose = 'enjoy' | 'learn' | 'reflect' | 'escape';

const MESSAGES: Record<Purpose | 'default', string[]> = {
  enjoy: [
    'Rebuscando entre bestsellers olvidados...',
    'Descartando los que ya has visto en todas las listas...',
    'Encontrando lecturas que de verdad engancharán...',
    'Comprobando que existen de verdad...',
  ],
  learn: [
    'Consultando las estanterías de los expertos...',
    'Filtrando los que realmente enseñan algo...',
    'Buscando los más reveladores de su tema...',
    'Verificando fuentes y ediciones...',
  ],
  reflect: [
    'Buscando libros que dejan huella...',
    'Explorando ideas que cambian perspectivas...',
    'Seleccionando los más profundos...',
    'Validando cada recomendación...',
  ],
  escape: [
    'Preparando tu billete de ida...',
    'Encontrando mundos en los que perderte...',
    'Eligiendo los mejores destinos literarios...',
    'Últimos ajustes al itinerario...',
  ],
  default: [
    'Analizando tu búsqueda...',
    'Consultando miles de libros...',
    'Validando las recomendaciones...',
    'Casi listo...',
  ],
};

// Shown after 20s — request is still alive, just being patient
const PATIENCE_MESSAGES: string[] = [
  'Los libros buenos se hacen esperar...',
  'Consultando más fuentes para encontrar los mejores...',
  'Verificando cada detalle con cuidado...',
  'Vale la pena esperar por las mejores recomendaciones...',
];

const SKELETON_COUNT = 5;

@Component({
  selector: 'app-loading-state',
  imports: [],
  templateUrl: './loading-state.component.html',
  styleUrl: './loading-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingStateComponent implements OnInit, OnDestroy {
  @Input() purpose: string = '';
  @Input() isTimedOut = false;

  @Output() timedOut = new EventEmitter<void>();

  currentMessage = '';
  isFading = false;
  skeletons = Array(SKELETON_COUNT);

  private messageIdx = 0;
  private msgInterval?: ReturnType<typeof setInterval>;
  private patienceRef?: ReturnType<typeof setTimeout>;
  private timeoutRef?: ReturnType<typeof setTimeout>;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const msgs = MESSAGES[(this.purpose as Purpose)] ?? MESSAGES['default'];
    this.currentMessage = msgs[0];

    this.msgInterval = setInterval(() => {
      this.isFading = true;
      this.cdr.markForCheck();

      setTimeout(() => {
        this.messageIdx = (this.messageIdx + 1) % msgs.length;
        this.currentMessage = msgs[this.messageIdx];
        this.isFading = false;
        this.cdr.markForCheck();
      }, 400);
    }, 2500);

    // After 20s: switch to patience messages (request still alive, just slow)
    this.patienceRef = setTimeout(() => {
      clearInterval(this.msgInterval);
      this.messageIdx = 0;
      this.currentMessage = PATIENCE_MESSAGES[0];
      this.cdr.markForCheck();

      this.msgInterval = setInterval(() => {
        this.isFading = true;
        this.cdr.markForCheck();

        setTimeout(() => {
          this.messageIdx = (this.messageIdx + 1) % PATIENCE_MESSAGES.length;
          this.currentMessage = PATIENCE_MESSAGES[this.messageIdx];
          this.isFading = false;
          this.cdr.markForCheck();
        }, 400);
      }, 3000);
    }, 20_000);

    // After 110s: truly give up (HTTP timeout fires at 120s)
    this.timeoutRef = setTimeout(() => {
      this.timedOut.emit();
      this.cdr.markForCheck();
    }, 110_000);
  }

  ngOnDestroy(): void {
    if (this.msgInterval) clearInterval(this.msgInterval);
    if (this.patienceRef) clearTimeout(this.patienceRef);
    if (this.timeoutRef) clearTimeout(this.timeoutRef);
  }
}
