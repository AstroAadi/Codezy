import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean | UrlTree {
    const isLoggedIn = !!localStorage.getItem('token');
    if (!isLoggedIn) {
      alert('Login first to access special features');
      return this.router.parseUrl('/login');
    }
    return true;
  }
}