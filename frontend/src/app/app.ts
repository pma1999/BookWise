import { Component, OnInit, ViewChild } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { UserMenuComponent } from './components/user-menu/user-menu.component';
import { ApiKeyService } from './services/api-key.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SettingsPanelComponent, UserMenuComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  title = 'BookWise';
  settingsOpen = false;
  navOpen = false;

  @ViewChild(SettingsPanelComponent) settingsPanel?: SettingsPanelComponent;

  constructor(
    private router: Router,
    private apiKeyService: ApiKeyService,
  ) {}

  ngOnInit(): void {
    // When a component requests the settings panel to open on the API key tab,
    // open the panel and navigate to that tab.
    this.apiKeyService.openSettingsRequested$.subscribe(() => {
      this.settingsOpen = true;
      // Defer to let the component render before switching tab
      setTimeout(() => {
        if (this.settingsPanel) {
          this.settingsPanel.activeTab = 'api-key';
        }
      }, 0);
    });
  }

  toggleSettings(): void { this.settingsOpen = !this.settingsOpen; }
  closeSettings(): void { this.settingsOpen = false; }
  toggleNav(): void { this.navOpen = !this.navOpen; }
  closeNav(): void { this.navOpen = false; }
  onDataCleared(): void {
    this.settingsOpen = false;
    this.router.navigate(['/']);
  }
}
