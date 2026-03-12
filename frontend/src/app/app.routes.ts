import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { AuthGuard } from './guards/auth.guard';
import { NoAuthGuard } from './guards/no-auth.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'auth',
    loadComponent: () =>
      import('./components/auth/auth.component').then(m => m.AuthComponent),
    canActivate: [NoAuthGuard],
  },
  {
    path: 'biblioteca',
    loadComponent: () =>
      import('./components/biblioteca/biblioteca.component').then(m => m.BibliotecaComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'historial',
    loadComponent: () =>
      import('./components/historial/historial.component').then(m => m.HistorialComponent),
    canActivate: [AuthGuard],
  },
  { path: '**', redirectTo: '' },
];
