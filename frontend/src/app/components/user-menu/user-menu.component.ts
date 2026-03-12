import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';

@Component({
  selector: 'app-user-menu',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
  ],
  templateUrl: './user-menu.component.html',
  styleUrls: ['./user-menu.component.scss'],
})
export class UserMenuComponent {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private router = inject(Router);

  readonly user$ = this.auth.user$;
  readonly isAuthenticated$ = this.auth.isAuthenticated$;

  async onLogout() {
    await this.auth.signOut();
  }

  onLogin() {
    this.router.navigate(['/auth']);
  }

  async onClearData() {
    if (confirm('¿Estás seguro de que quieres borrar todos tus datos? Esta acción no se puede deshacer.')) {
      await this.userData.clearAllData();
    }
  }

  getInitials(user: any): string {
    const fullName = user?.user_metadata?.['full_name'] || user?.email || '';
    return fullName
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}
