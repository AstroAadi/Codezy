import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment'; // Import environment

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<string | null>(null);
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      this.userSubject.next(savedUser);
    }
  }

  register(data: { name: string; email: string; password: string; otp: string }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/api/auth/register?otp=${encodeURIComponent(data.otp)}`, data).pipe( // Use environment.apiUrl
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
    return this.http.post<any>(`${environment.apiUrl}/api/auth/send-otp`, { email }); // Use environment.apiUrl
  }

  verifyOtp(email: string, otp: string): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/api/auth/verify-otp`, { email, otp }); // Use environment.apiUrl
  }

  login(data: { email: string; password: string }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/api/auth/login`, data).pipe( // Use environment.apiUrl
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