import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, take, filter, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    // Wait for auth to finish loading, then check authentication
    return this.auth.isLoading$.pipe(
      filter(isLoading => !isLoading), // Wait until loading is complete
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
      map((isAuthenticated) => {
        if (isAuthenticated) {
          return true;
        }
        return this.router.createUrlTree(['/auth'], {
          queryParams: { redirect: this.router.url },
        });
      }),
    );
  }
}
