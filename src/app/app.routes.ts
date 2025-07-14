import { Routes } from '@angular/router';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { AuthGuard } from './auth.guard';
import { HomeComponent } from './home/home.component'; // Import HomeComponent

export const routes: Routes = [
  { path: '', component: HomeComponent }, // Set HomeComponent as the default route
  { path: 'editor', component: CodeEditorComponent }, // Add a route for the editor
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