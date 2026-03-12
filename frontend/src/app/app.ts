import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { UserMenuComponent } from './components/user-menu/user-menu.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SettingsPanelComponent, UserMenuComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  title = 'BookWise';
  settingsOpen = false;

  constructor(private router: Router) {}

  toggleSettings(): void { this.settingsOpen = !this.settingsOpen; }
  closeSettings(): void { this.settingsOpen = false; }
  onDataCleared(): void {
    this.settingsOpen = false;
    this.router.navigate(['/']);
  }
}
