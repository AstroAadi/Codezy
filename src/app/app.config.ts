import { ApplicationConfig } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { WebsocketService } from './services/websocket.service';
import { CollaborationService } from './services/collaboration.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimations(),
    WebsocketService,
    CollaborationService
  ]
};