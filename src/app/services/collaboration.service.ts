import { HttpClient } from '@angular/common/http';
import { Injectable, Injector } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { WebsocketService } from './websocket.service';
import { AuthService } from './auth.service';
import { Subject } from 'rxjs';
import { FileNode } from '../project-explorer/project-explorer.component';
import { environment } from '../../environments/environment';

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
  private fileRemovedSubject = new Subject<string>();
  private collaborators = new BehaviorSubject<Collaborator[]>([]);
  private activeCollaborators = new BehaviorSubject<number>(0);
  private currentSessionId: string | null = null;
  private isOwner: boolean = false;
  private injector: Injector;
  private _http: HttpClient | null = null;
  
  // Track recently added files to prevent rapid duplicates
  private recentlyAddedPaths = new Set<string>();

  fileAdded$ = this.fileAddedSubject.asObservable();
  fileStructureChanged$ = this.fileStructureChangedSubject.asObservable();
  fileRemoved$ = this.fileRemovedSubject.asObservable();

  notifyFileStructureChanged() {
    this.fileStructureChangedSubject.next();
  }

  removePath(path: string) {
    // Emit removal event so other components (AppComponent / ProjectExplorer) can update their structures
    this.fileRemovedSubject.next(path);
    this.notifyFileStructureChanged();
  }

  constructor(injector: Injector, private router: Router, private websocketService: WebsocketService, private authService: AuthService) {
    this.injector = injector;
    // Subscribe to WebSocket collaborator updates
    this.websocketService.collaborators$.subscribe(collaborators => {
      console.log('CollaborationService received collaborators:', collaborators);
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
    let url = `${environment.apiUrl}/api/collaboration/verifySession?sessionId=${sessionId}`;
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

    this.http.post(`${environment.apiUrl}/api/collaboration/addCollaborator`, payload, { responseType: 'text' })
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
    return this.http.post<{ joined: boolean }>(`${environment.apiUrl}/api/collaboration/joinSession`, payload);
  }

  ensureFileExists(filePath: string, content: string) {
    // Prevent duplicate additions within a short time window
    if (this.recentlyAddedPaths.has(filePath)) {
      console.log('[CollaborationService] Skipping duplicate file addition:', filePath);
      return;
    }

    // Check if file already exists in localStorage
    const existingContent = localStorage.getItem(filePath);
    if (existingContent !== null) {
      console.log('[CollaborationService] File already exists in localStorage:', filePath);
      return;
    }

    // Mark as recently added
    this.recentlyAddedPaths.add(filePath);
    setTimeout(() => {
      this.recentlyAddedPaths.delete(filePath);
    }, 5000); // Clear after 5 seconds

    // Split the path into parts
    const parts = filePath.split('/').filter(part => part.length > 0);
    const fileName = parts.pop() || '';
    
    // Create a file node
    const fileNode: FileNode = {
      name: fileName,
      type: 'file',
      path: filePath,
      content
    };

    // Save to localStorage
    localStorage.setItem(filePath, content);

    // Emit the file node
    this.fileAddedSubject.next(fileNode);
    this.notifyFileStructureChanged();
    
    console.log('[CollaborationService] Added new file:', filePath);
  }

  // Ensure folder exists in project explorer
  ensureFolderExists(folderPath: string) {
    // Prevent duplicate additions within a short time window
    if (this.recentlyAddedPaths.has(folderPath)) {
      console.log('[CollaborationService] Skipping duplicate folder addition:', folderPath);
      return;
    }

    // Mark as recently added
    this.recentlyAddedPaths.add(folderPath);
    setTimeout(() => {
      this.recentlyAddedPaths.delete(folderPath);
    }, 5000); // Clear after 5 seconds

    // Split the path into parts
    const parts = folderPath.split('/').filter(part => part.length > 0);
    const folderName = parts.pop() || '';
    
    // Create a folder node
    const folderNode: FileNode = {
      name: folderName,
      type: 'folder',
      path: folderPath,
      children: [],
      isExpanded: false
    };

    // Emit the folder node
    this.fileAddedSubject.next(folderNode);
    this.notifyFileStructureChanged();
    
    console.log('[CollaborationService] Added new folder:', folderPath);
  }

  getCurrentUserEmail(): string | null {
    return this.authService.currentUser || null;
  }
}