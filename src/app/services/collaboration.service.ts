import { HttpClient } from '@angular/common/http';
import { Injectable, Injector } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { WebsocketService } from './websocket.service';
import { AuthService } from './auth.service';
import { Subject } from 'rxjs';
import { FileNode } from '../project-explorer/project-explorer.component';
import { environment } from '../../environments/environment'; // Import environment

export interface Collaborator {
  email: string;
  canEdit: boolean;
  canRead: boolean;
  isOnline: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CollaborationService {
  private fileAddedSubject = new Subject<FileNode>();
  private fileStructureChangedSubject = new Subject<void>();
  private collaborators = new BehaviorSubject<Collaborator[]>([]);
  private activeCollaborators = new BehaviorSubject<number>(0);
  private currentSessionId: string | null = null;
  private isOwner: boolean = false;
  private injector: Injector;
  private _http: HttpClient | null = null;

  fileAdded$ = this.fileAddedSubject.asObservable();
  fileStructureChanged$ = this.fileStructureChangedSubject.asObservable();

  notifyFileStructureChanged() {
    this.fileStructureChangedSubject.next();
  }
  
  // private injector: Injector;  // Lazy dependency injection
  // private _http: HttpClient | null = null; 

  constructor(injector: Injector, private router: Router, private websocketService: WebsocketService, private authService: AuthService) {
    this.injector = injector;
    // Subscribe to WebSocket collaborator updates
    this.websocketService.collaborators$.subscribe(collaborators => {
      console.log('CollaborationService received collaborators:', collaborators); // <-- Add this
      this.collaborators.next(collaborators);
      this.activeCollaborators.next(collaborators.filter(c => c.isOnline).length);
    });
  }

  // Lazily load HttpClient to avoid circular dependency
  private get http(): HttpClient {
    if (!this._http) {
      this._http = this.injector.get(HttpClient);
    }
    return this._http;
  }

  verifySession(sessionId: string, email?: string): Observable<{ isValid: boolean, canEdit: boolean, email: string }> {
    let url = `${environment.apiUrl}/api/collaboration/verifySession?sessionId=${sessionId}`; // Use environment.apiUrl
    if (email) {
      url += `&email=${email}`;
    }
    return this.http.get<{ isValid: boolean, canEdit: boolean, email: string }>(url);
  }

  getCollaborators(): Observable<Collaborator[]> {
    return this.collaborators.asObservable();
  }

  getActiveCollaborators(): Observable<number> {
    return this.activeCollaborators.asObservable();
  }

  private generateSessionId(): string {
    return 'session_' + Math.random().toString(36).substr(2, 9);
  }

  // private isOwner: boolean = false;

  initializeSession(): string {
    if (!this.currentSessionId) {
      this.currentSessionId = this.generateSessionId();
      this.isOwner = true;
      
      // Navigate to the collaborate route with the session ID
      this.router.navigate(['/collaborate', this.currentSessionId]);
    }
    return this.currentSessionId;
  }

  isSessionOwner(): boolean {
    return this.isOwner;
  }

  addCollaborator(email: string, canEdit: boolean, canRead: boolean): void {
    if (!this.currentSessionId) {
      this.currentSessionId = this.initializeSession();
    }

    const newCollaborator: Collaborator = {
      email,
      canEdit,
      canRead,
      isOnline: false
    };   

    const payload = { 
      email, 
      projectName: 'My Project', 
      permission: canEdit ? 'edit' : 'read',
      sessionId: this.currentSessionId 
    };

    this.http.post(`${environment.apiUrl}/api/collaboration/addCollaborator`, payload, { responseType: 'text' }) // Use environment.apiUrl
      .subscribe({
        next: (response: string) => {
          console.log('Backend response:', response);
          alert(response);
        },
        error: (error) => {
          console.error('Error from backend:', error);
          alert('Failed to send collaboration invitation. Please try again.');
        }
      });

    this.collaborators.next([...this.collaborators.value, newCollaborator]);
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  updateCollaboratorStatus(email: string, isOnline: boolean): void {
    const updatedCollaborators = this.collaborators.value.map(collaborator =>
      collaborator.email === email ? { ...collaborator, isOnline } : collaborator
    );

    this.collaborators.next(updatedCollaborators);
    this.activeCollaborators.next(updatedCollaborators.filter(c => c.isOnline).length);
  }

  removeCollaborator(email: string): void {
    const updatedCollaborators = this.collaborators.value.filter(c => c.email !== email);
    this.collaborators.next(updatedCollaborators);
  }

  joinSession(sessionId: string, email: string) {
    const name = this.authService.currentUser || '';
    const payload = { sessionId, email, name };
    this.currentSessionId = sessionId;
    return this.http.post<{ joined: boolean }>(`${environment.apiUrl}/api/collaboration/joinSession`, payload); // Use environment.apiUrl
  }

  ensureFileExists(filePath: string, content: string) {
    // Split the path into parts
    const parts = filePath.split('/').filter(part => part.length > 0);
    const fileName = parts.pop() || ''; // Last part is the file name
    
    // Create a file node
    const fileNode: FileNode = {
      name: fileName,
      type: 'file',
      path: filePath,
      content
    };

    // If there are path parts, we need to create/ensure folder structure
    if (parts.length > 0) {
      let currentPath = '';
      const folders: FileNode[] = parts.map(part => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        return {
          name: part,
          type: 'folder',
          path: currentPath,
          children: [],
          isExpanded: true
        };
      });

      // Link the folders together
      for (let i = 0; i < folders.length - 1; i++) {
        folders[i].children = [folders[i + 1]];
      }
      
      // Add the file to the last folder
      if (folders.length > 0) {
        folders[folders.length - 1].children = [fileNode];
        // Emit the root folder which contains the entire structure
        this.fileAddedSubject.next(folders[0]);
      }
    } else {
      // Root-level file
      this.fileAddedSubject.next(fileNode);
    }

    this.notifyFileStructureChanged();
  }

  getCurrentUserEmail(): string | null {
    return this.authService.currentUser || null;
  }
}