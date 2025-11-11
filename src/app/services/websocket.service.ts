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
  private terminalSubscriptions: Map<string, any> = new Map();
  private pendingTerminalOps: Array<() => void> = [];
  private isConnecting = false;

  constructor() {
    this.client = new Client({
      webSocketFactory: () => new SockJS(`${environment.apiUrl}/ws`), // Use environment.apiUrl
      debug: (str) => {
        console.log('[WebSocket Debug]', str);
      }
    });
    console.log('[WebsocketService] Constructor initialized');
  }

  /**
   * Ensure STOMP client is activated. Call this before any terminal operations.
   */
  ensureConnected(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client && this.client.connected) {
        console.log('[WebsocketService] Already connected');
        resolve();
        return;
      }
      if (this.isConnecting) {
        // Already trying to connect, queue this operation
        this.pendingTerminalOps.push(() => resolve());
        return;
      }
      this.isConnecting = true;
      console.log('[WebsocketService] Activating STOMP client...');
      this.client.activate();
      this.client.onConnect = () => {
        console.log('[WebsocketService] STOMP connected via ensureConnected');
        this.connectionSubject.next(true);
        this.isConnecting = false;
        // Resolve all pending operations
        this.pendingTerminalOps.forEach(op => op());
        this.pendingTerminalOps = [];
        resolve();
      };
      this.client.onStompError = (frame) => {
        console.error('[WebsocketService] STOMP error during ensureConnected:', frame);
        this.isConnecting = false;
        resolve(); // Resolve anyway; operations will fail gracefully
      };
    });
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

  /**
   * Subscribe to a terminal topic for a specific terminal sessionId.
   * Returns a Promise that resolves with the subscription object.
   */
  subscribeTerminal(sessionId: string, callback: (msg: Message) => void): Promise<any> {
    return this.ensureConnected().then(() => {
      if (!this.client) {
        console.error('[WebsocketService] Client not available after connect');
        return null;
      }
      if (!this.client.connected) {
        console.error('[WebsocketService] STOMP not connected yet for terminal subscribe');
        return null;
      }
      try {
        const sub = this.client.subscribe(`/topic/terminal/${sessionId}`, (message) => {
          try {
            callback(message);
          } catch (e) {
            console.error('[WebsocketService] Terminal callback error', e);
          }
        });
        this.terminalSubscriptions.set(sessionId, sub);
        console.log('[WebsocketService] Subscribed to /topic/terminal/' + sessionId);
        return sub;
      } catch (e) {
        console.error('[WebsocketService] Failed to subscribe to terminal topic', e);
        return null;
      }
    });
  }

  unsubscribeTerminal(sessionId: string) {
    const sub = this.terminalSubscriptions.get(sessionId);
    if (sub && sub.unsubscribe) {
      try {
        sub.unsubscribe();
      } catch (e) {
        console.warn('[WebsocketService] Error unsubscribing terminal', e);
      }
    }
    this.terminalSubscriptions.delete(sessionId);
  }

  publishToTerminal(sessionId: string, payload: any) {
    if (!this.client || !this.client.connected) {
      console.error('[WebsocketService] STOMP client not connected - attempting to ensure connection first');
      this.ensureConnected().then(() => {
        if (this.client && this.client.connected) {
          try {
            this.client.publish({ destination: `/app/terminal/${sessionId}`, body: JSON.stringify(payload) });
            console.log('[WebsocketService] Published to /app/terminal/' + sessionId, payload);
          } catch (e) {
            console.error('[WebsocketService] Failed to publish terminal message', e);
          }
        }
      });
      return;
    }
    try {
      this.client.publish({ destination: `/app/terminal/${sessionId}`, body: JSON.stringify(payload) });
      console.log('[WebsocketService] Published to /app/terminal/' + sessionId, payload);
    } catch (e) {
      console.error('[WebsocketService] Failed to publish terminal message', e);
    }
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
  const signalSocket = new WebSocket(`ws://localhost:8081/signal/${sessionId}`);
  
  signalSocket.onopen = () => {
    console.log('[WebsocketService] Signal WebSocket connected');
    this.client.publish({
      destination: `wss://codezy-backend-185224543792.asia-south2.run.app/signal/${sessionId}`,
      body: JSON.stringify({ sessionId })
    });
  };

  signalSocket.onmessage = (event) => {
    const signal = JSON.parse(event.data);
    console.log('[WebsocketService] Received signal:', signal);
    // Handle incoming WebRTC signaling messages
  };

  signalSocket.onerror = (error) => {
    console.error('[WebsocketService] Signal WebSocket error:', error);
  };
}

onStartCall(): Observable<void> {
  return new Observable(observer => {
    this.client.subscribe(`wss://codezy-backend-185224543792.asia-south2.run.app/signal/${this.currentSessionId}`, () => {
      observer.next();
    });
  });
}
}
