import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css', '../navbar/navbar.component.css'], // include your theme CSS
    imports: [FormsModule, CommonModule, RouterModule]
})
export class LoginComponent {
  userId: string = '';
  password: string = '';
  error: string = '';
  private returnUrl: string = '/';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.returnUrl = params['returnUrl'] || '/';
      console.log('LoginComponent: returnUrl from queryParams:', this.returnUrl); // Add this line
    });
  }

  navigateHome() {
    this.router.navigate(['']);
  }
  onLogin() {
    console.log('Attempting login for userId:', this.userId); // Add this line
    this.auth.login({ email: this.userId, password: this.password }).subscribe({
      next: () => {
        console.log('Login successful. Navigating to:', this.returnUrl); // Add this line
        this.router.navigateByUrl(this.returnUrl);
      },
      error: err => {
        this.error = err.error?.message || 'Login failed';
        console.error('Login failed:', err); // Add this line
      }
    });
  }
}
