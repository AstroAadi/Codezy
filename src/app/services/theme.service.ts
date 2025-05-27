import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private darkMode = new BehaviorSubject<boolean>(false);
  darkMode$ = this.darkMode.asObservable();

  constructor() {}

  initializeTheme(): void {
    this.setDarkMode(false)
  }

  toggleTheme(): void {
    this.setDarkMode(!this.darkMode.value);
  }

  
  setDarkMode(isDark: boolean) {
    this.darkMode.next(isDark);
    if (isDark) {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    }
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  }
}