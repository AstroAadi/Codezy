import { Injectable } from '@angular/core';
import { Client, Message } from '@stomp/stompjs';
import { Subject, Observable, BehaviorSubject } from 'rxjs';
import SockJS from 'sockjs-client';
import { Collaborator } from './collaboration.service';
import { environment } from '../../environments/environment'; // Import environment

export interface CodeChange {
  content: string;
  timestamp: Date;
  username: string;
  filePath: string;
  sessionId?: string;
}

export interface ChatMessage {
  sender: string;
  content: string;
  type: string;
  timestamp: Date;
  sessionId: string;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private stompClient: Client | null = null;
  private connectionSubject = new BehaviorSubject<boolean>(false);
  private connectedUsersSubject = new BehaviorSubject<string[]>([]);
  private codeChanges = new BehaviorSubject<CodeChange[]>([]);
  private sessionValid = new BehaviorSubject<boolean>(false);
  private currentSessionId: string = '';
  private collaboratorsSubject = new BehaviorSubject<Collaborator[]>([]);
  public collaborators$ = this.collaboratorsSubject.asObservable();
  public connectedUsers$ = this.connectedUsersSubject.asObservable();

  private client: Client;
  private messageSubject = new Subject<any>();
  public message$ = this.messageSubject.asObservable();

  constructor() {
    this.client = new Client({
      webSocketFactory: () => new SockJS(`${environment.apiUrl}/ws`), // Use environment.apiUrl
      debug: (str) => {
        console.log('[WebSocket Debug]', str);
      }
    });
    console.log('[WebsocketService] Constructor initialized');
  }

  connect(username: string, sessionId: string) {
    console.log(`[WebsocketService] connect called with username: ${username}, sessionId: ${sessionId}`);
    if (this.client.connected) {
      console.log('[WebsocketService] Already connected, skipping connect');
      return;
    }
    this.currentSessionId = sessionId;
    this.client.activate();
    this.client.onConnect = () => {
      console.log('[WebsocketService] Connected to WebSocket server');
      this.connectionSubject.next(true);
      this.client.subscribe(`/topic/chat/${sessionId}`, message => {
        try {
          const chatMessage = JSON.parse(message.body);
          console.log('[WebsocketService] Received chat message:', chatMessage);
          this.messageSubject.next(chatMessage);
        } catch (e) {
          console.error('[WebsocketService] Error parsing chat message:', e);
        }
      });
      this.client.subscribe(`/topic/code/${sessionId}`, message => {
        try {
          const codeChange = JSON.parse(message.body);
          console.log('[WebsocketService] Received code change:', codeChange);
          const currentChanges = this.codeChanges.value;
          this.codeChanges.next([...currentChanges, codeChange]);
        } catch (e) {
          console.error('[WebsocketService] Error parsing code change:', e);
        }
      });
      this.client.subscribe(`/topic/collaborators/${sessionId}`, message => {
        try {
          const data = JSON.parse(message.body);
          const collaborators = data.collaborators || data;
          const joinedUser = data.joinedUser;
          console.log('[WebsocketService] Received collaborators update:', collaborators);
          this.collaboratorsSubject.next(collaborators);
          if (joinedUser) {
            console.log(`[WebsocketService] ${joinedUser} has joined this session!`);
            alert(`${joinedUser} has joined this session!`);
          }
        } catch (e) {
          console.error('[WebsocketService] Error parsing collaborators:', e);
        }
      });
    };
    this.client.onStompError = (frame) => {
      console.error('[WebsocketService] STOMP error:', frame);
    };
  }

  sendMessage(sender: string, text: string, sessionId: string) {
    console.log(`[WebsocketService] sendMessage called with sender: ${sender}, sessionId: ${sessionId}, text: ${text}`);
    if (!this.client.connected) {
      console.error('[WebsocketService] WebSocket not connected');
      return;
    }
    const message = {
      sender,
      text,
      timestamp: new Date()
    };
    this.client.publish({
      destination: `/app/chat/${sessionId}`,
      body: JSON.stringify(message)
    });
    console.log('[WebsocketService] Message published:', message);
  }

  isConnected(): boolean {
    const connected = this.client && this.client.connected;
    console.log('[WebsocketService] isConnected:', connected);
    return connected;
  }

  sendCodeChange(content: string, username: string, filePath: string) {
    console.log(`[WebsocketService] sendCodeChange called with username: ${username}, filePath: ${filePath}`);
    if (!this.client.connected) {
      console.error('[WebsocketService] WebSocket not connected');
      return;
    }
    const change: CodeChange = {
      content,
      timestamp: new Date(),
      username,
      filePath
    };
    const currentChanges = this.codeChanges.value;
    this.codeChanges.next([...currentChanges, change]);
    this.client.publish({
      destination: `/app/code/${this.currentSessionId}`,
      body: JSON.stringify(change)
    });
    console.log('[WebsocketService] Code change published:', change);
  }

  disconnect() {
    console.log('[WebsocketService] disconnect called');
    if (this.stompClient) {
      this.stompClient.deactivate();
    }
    this.connectionSubject.next(false);
    this.messageSubject.next(null);
    this.connectedUsersSubject.next([]);
  }
  public codeChanges$ = this.codeChanges.asObservable();
  getCodeChanges(): Observable<CodeChange[]> {
    console.log('[WebsocketService] getCodeChanges called');
    return this.codeChanges.asObservable();
  }

  isSessionValid(): Observable<boolean> {
    console.log('[WebsocketService] isSessionValid called');
    return this.sessionValid.asObservable();
  }

  public getConnectionStatus(): Observable<boolean> {
    return this.connectionSubject.asObservable();
  }

  // In websocket.service.ts
broadcastStartCall(sessionId: string) {
  if (!this.client.connected) {
    console.error('[WebsocketService] WebSocket not connected');
    return;
  }
  this.client.publish({
    destination: `/app/startCall/${sessionId}`,
    body: JSON.stringify({ sessionId })
  });
}

onStartCall(): Observable<void> {
  return new Observable(observer => {
    this.client.subscribe(`/topic/startCall/${this.currentSessionId}`, () => {
      observer.next();
    });
  });
}
}
