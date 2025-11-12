import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WebsocketService } from '../services/websocket.service';
import { CollaborationService } from '../services/collaboration.service';

@Component({
  standalone: true,
  selector: 'app-terminal-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './terminal-panel.component.html',
  styleUrls: ['./terminal-panel.component.css']
})
export class TerminalPanelComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input() projectPath: string | undefined;
  @Input() projectFiles: any[] | undefined;
  @ViewChild('terminal', { static: false }) terminalDiv!: ElementRef;
  
  private term!: Terminal;
  private fitAddon!: FitAddon;
  private resizeObserver?: ResizeObserver;
  private terminalCounter = 1;
  private commandBuffer: string = '';

  // Multi-terminal support
  terminals: Array<{
    name: string;
    sessionId: string;
    buffer: string;
    cwd: string;
    subscription: any;
    isReady: boolean;
  }> = [];
  activeTerminalIndex: number = 0;
  connectionReady: boolean = false;
  editingTabIndex: number = -1;
  editingTabName: string = '';

  constructor(
    private websocketService: WebsocketService, 
    private collaborationService: CollaborationService
  ) {}

  ngOnInit() {
    // Will initialize in ngAfterViewInit
  }

  ngAfterViewInit() {
    this.initializeTerminal();
    
    // Ensure WebSocket is connected before creating the first terminal
    this.websocketService.ensureConnected().then(() => {
      this.connectionReady = true;
      this.createNewTerminal();
    }).catch(err => {
      console.error('[Terminal] Failed to connect WebSocket:', err);
      this.term.writeln('\x1b[31m[Error] Failed to connect to backend\x1b[0m');
    });
  }

  private initializeTerminal(): void {
    // Create terminal with proper configuration for PTY
    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
      letterSpacing: 0,
      lineHeight: 1.2,
      theme: { 
        background: '#1e1e1e', 
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true, // Important: Handle EOL properly
      allowProposedApi: true,
      windowsMode: false, // Disable Windows-specific handling
      cols: 80, // Default columns
      rows: 24  // Default rows
    });

    // Initialize FitAddon for proper resizing
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    
    // Load WebLinks addon for clickable links
    const webLinksAddon = new WebLinksAddon();
    this.term.loadAddon(webLinksAddon);
    
    // Open terminal in container
    this.term.open(this.terminalDiv.nativeElement);
    
    // Initial fit
    setTimeout(() => {
      this.fitTerminalToContainer();
    }, 100);
    
    // Setup terminal input handler
    this.setupTerminalHandlers();
    
    // Handle window resize with ResizeObserver
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        this.fitTerminalToContainer();
      });
    });
    this.resizeObserver.observe(this.terminalDiv.nativeElement);

    // Also handle window resize events
    window.addEventListener('resize', this.handleWindowResize);
  }

  private handleWindowResize = () => {
    requestAnimationFrame(() => {
      this.fitTerminalToContainer();
    });
  };

  private fitTerminalToContainer(): void {
    try {
      if (!this.term || !this.fitAddon) return;

      const container = this.terminalDiv?.nativeElement;
      if (!container) return;

      // Use the FitAddon for proper sizing
      this.fitAddon.fit();

      // Notify backend of terminal size change
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.sessionId && active.isReady) {
        const resizeMsg = {
          type: 'terminal',
          resize: true,
          cols: this.term.cols,
          rows: this.term.rows
        };
        this.websocketService.publishToTerminal(active.sessionId, resizeMsg);
        console.log(`[Terminal] Resized to ${this.term.cols}x${this.term.rows}`);
      }
    } catch (e) {
      console.warn('[Terminal] Fit error:', e);
    }
  }

  // private commandBuffer: string = '';

  private setupTerminalHandlers(): void {
    // Handle data input from user
    this.term.onData(data => {
      const active = this.terminals[this.activeTerminalIndex];
      if (!active || !active.isReady) return;

      // Simply send all input to the PTY - it will handle everything
      // The PTY will echo back what should be displayed
      const msg = {
        type: 'terminal',
        command: data
      };
      this.websocketService.publishToTerminal(active.sessionId, msg);
    });

    // Enable text selection and copying
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Allow Ctrl+C for copying (when text is selected)
      if (event.ctrlKey && event.key === 'c' && this.term.hasSelection()) {
        document.execCommand('copy');
        return false;
      }
      
      // Allow Ctrl+V for pasting
      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault();
        navigator.clipboard.readText().then(text => {
          const active = this.terminals[this.activeTerminalIndex];
          if (active && active.isReady) {
            // Send pasted text to PTY
            const msg = {
              type: 'terminal',
              command: text
            };
            this.websocketService.publishToTerminal(active.sessionId, msg);
          }
        });
        return false;
      }
      
      // Allow Ctrl+A for select all
      if (event.ctrlKey && event.key === 'a') {
        this.term.selectAll();
        return false;
      }
      
      return true;
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectPath'] && !changes['projectPath'].firstChange) {
      const active = this.terminals[this.activeTerminalIndex];
      if (active) {
        active.cwd = this.projectPath || '/';
        // Send 'cd' command to change directory in the PTY
        if (active.isReady && this.projectPath) {
          const cdMsg = {
            type: 'terminal',
            command: `cd ${this.projectPath}\n`
          };
          this.websocketService.publishToTerminal(active.sessionId, cdMsg);
        }
      }
      this.term?.write(`\r\n\x1b[32m[Project directory: ${this.projectPath}]\x1b[0m\r\n`);
    }
  }

  ngOnDestroy() {
    // Clean up resize listener
    window.removeEventListener('resize', this.handleWindowResize);
    
    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Dispose addons
    if (this.fitAddon) {
      try {
        this.fitAddon.dispose();
      } catch (e) {
        console.error('[Terminal] Error disposing fitAddon:', e);
      }
    }

    // Dispose terminal
    if (this.term) {
      try {
        this.term.dispose();
      } catch (e) {
        console.error('[Terminal] Error disposing terminal:', e);
      }
    }

    // Unsubscribe all terminal STOMP subscriptions
    try {
      this.terminals.forEach(t => {
        if (t && t.sessionId) {
          this.websocketService.unsubscribeTerminal(t.sessionId);
        }
      });
    } catch (e) {
      console.error('[Terminal] Error closing socket:', e);
    }
  }

  private flattenFilesToMap(nodes: any[], projectRoot?: string): Record<string, string> {
    const map: Record<string, string> = {};
    const walk = (node: any) => {
      if (!node) return;
      if (node.type === 'file') {
        const fullPath = node.path || node.name || 'untitled';
        if (projectRoot) {
          if (fullPath === projectRoot || fullPath.startsWith(projectRoot + '/')) {
            const key = fullPath === projectRoot ? '.' : fullPath.substring(projectRoot.length + 1);
            map[key] = node.content || '';
          }
        } else {
          const key = fullPath;
          map[key] = node.content || '';
        }
      } else if (node.type === 'folder' && Array.isArray(node.children)) {
        (node.children || []).forEach((c: any) => walk(c));
      }
    };
    nodes.forEach(n => walk(n));
    return map;
  }

  // ----------------- Multi-terminal implementation -----------------
  public createNewTerminal(customName?: string) {
    if (!this.connectionReady) {
      console.warn('[Terminal] Connection not ready, waiting...');
      this.term.writeln('\x1b[33mWaiting for backend connection...\x1b[0m');
      setTimeout(() => this.createNewTerminal(customName), 500);
      return;
    }

    const sessionId = `term-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const title = customName || `Terminal ${this.terminalCounter++}`;
    
    const termObj: any = {
      name: title,
      sessionId,
      buffer: '',
      cwd: this.projectPath || '~',
      subscription: null,
      isReady: false
    };

    // Subscribe to STOMP topic for this terminal
    this.websocketService.subscribeTerminal(sessionId, (msg: any) => {
      try {
        const data = JSON.parse(msg.body);
        
        if (data.type === 'terminal-output') {
          const output = data.output || '';
          termObj.buffer += output;
          
          // If this terminal is active, write to screen
          const idx = this.terminals.findIndex(t => t.sessionId === sessionId);
          if (idx === this.activeTerminalIndex && this.term) {
            this.term.write(output);
          }

          // Try to extract CWD from output (basic approach)
          this.extractCwdFromOutput(termObj, output);
          
        } else if (data.type === 'terminal-error') {
          const errorMsg = `\x1b[31m[ERROR] ${data.message}\x1b[0m\r\n`;
          termObj.buffer += errorMsg;
          if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
            this.term.write(errorMsg);
          }
        } else if (data.type === 'terminal-ready') {
          termObj.isReady = true;
          console.log(`[Terminal] Shell ready for session: ${sessionId}`);
        } else if (typeof data === 'string') {
          termObj.buffer += data;
          if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
            this.term.write(data);
          }
        }
      } catch (e) {
        // Not JSON, treat as plain text
        const text = msg.body;
        termObj.buffer += text;
        if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
          this.term.write(text);
        }
      }
    }).then((sub) => {
      console.log('[Terminal] Subscription established for', sessionId);
      termObj.subscription = sub;
      
      // Send initial shell start command
      const startMsg: any = { 
        type: 'terminal', 
        startShell: true,
        cols: this.term.cols,
        rows: this.term.rows
      };
      
      if (this.projectFiles && Array.isArray(this.projectFiles) && this.projectFiles.length > 0) {
        startMsg.projectFiles = this.flattenFilesToMap(this.projectFiles, this.projectPath);
      }
      
      if (this.projectPath) {
        startMsg.projectPath = this.projectPath;
      }
      
      this.websocketService.publishToTerminal(sessionId, startMsg);

      // Mark as ready after a short delay
      setTimeout(() => {
        termObj.isReady = true;
      }, 1000);
      
    }).catch(err => {
      console.error('[Terminal] Failed to subscribe to terminal session:', err);
      if (this.term) {
        this.term.writeln('\x1b[31m[Error] Failed to subscribe to terminal\x1b[0m');
      }
    });

    this.terminals.push(termObj);

    // Activate the newly created terminal
    if (this.terminals.length === 1) {
      this.switchToTerminal(0);
    } else {
      this.switchToTerminal(this.terminals.length - 1);
    }
  }

  private extractCwdFromOutput(termObj: any, output: string): void {
    // Try to extract current directory from common shell prompts
    // This is a basic implementation - adjust based on your shell's prompt format
    
    // Match patterns like "user@host:/path/to/dir$" or "/path/to/dir>"
    const cwdMatch = output.match(/(?:^|\n)(?:[^\s]+@[^\s]+:)?([^\n$>]+)[$>]\s*$/m);
    if (cwdMatch && cwdMatch[1]) {
      const potentialCwd = cwdMatch[1].trim();
      if (potentialCwd.startsWith('/') || potentialCwd.startsWith('~')) {
        termObj.cwd = potentialCwd;
      }
    }
  }

  public switchToTerminal(index: number) {
    if (index < 0 || index >= this.terminals.length) return;
    this.activeTerminalIndex = index;
    const t = this.terminals[index];
    
    try {
      if (!this.term) return;
      
      // Clear terminal and write buffer
      this.term.reset();
      if (t.buffer) {
        this.term.write(t.buffer);
      }
      
      // Re-fit terminal after switching
      setTimeout(() => {
        this.fitTerminalToContainer();
      }, 10);
    } catch (e) {
      console.warn('[Terminal] Error switching terminal:', e);
    }
  }

  public closeTerminal(index: number) {
    if (this.terminals.length <= 1) {
      console.warn('[Terminal] Cannot close the last terminal');
      return;
    }

    const t = this.terminals[index];
    if (!t) return;
    
    // Unsubscribe from WebSocket
    if (t.sessionId) {
      this.websocketService.unsubscribeTerminal(t.sessionId);
    }
    
    this.terminals.splice(index, 1);
    
    // Adjust active index if needed
    if (this.activeTerminalIndex >= this.terminals.length) {
      this.activeTerminalIndex = Math.max(0, this.terminals.length - 1);
    } else if (this.activeTerminalIndex > index) {
      this.activeTerminalIndex--;
    }
    
    // Refresh view
    this.switchToTerminal(this.activeTerminalIndex);
  }

  // Tab renaming functionality
  public startEditingTabName(index: number, event: MouseEvent) {
    event.stopPropagation();
    this.editingTabIndex = index;
    this.editingTabName = this.terminals[index].name;
    
    // Focus the input after Angular renders it
    setTimeout(() => {
      const input = document.querySelector('.tab-name-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  public finishEditingTabName() {
    if (this.editingTabIndex >= 0 && this.editingTabName.trim()) {
      this.terminals[this.editingTabIndex].name = this.editingTabName.trim();
    }
    this.editingTabIndex = -1;
    this.editingTabName = '';
  }

  public cancelEditingTabName() {
    this.editingTabIndex = -1;
    this.editingTabName = '';
  }

  // Clear terminal screen
  public clearTerminal() {
    const active = this.terminals[this.activeTerminalIndex];
    if (active && this.term) {
      this.term.clear();
      this.commandBuffer = '';
      active.buffer = '';
      
      // Send Ctrl+L to the PTY to clear the shell as well
      const msg = {
        type: 'terminal',
        command: '\x0C' // Ctrl+L character
      };
      this.websocketService.publishToTerminal(active.sessionId, msg);
    }
  }

  // Copy/Paste functionality
  public copySelection() {
    if (this.term && this.term.hasSelection()) {
      const selection = this.term.getSelection();
      navigator.clipboard.writeText(selection).then(() => {
        console.log('[Terminal] Text copied to clipboard');
      });
    }
  }

  public pasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.isReady) {
        const msg = {
          type: 'terminal',
          command: text
        };
        this.websocketService.publishToTerminal(active.sessionId, msg);
      }
    });
  }
}