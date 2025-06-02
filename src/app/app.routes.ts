import { Routes } from '@angular/router';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { AuthGuard } from './auth.guard';
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