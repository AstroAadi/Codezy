import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const isLoggedIn = !!localStorage.getItem('token');
    if (!isLoggedIn) {
      alert('Login first to access special features');
      return this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    }
    return true;
  }
}