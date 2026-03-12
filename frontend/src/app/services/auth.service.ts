import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, from, map, filter, firstValueFrom } from 'rxjs';
import { User, AuthError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private authState = new BehaviorSubject<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  readonly authState$ = this.authState.asObservable();
  readonly user$ = this.authState.pipe(map(state => state.user));
  readonly isAuthenticated$ = this.authState.pipe(map(state => state.isAuthenticated));
  readonly isLoading$ = this.authState.pipe(map(state => state.isLoading));

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {
    this.initializeAuth();
  }

  private async initializeAuth(): Promise<void> {
    // Check current session
    const { data: { session } } = await this.supabase.getAuth().getSession();
    this.updateAuthState(session?.user ?? null);

    // Listen for auth changes
    this.supabase.onAuthStateChange((event, session) => {
      this.updateAuthState(session?.user ?? null);
    });
  }

  private updateAuthState(user: User | null): void {
    this.authState.next({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    });
  }

  getCurrentUser(): User | null {
    return this.authState.value.user;
  }

  getUserId(): string | null {
    return this.authState.value.user?.id ?? null;
  }

  async signUp(email: string, password: string, metadata?: { full_name?: string }): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    return { error };
  }

  async signIn(email: string, password: string): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().signInWithPassword({
      email,
      password,
    });

    if (!error) {
      // Wait for auth state to be updated
      await firstValueFrom(
        this.isAuthenticated$.pipe(filter(isAuth => isAuth))
      );
    }

    return { error };
  }

  async signInWithOAuth(provider: 'google' | 'github'): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    });
    return { error };
  }

  async signOut(): Promise<void> {
    await this.supabase.getAuth().signOut();
    await this.router.navigate(['/']);
  }

  async resetPassword(email: string): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth/reset-password',
    });
    return { error };
  }

  async updatePassword(newPassword: string): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().updateUser({
      password: newPassword,
    });
    return { error };
  }

  async resendConfirmationEmail(email: string): Promise<{ error?: AuthError | null }> {
    const { error } = await this.supabase.getAuth().resend({
      type: 'signup',
      email,
    });
    return { error };
  }
}
