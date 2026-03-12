import {
  Component,
  Input,
  ChangeDetectionStrategy,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ProfileQualityLevel {
  min: number;
  max: number;
  label: string;
  description: string;
  color: 'gray' | 'blue' | 'amber' | 'green';
  icon: string;
}

const QUALITY_LEVELS: ProfileQualityLevel[] = [
  {
    min: 0,
    max: 0,
    label: 'Perfil vacío',
    description: 'Las recomendaciones son genéricas. ¡Empieza a valorar libros para mejorarlas!',
    color: 'gray',
    icon: '🌱',
  },
  {
    min: 1,
    max: 5,
    label: 'Primeros pasos',
    description: 'Empezamos a conocerte. Sigue valorando para afinar las recomendaciones.',
    color: 'blue',
    icon: '🌿',
  },
  {
    min: 6,
    max: 15,
    label: 'Buena base',
    description: 'Buena base. Las recomendaciones ya se adaptan a tus gustos.',
    color: 'amber',
    icon: '🌳',
  },
  {
    min: 16,
    max: Infinity,
    label: 'Perfil rico',
    description: 'Perfil rico. Las recomendaciones están muy personalizadas.',
    color: 'green',
    icon: '🏆',
  },
];

@Component({
  selector: 'app-profile-quality',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-quality.component.html',
  styleUrl: './profile-quality.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileQualityComponent implements OnChanges {
  @Input() ratingCount = 0;

  currentLevel: ProfileQualityLevel = QUALITY_LEVELS[0];
  progressPercent = 0;
  nextLevelThreshold = 1;

  ngOnChanges(): void {
    this.updateLevel();
  }

  private updateLevel(): void {
    for (const level of QUALITY_LEVELS) {
      if (this.ratingCount >= level.min && this.ratingCount <= level.max) {
        this.currentLevel = level;
        break;
      }
    }

    // Calculate progress to next level
    const currentIndex = QUALITY_LEVELS.indexOf(this.currentLevel);
    if (currentIndex < QUALITY_LEVELS.length - 1) {
      const nextLevel = QUALITY_LEVELS[currentIndex + 1];
      this.nextLevelThreshold = nextLevel.min;
      const range = nextLevel.min - this.currentLevel.min;
      const progress = this.ratingCount - this.currentLevel.min;
      this.progressPercent = Math.min(100, (progress / range) * 100);
    } else {
      // At max level
      this.nextLevelThreshold = this.currentLevel.min;
      this.progressPercent = 100;
    }
  }

  get colorClass(): string {
    return `color-${this.currentLevel.color}`;
  }

  get progressGradient(): string {
    const colors: Record<string, string> = {
      gray: '#6b7280',
      blue: '#60a5fa',
      amber: '#f59e0b',
      green: '#22c55e',
    };
    const color = colors[this.currentLevel.color];
    return `linear-gradient(90deg, ${color} 0%, ${color} ${this.progressPercent}%, rgba(255,255,255,0.1) ${this.progressPercent}%, rgba(255,255,255,0.1) 100%)`;
  }
}
