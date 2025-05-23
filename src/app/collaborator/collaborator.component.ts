import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollaborationService, Collaborator } from '../services/collaboration.service';
import { ActivatedRoute } from '@angular/router';
import { WebsocketService } from '../services/websocket.service';

@Component({
  selector: 'app-collaborator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="collaborator-container">
      <ng-container *ngIf="mode === 'create'">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h3 class="panel-title mb-0">Add Collaborator</h3>
          <button class="btn btn-outline-danger btn-sm" (click)="endSession()">End Session</button>
        </div>
        <div class="form-group mb-3">
          <label for="email" class="form-label">Email address</label>
          <input type="email" class="form-control" id="email" [(ngModel)]="newCollaborator.email" placeholder="Enter collaborator's email">
        </div>
        <div class="form-check mb-2">
          <input type="checkbox" class="form-check-input" id="canRead" [(ngModel)]="newCollaborator.canRead">
          <label class="form-check-label" for="canRead">Can read files</label>
        </div>
        <div class="form-check mb-3">
          <input type="checkbox" class="form-check-input" id="canEdit" [(ngModel)]="newCollaborator.canEdit">
          <label class="form-check-label" for="canEdit">Can edit files</label>
        </div>
        <button class="btn btn-primary" (click)="addCollaborator()">Add Collaborator</button>
        <div class="collaborators-list mt-4">
          <h4 class="mb-3">Current Collaborators</h4>
          <div class="collaborator-item" *ngFor="let collaborator of collaborators$ | async" (click)="selectCollaborator(collaborator)">
            <div class="collaborator-info">
              <div class="collaborator-email">{{ collaborator.email }}</div>
              <div class="collaborator-status" [class.online]="collaborator.isOnline">
                {{ collaborator.isOnline ? 'Online' : 'Offline' }}
              </div>
            </div>
            <div class="collaborator-permissions">
              <span class="badge bg-info me-1" *ngIf="collaborator.canRead">Read</span>
              <span class="badge bg-warning" *ngIf="collaborator.canEdit">Edit</span>
            </div>
            <div *ngIf="selectedCollaborator === collaborator" class="collaborator-actions">
              <button class="btn btn-sm btn-outline-info me-1" (click)="setPermission(collaborator, 'read'); $event.stopPropagation();">Allow Read</button>
              <button class="btn btn-sm btn-outline-warning me-1" (click)="setPermission(collaborator, 'edit'); $event.stopPropagation();">Allow Edit</button>
              <button class="btn btn-sm btn-outline-danger" (click)="removeCollaborator(collaborator); $event.stopPropagation();">Remove</button>
            </div>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="mode === 'join'">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h3 class="panel-title mb-0">Join Session</h3>
          <button class="btn btn-outline-danger btn-sm" (click)="endSession()">End Session</button>
        </div>
        <h3 class="panel-title">Join Session</h3>
        <div class="form-group mb-3">
          <label for="sessionLink" class="form-label">Session Link</label>
          <input type="text" class="form-control" id="sessionLink" [(ngModel)]="joinSessionLink" placeholder="Paste session link here">
        </div>
        <div class="form-group mb-3">
          <label for="joinEmail" class="form-label">Your Email</label>
          <input type="email" class="form-control" id="joinEmail" [(ngModel)]="joinEmail" placeholder="Enter your email">
        </div>
        <button class="btn btn-primary" (click)="joinSession()">Join Session</button>
      </ng-container>
    </div>
  `,
  styles: [`
    .collaborator-container {
      padding: 16px;
      color: #afb1b3;
    }

    .panel-title {
      font-size: 18px;
      margin-bottom: 20px;
      color: #fff;
    }

    .form-control {
      background-color: #3c3f41;
      border-color: #4c5052;
      color: #afb1b3;
    }

    .form-control:focus {
      background-color: #3c3f41;
      border-color: #6c757d;
      color: #fff;
    }

    .form-check-input {
      background-color: #3c3f41;
      border-color: #4c5052;
    }

    .form-check-label {
      color: #afb1b3;
    }

    .collaborator-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid #3c3f41;
    }

    .collaborator-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .collaborator-email {
      color: #afb1b3;
    }

    .collaborator-status {
      font-size: 12px;
      color: #666;
    }

    .collaborator-status.online {
      color: #28a745;
    }
    .session-select-box { text-align: center; margin-bottom: 32px; }
    .form-select { min-width: 220px; font-size: 16px; display: inline-block; }
    .collaborator-item.selected { background: #23272b; border-radius: 4px; }
  `]
})
export class CollaboratorComponent {
  @Input() mode: 'create' | 'join' | null = null;  selectedOption: string = '';
  joinSessionLink = '';
  newCollaborator: Partial<Collaborator> = { email: '', canEdit: false, canRead: true };
  canEdit = true;
  canAddCollaborator = true;
  collaborators$ = this.collaborationService.getCollaborators();
  selectedCollaborator: Collaborator | null = null;
  sessionId: string | null = null;
  joinEmail: string = '';

  constructor(private collaborationService: CollaborationService, private route: ActivatedRoute, private websocketService: WebsocketService) {}

  setMode(mode: 'create' | 'join') { this.mode = mode; if (mode === 'create') this.initCreate(); }

  initCreate() {
    const routeSessionId = this.route.snapshot.paramMap.get('sessionId');
    if (routeSessionId) {
      this.sessionId = routeSessionId;
      this.verifyCollaborator();
    } else {
      this.sessionId = this.collaborationService.initializeSession();
      this.canEdit = true;
      this.setupWebSocketSubscriptions();
    }
  }

  joinSession() {
    if (!this.joinSessionLink || !this.joinEmail) {
      alert('Please enter a session ID or link and your email.');
      return;
    }
    // Extract sessionId from link or use as is
    let sessionId = this.joinSessionLink;
    const match = this.joinSessionLink.match(/[?&]sessionId=([^&]+)/);
    if (match) sessionId = match[1];

    // Call backend to join session with sessionId and email
    this.collaborationService.joinSession(sessionId, this.joinEmail).subscribe({
      next: (response: any) => {
        if (response.joined) {
          this.sessionId = sessionId;
          this.setupWebSocketSubscriptions();
         // this.router.navigate(['/chat'], { queryParams: { sessionId: this.sessionId } }); // Add this line
          alert('Successfully joined the session!');
        } else {
          alert('Invalid session ID or email.');
        }
      },
      error: () => {
        alert('Failed to join session.');
      }
    });
  }

  private verifyCollaborator(): void {
    if (this.sessionId) {
      this.collaborationService.verifySession(this.sessionId).subscribe({
        next: (response) => {
          if (response.isValid) {
            this.canEdit = response.canEdit;
            this.setupWebSocketSubscriptions();
          } else {
            alert('Invalid session');
            this.disableAddCollaboratorFeature();
          }
        },
        error: (err) => {
          console.error('Failed to verify session:', err);
          this.disableAddCollaboratorFeature();
        }
      });
    }
  }

  private setupWebSocketSubscriptions(): void {
    this.collaborators$ = this.collaborationService.getCollaborators();
    if (this.sessionId) {
      this.websocketService.connect(this.joinEmail || 'Anonymous', this.sessionId);
    }
  }

  addCollaborator() {
    if (!this.sessionId) {
      this.sessionId = this.collaborationService.initializeSession();
    }
    if (this.newCollaborator.email) {
      this.collaborationService.addCollaborator(
        this.newCollaborator.email,
        this.newCollaborator.canEdit || false,
        this.newCollaborator.canRead || true
      );
      this.newCollaborator = { email: '', canEdit: false, canRead: true };
    } else {
      alert('No active session or invalid email');
    }
  }

  selectCollaborator(collaborator: Collaborator) {
    this.selectedCollaborator = this.selectedCollaborator === collaborator ? null : collaborator;
  }

  setPermission(collaborator: Collaborator, permission: 'read' | 'edit') {
    // Implement permission update logic here
    collaborator.canEdit = permission === 'edit';
    collaborator.canRead = true;
    // Optionally update backend/service
  }

  removeCollaborator(collaborator: Collaborator) {
    this.collaborationService.removeCollaborator(collaborator.email);
    if (this.selectedCollaborator === collaborator) this.selectedCollaborator = null;
  }

  disableAddCollaboratorFeature(): void {
    this.canAddCollaborator = false;
  }

  onSessionTypeChange() {
    if (this.selectedOption === 'create') {
      this.setMode('create');
    } else if (this.selectedOption === 'join') {
      this.setMode('join');
    }
  }

  endSession() {
    this.mode = null;
    this.selectedOption = '';
    this.sessionId = null;
    this.selectedCollaborator = null;
    /* reset any other state as needed */
  }
}