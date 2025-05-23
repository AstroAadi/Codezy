import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<string | null>(null);
  user$ = this.userSubject.asObservable();
  private apiUrl = 'http://localhost:8081/api/auth';

  constructor(private http: HttpClient) {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      this.userSubject.next(savedUser);
    }
  }

  register(data: { name: string; email: string; password: string; otp: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/register?otp=${encodeURIComponent(data.otp)}`, data).pipe(
      tap(res => {
        if (res && res.token && res.user) {
          this.userSubject.next(res.user.name || res.user.email);
          localStorage.setItem('user', res.user.name || res.user.email);
          localStorage.setItem('token', res.token);
        }
      })
    );
  }

  sendOtp(email: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/send-otp`, { email });
  }

  verifyOtp(email: string, otp: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/verify-otp`, { email, otp });
  }

  login(data: { email: string; password: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/login`, data).pipe(
      tap(res => {
        if (res && res.token && res.user) {
          this.userSubject.next(res.user.name || res.user.email);
          localStorage.setItem('user', res.user.name || res.user.email);
          localStorage.setItem('token', res.token);
        }
      })
    );
  }

  logout() {
    this.userSubject.next(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }

  get currentUser() {
    return this.userSubject.value;
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }
}