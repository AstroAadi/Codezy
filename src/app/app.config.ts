import { ApplicationConfig } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { WebsocketService } from './services/websocket.service';
import { CollaborationService } from './services/collaboration.service';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes'; // Import your routes

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimations(),
    provideRouter(routes),
    WebsocketService,
    CollaborationService
  ]
};