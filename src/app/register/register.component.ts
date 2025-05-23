import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  imports: [FormsModule, CommonModule, RouterModule]
})
export class RegisterComponent {
  name: string = '';
  email: string = '';
  password: string = '';
  confirmPassword: string = '';
  error: string = '';
  otp: string = '';
  otpSent: boolean = false;
  otpVerified: boolean = false;
  otpError: string = '';

  constructor(private auth: AuthService, private router: Router) {}

  navigateHome() {
    this.router.navigate(['']);
  }

  getOtp() {
    this.error = '';
    this.otpError = '';
    if (!this.email) {
      this.otpError = 'Please enter your email first.';
      return;
    }
    this.auth.sendOtp(this.email).subscribe({
      next: () => {
        this.otpSent = true;
        this.otpError = '';
      },
      error: err => {
        this.otpError = err.error?.message || 'Failed to send OTP.';
      }
    });
  }

  verifyOtp() {
    this.otpError = '';
    if (!this.otp) {
      this.otpError = 'Please enter the OTP.';
      return;
    }
    this.auth.verifyOtp(this.email, this.otp).subscribe({
      next: (res) => {
        if (res && res.valid) {
          this.otpVerified = true;
          this.otpError = '';
        } else {
          this.otpVerified = false;
          this.otpError = 'Invalid OTP.';
        }
      },
      error: err => {
        this.otpVerified = false;
        this.otpError = err.error?.message || 'Invalid OTP.';
      }
    });
  }

  onRegister() {
    this.error = '';
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match!';
      return;
    }
    if (!this.otpVerified) {
      this.error = 'Please verify OTP before registering.';
      return;
    }
    this.auth.register({ name: this.name, email: this.email, password: this.password, otp: this.otp }).subscribe({
      next: () => this.router.navigate(['/']),
      error: err => this.error = err.error?.message || 'Registration failed'
    });
  }
}
