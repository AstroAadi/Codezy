import { Component, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatComponent } from '../chat/chat.component';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Input } from '@angular/core';
import { CollaboratorComponent } from '../collaborator/collaborator.component';
import { VideoCallComponent } from '../video/video-call.component';

interface PanelState {
  isOpen: boolean;
  width: number;
}

type PanelType = 'collaborator' | 'chat' | 'video';

@Component({
    selector: 'app-right-panel',
    imports: [CommonModule, ChatComponent, CollaboratorComponent, RouterModule, VideoCallComponent],
    templateUrl: './right-panel.component.html',
    styleUrls: ['./right-panel.component.css']
})
export class RightPanelComponent {
  collaboratorMode: 'create' | 'join' | null = null;
  collaborationItems: Array<{ id: PanelType; icon: string; title: string; options?: string[] }> = [
    { id: 'collaborator', icon: 'person-plus', title: 'Add Collaborator', options: ['Create Session', 'Join Session'] },
    { id: 'chat', icon: 'chat-dots', title: 'Chat' },
    { id: 'video', icon: 'camera-video', title: 'Video Call' }
  ];
  panels: Record<PanelType, PanelState> = {
    collaborator: { isOpen: false, width: 300 },
    chat: { isOpen: false, width: 300 },
    video: { isOpen: false, width: 300 }
  };

  activePanel: PanelType | null = null;
  private isDragging = false;
  private startX = 0;
  private startWidth = 0;

  @HostBinding('class.is-dragging')
  get isDraggingClass(): boolean {
    return this.isDragging;
  }

  constructor(private router: Router, private auth: AuthService) {}

  onPanelClick(panelId: PanelType): void {
    // Check authentication before toggling
    if (!this.auth.isLoggedIn()) { // Adjust this check to your AuthService
      alert('Login first to access special features!!!');
      this.router.navigate(['/login']);
      return;
    }
    this.togglePanel(panelId);
    // Optionally update query param for panel state
    this.router.navigate([], {
      queryParams: { panel: panelId },
      queryParamsHandling: 'merge'
    });
  }
  
  togglePanel(panelId: PanelType): void {
    console.log(`togglePanel called for: ${panelId}`);
    if (this.activePanel === panelId) {
      this.panels[panelId].isOpen = false;
      this.activePanel = null;
      console.log(`Panel ${panelId} closed. activePanel: ${this.activePanel}`);
    } else {
      Object.keys(this.panels).forEach(key => {
        this.panels[key as PanelType].isOpen = false;
      });
      
      this.panels[panelId].isOpen = true;
      this.activePanel = panelId;
      console.log(`Panel ${panelId} opened. activePanel: ${this.activePanel}`);
    }
  }

  startResize(event: MouseEvent): void {
    if (this.activePanel) {
      event.preventDefault();
      this.isDragging = true;
      this.startX = event.clientX;
      this.startWidth = this.panels[this.activePanel].width;
      
      document.addEventListener('mousemove', this.resize);
      document.addEventListener('mouseup', this.stopResize);
    }
  }

  private resize = (event: MouseEvent): void => {
    if (this.isDragging && this.activePanel) {
      const diff = event.clientX - this.startX;
      const newWidth = Math.max(200, Math.min(window.innerWidth - 200, this.startWidth - diff));
      this.panels[this.activePanel].width = newWidth;
    }
  }

  private stopResize = (): void => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.resize);
    document.removeEventListener('mouseup', this.stopResize);
  }

  activeDropdown: string | null = null;

  onCollabDropdownClick(event: MouseEvent) {
    event.stopPropagation();
    this.activeDropdown = this.activeDropdown === 'collaborator' ? null : 'collaborator';
  }

  handleCollabOption(option: string) {
    console.log(`handleCollabOption called with: ${option}`);
    if (!this.auth.isLoggedIn()) {
      alert('Login first to access special features!!!');
      this.router.navigate(['/login']);
      return;
    }

    if (option === 'Create Session') {
      this.collaboratorMode = 'create';
      console.log('collaboratorMode set to: create');
      this.togglePanel('collaborator');
    } else if (option === 'Join Session') {
      this.collaboratorMode = 'join';
      console.log('collaboratorMode set to: join');
      this.togglePanel('collaborator');
    }
    this.activeDropdown = null;
    console.log('activeDropdown set to null.');
  }

  // Close dropdown on outside click
  ngOnInit() {
    document.addEventListener('click', this.closeDropdown);
  }
  ngOnDestroy() {
    document.removeEventListener('click', this.closeDropdown);
  }
  closeDropdown = () => {
    this.activeDropdown = null;
  };
}
