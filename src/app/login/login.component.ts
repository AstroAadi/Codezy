// login.component.ts
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css', '../navbar/navbar.component.css'], // include your theme CSS
  imports:[FormsModule, CommonModule, RouterModule]
})
export class LoginComponent {
  userId: string = '';
  password: string = '';
  error: string = '';

  constructor(private auth: AuthService, private router: Router) {}

  navigateHome() {
    this.router.navigate(['']);
  }
  onLogin() {
    this.auth.login({ email: this.userId, password: this.password }).subscribe({
      next: () => this.router.navigate(['/']),
      error: err => this.error = err.error?.message || 'Login failed'
    });
  }
}
