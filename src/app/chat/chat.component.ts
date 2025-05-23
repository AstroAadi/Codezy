import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebsocketService } from '../services/websocket.service';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollaborationService } from '../services/collaboration.service';
import { AuthService } from '../services/auth.service';

interface ChatMessage {
  text: string;
  sender: string;
  timestamp: Date;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit {
  messages: ChatMessage[] = [];
  newMessage: string = '';
  username: string = '';
  sessionId: string = '';
  hasEditPermission: boolean = false;

  constructor(
    private websocketService: WebsocketService,
    private route: ActivatedRoute,
    private collaborationService: CollaborationService,
    private auth: AuthService
  ) {}

  ngOnInit() {
    this.auth.user$.subscribe(user => {
      if (user) {
        this.username = user;
      }
    });

    this.route.queryParams.subscribe(params => {
      const routeSessionId = params['sessionId'];
      const serviceSessionId = this.collaborationService.getCurrentSessionId();
      this.sessionId = routeSessionId || serviceSessionId;

      if (!this.sessionId) {
        console.error('No session ID available');
        return;
      }

      this.collaborationService.verifySession(this.sessionId).subscribe({
        next: (response) => {
          if (response.isValid) {
            this.hasEditPermission = response.canEdit;
            this.initializeWebSocket();
          } else {
            console.error('Invalid session');
          }
        },
        error: (err) => {
          console.error('Session verification failed:', err);
        }
      });
    });
  }

  isOwnMessage(message: ChatMessage): boolean {
    return message.sender === this.username;
  }

  formatSenderName(message: ChatMessage): string {
    return this.isOwnMessage(message) ? 'You' : message.sender;
  }

  private initializeWebSocket() {
    if (!this.sessionId || !this.username) {
      console.error('Missing session ID or username');
      return;
    }

    this.websocketService.connect(this.username, this.sessionId);

    this.websocketService.message$.subscribe({
      next: (message: ChatMessage) => {
        if (message) {
          this.messages.push(message);
          setTimeout(() => {
            const container = document.querySelector('.chat-messages');
            if (container) {
              container.scrollTop = container.scrollHeight;
            }
          }, 0);
        }
      },
      error: (err) => console.error('Message subscription error:', err)
    });
  }

  sendMessage() {
    if (!this.newMessage.trim() || !this.sessionId || !this.username) {
      return;
    }

    this.websocketService.sendMessage(
      this.username,
      this.newMessage,
      this.sessionId
    );
    this.newMessage = '';
  }
}