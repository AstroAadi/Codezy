import { Routes } from '@angular/router';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { ChatComponent } from './chat/chat.component';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { AuthGuard } from './auth.guard';
import { VideoComponent } from './video/video.component';
import { CollaboratorComponent } from './collaborator/collaborator.component';

export const routes: Routes = [
  // ... other routes ...
  { path: '', component: CodeEditorComponent },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent }, 

  {
    path: 'collaborate',
    canActivate: [AuthGuard], // <-- Protect collaborate and its children
    children: [
      {
        path: '',
        component: CodeEditorComponent
      },
    ]
  },
  {
    path: 'collaborate/:sessionId',
    component: CodeEditorComponent,
    canActivate: [AuthGuard] // <-- Protect session-specific collaborate
  },
  // ... other routes ...
];