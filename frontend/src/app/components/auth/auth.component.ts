import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
})
export class AuthComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);

  activeTab = 0;
  isLoading = false;
  showMigrationDialog = false;
  hidePassword = true;
  hideConfirmPassword = true;

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  registerForm: FormGroup = this.fb.group(
    {
      fullName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: this.passwordMatchValidator },
  );

  resetForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  showResetForm = false;

  ngOnInit() {
    // Check for redirect URL
    const redirect = this.route.snapshot.queryParams['redirect'];
    if (redirect) {
      this.snackBar.open('Por favor, inicia sesión para continuar', 'Cerrar', {
        duration: 5000,
      });
    }
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  async onLogin() {
    if (this.loginForm.invalid) return;

    this.isLoading = true;
    const { email, password } = this.loginForm.value;

    const { error } = await this.auth.signIn(email, password);

    if (error) {
      this.showError(this.getErrorMessage(error));
    } else {
      // Check for local data to migrate
      if (this.userData.hasLocalData()) {
        const hasMigrated = await this.userData.hasMigratedData();
        if (!hasMigrated) {
          this.showMigrationDialog = true;
          this.isLoading = false;
          return;
        }
      }
      this.onAuthSuccess();
    }

    this.isLoading = false;
  }

  async onRegister() {
    if (this.registerForm.invalid) return;

    this.isLoading = true;
    const { fullName, email, password } = this.registerForm.value;

    const { error } = await this.auth.signUp(email, password, { full_name: fullName });

    if (error) {
      this.showError(this.getErrorMessage(error));
    } else {
      this.snackBar.open(
        'Registro exitoso. Por favor, verifica tu email para continuar.',
        'Cerrar',
        { duration: 8000 },
      );
      this.activeTab = 0;
      this.registerForm.reset();
    }

    this.isLoading = false;
  }

  async onResetPassword() {
    if (this.resetForm.invalid) return;

    this.isLoading = true;
    const { email } = this.resetForm.value;

    const { error } = await this.auth.resetPassword(email);

    if (error) {
      this.showError(this.getErrorMessage(error));
    } else {
      this.snackBar.open(
        'Se ha enviado un email con instrucciones para restablecer tu contraseña.',
        'Cerrar',
        { duration: 8000 },
      );
      this.showResetForm = false;
      this.resetForm.reset();
    }

    this.isLoading = false;
  }

  async onMigrateData() {
    this.isLoading = true;
    const result = await this.userData.migrateFromLocalStorage();

    if (result.success) {
      this.snackBar.open(
        `Migración completada: ${result.booksMigrated} libros migrados`,
        'Cerrar',
        { duration: 5000 },
      );
      this.showMigrationDialog = false;
      this.onAuthSuccess();
    } else {
      this.showError(`Error en la migración: ${result.error}`);
    }

    this.isLoading = false;
  }

  async onSkipMigration() {
    await this.userData.skipMigration();
    this.showMigrationDialog = false;
    this.onAuthSuccess();
  }

  private onAuthSuccess() {
    const redirect = this.route.snapshot.queryParams['redirect'] || '/';
    this.router.navigate([redirect]);
  }

  private showError(message: string) {
    this.snackBar.open(message, 'Cerrar', {
      duration: 5000,
      panelClass: ['error-snackbar'],
    });
  }

  private getErrorMessage(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('invalid login credentials')) {
      return 'Email o contraseña incorrectos';
    }
    if (message.includes('email not confirmed')) {
      return 'Por favor, confirma tu email antes de iniciar sesión';
    }
    if (message.includes('user already registered')) {
      return 'Este email ya está registrado';
    }
    if (message.includes('rate limit')) {
      return 'Demasiados intentos. Por favor, espera un momento';
    }

    return error.message || 'Ha ocurrido un error. Por favor, intenta de nuevo.';
  }
}
