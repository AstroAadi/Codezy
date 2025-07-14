(window as any).global = window;

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { importProvidersFrom } from '@angular/core';
import { CodemirrorModule } from '@ctrl/ngx-codemirror';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { jwtInterceptor } from './app/services/jwt.interceptor';

const config = {
  ...appConfig,
  providers: [
    ...appConfig.providers,
    importProvidersFrom(CodemirrorModule),
    importProvidersFrom(FormsModule),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    // provideRouter(routes) // Remove this line
  ]
};

bootstrapApplication(AppComponent, config)
  .catch(err => console.error(err));{
  }