import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WebsocketService } from '../services/websocket.service';
import { CollaborationService } from '../services/collaboration.service';

// NOTE: You need to install xterm addons:
// npm install xterm-addon-fit xterm-addon-web-links
// 
// Also add to angular.json styles array:
// "node_modules/xterm/css/xterm.css"

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
  private currentCommand: string = '';
  private subscriptions: any[] = [];
  private isConnected = false;
  private defaultDirectory: string = '/';
  private resizeObserver?: ResizeObserver;

  // Multi-terminal support
  terminals: Array<any> = [];
  activeTerminalIndex: number = 0;
  promptCommand: string = '';
  connectionReady: boolean = false;

  constructor(private websocketService: WebsocketService, private collaborationService: CollaborationService) {}

  ngOnInit() {
    // Remove session ID logic
  }

  ngAfterViewInit() {
    this.initializeTerminal();
    // Ensure WebSocket is connected before creating the first terminal
    this.websocketService.ensureConnected().then(() => {
      this.connectionReady = true;
      this.createNewTerminal('Terminal 1');
    }).catch(err => {
      console.error('[Terminal] Failed to connect WebSocket:', err);
      this.term.writeln('\x1b[31m[Error] Failed to connect to backend\x1b[0m');
    });
  }

  private initializeTerminal(): void {
    // Create terminal with proper configuration
    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
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
      convertEol: true,
      allowProposedApi: true
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
    
    // Setup global handlers that route input to active terminal session
    this.setupGlobalTerminalHandlers();
    
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

      // Notify backend of terminal size change if needed
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.sessionId) {
        const resizeMsg = {
          type: 'terminal-resize',
          cols: this.term.cols,
          rows: this.term.rows
        };
        this.websocketService.publishToTerminal(active.sessionId, resizeMsg);
      }
    } catch (e) {
      console.warn('[Terminal] Fit error:', e);
    }
  }

  // Setup generic key/data handlers bound to the active terminal session
  private setupGlobalTerminalHandlers(): void {
    // Handle data input from user
    this.term.onData(data => {
      const active = this.terminals[this.activeTerminalIndex];
      if (!active) return;

      // Always forward keystrokes to backend PTY
      const msg = {
        type: 'terminal-input',
        input: data
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
        navigator.clipboard.readText().then(text => {
          this.term.paste(text);
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

  // Handle input locally for prompt mode
  private handleLocalInput(data: string): void {
    const code = data.charCodeAt(0);
    
    // Enter key
    if (code === 13) {
      this.term.write('\r\n');
      const command = this.currentCommand.trim();
      if (command) {
        const active = this.terminals[this.activeTerminalIndex];
        if (active) {
          this.publishCommandToSession(active.sessionId, command);
        }
      }
      this.currentCommand = '';
      // Show prompt again after command
      setTimeout(() => {
        const active = this.terminals[this.activeTerminalIndex];
        if (active && active.mode === 'prompt') {
          this.term.write(`\x1b[32m${active.cwd} $\x1b[0m `);
        }
      }, 100);
      return;
    }
    
    // Backspace/Delete
    if (code === 127 || code === 8) {
      if (this.currentCommand.length > 0) {
        this.currentCommand = this.currentCommand.slice(0, -1);
        this.term.write('\b \b');
      }
      return;
    }
    
    // Ctrl+C
    if (code === 3) {
      this.term.write('^C\r\n');
      this.currentCommand = '';
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.mode === 'prompt') {
        this.term.write(`\x1b[32m${active.cwd} $\x1b[0m `);
      }
      return;
    }
    
    // Ctrl+L (clear screen)
    if (code === 12) {
      this.term.clear();
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.mode === 'prompt') {
        this.term.write(`\x1b[32m${active.cwd} $\x1b[0m `);
      }
      return;
    }
    
    // Printable characters
    if (code >= 32 && code < 127) {
      this.currentCommand += data;
      this.term.write(data);
    }
  }

  private sendCommand(command: string): void {
    const active = this.terminals[this.activeTerminalIndex];
    if (active) {
      this.publishCommandToSession(active.sessionId, command);
    }
  }

  private publishCommandToSession(sessionId: string, command: string) {
    const trimmed = command.trim();

    // Handle create/remove file/folder commands locally so Project Explorer updates immediately
    try {
      const active = this.terminals[this.activeTerminalIndex];
      const cwd = (active && active.cwd) ? active.cwd : this.defaultDirectory;

      // Helper to resolve a path relative to cwd
      const resolvePath = (p: string) => {
        if (!p) return cwd;
        if (p.startsWith('/')) return p.replace(/\\/g, '/');
        // join cwd and p
        const base = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
        return `${base}/${p}`.replace(/\\/g, '/');
      };

      // mkdir (support -p)
      if (/^mkdir(\s+-p)?\s+/.test(trimmed)) {
        const parts = trimmed.split(/\s+/).slice(1);
        for (const part of parts) {
          const path = resolvePath(part);
          // Create a placeholder file inside folder so folder shows up in explorer
          const placeholder = path.endsWith('/') ? `${path}.keep` : `${path}/.keep`;
          this.collaborationService.ensureFileExists(placeholder, '');
        }
      }

      // touch -> create file
      if (/^touch\s+/.test(trimmed)) {
        const parts = trimmed.split(/\s+/).slice(1);
        for (const p of parts) {
          const path = resolvePath(p);
          this.collaborationService.ensureFileExists(path, '');
        }
      }

      // rmdir or rm -r or rm -rf -> remove path
      if (/^(rmdir|rm)\b/.test(trimmed)) {
        // Extract arguments after command flags
        const tokens = trimmed.split(/\s+/).slice(1);
  // remove flags like -r, -f, -rf, -fr
  const targets = tokens.filter(t => !/^-/.test(t));
        for (const t of targets) {
          const path = resolvePath(t);
          this.collaborationService.removePath(path);
        }
      }
    } catch (e) {
      console.warn('[Terminal] local file op failed:', e);
    }

    // Always forward the command to the backend so it actually executes
    let outgoing = command;
    if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
      outgoing = `${command} && echo __CWD__:$PWD`;
    }
    const msg = { type: 'terminal', command: outgoing };
    this.websocketService.publishToTerminal(sessionId, msg);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectPath'] && !changes['projectPath'].firstChange) {
      const active = this.terminals[this.activeTerminalIndex];
      if (active) {
        active.cwd = this.projectPath || this.defaultDirectory;
      }
      this.term?.writeln(`\n\x1b[32m[Project directory changed to: ${this.projectPath}]\x1b[0m\n`);
    }
  }

  ngOnDestroy() {
    // Clean up resize listener
    window.removeEventListener('resize', this.handleWindowResize);
    
    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Clean up subscriptions
    this.subscriptions.forEach(sub => {
      try {
        sub.unsubscribe?.();
      } catch (e) {
        console.error('[Terminal] Error unsubscribing:', e);
      }
    });
    
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

  /**
   * Flatten the FileNode[] into a map of relativePath -> content.
   */
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
  public createNewTerminal(name?: string) {
    if (!this.connectionReady) {
      console.warn('[Terminal] Connection not ready, waiting...');
      this.term.writeln('\x1b[33mWaiting for backend connection...\x1b[0m');
      setTimeout(() => this.createNewTerminal(name), 500);
      return;
    }

    const sessionId = `term-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const title = name || `Terminal ${this.terminals.length + 1}`;
    const termObj: any = {
      name: title,
      sessionId,
      mode: 'bash',
      buffer: '',
      cwd: this.projectPath || this.defaultDirectory,
      subscription: null
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

          // Check for CWD marker
          if (output.includes('__CWD__:')) {
            const match = output.match(/__CWD__:([^\n\r]+)/);
            if (match && match[1]) {
              termObj.cwd = match[1].trim();
            }
          }
        } else if (data.type === 'terminal-error') {
          const errorMsg = `\x1b[31m[ERROR] ${data.message}\x1b[0m\n`;
          termObj.buffer += errorMsg;
          if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
            this.term.write(errorMsg);
          }
        } else if (data.type === 'terminal-ready') {
          // Shell is ready, show prompt if in prompt mode
          if (termObj.mode === 'prompt') {
            const prompt = `\x1b[32m${termObj.cwd} $\x1b[0m `;
            termObj.buffer += prompt;
            if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
              this.term.write(prompt);
            }
          }
        } else if (typeof data === 'string') {
          termObj.buffer += data + '\n';
          if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
            this.term.write(data + '\n');
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
      
      // Send initial shell start command
      const startMsg: any = { type: 'terminal', startShell: true };
      if (this.projectFiles && Array.isArray(this.projectFiles) && this.projectFiles.length > 0) {
        startMsg.projectFiles = this.flattenFilesToMap(this.projectFiles, this.projectPath);
      }
      if (this.projectPath) {
        startMsg.projectPath = this.projectPath;
      }
      
      // Send terminal dimensions
      startMsg.cols = this.term.cols;
      startMsg.rows = this.term.rows;
      
      this.websocketService.publishToTerminal(sessionId, startMsg);

      // Show initial prompt for prompt mode
      if (termObj.mode === 'prompt') {
        setTimeout(() => {
          const prompt = `\x1b[32m${termObj.cwd} $\x1b[0m `;
          termObj.buffer += prompt;
          if (this.terminals[this.activeTerminalIndex]?.sessionId === sessionId && this.term) {
            this.term.write(prompt);
          }
        }, 500);
      }
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

  public switchToTerminal(index: number) {
    if (index < 0 || index >= this.terminals.length) return;
    this.activeTerminalIndex = index;
    const t = this.terminals[index];
    
    try {
      if (!this.term) return;
      
      // Clear terminal and write buffer
      this.term.clear();
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

  public onPromptSubmit() {
    const active = this.terminals[this.activeTerminalIndex];
    if (!active) return;
    
    const cmd = this.promptCommand.trim();
    if (!cmd) return;
    
    // Write command to terminal display
    this.term.writeln(`\x1b[32m${active.cwd} $\x1b[0m ${cmd}`);
    
    this.publishCommandToSession(active.sessionId, cmd);
    this.promptCommand = '';
  }

  // Handle mode changes
  public onModeChange() {
    const active = this.terminals[this.activeTerminalIndex];
    if (!active) return;

    // Reset current command
    this.currentCommand = '';
    
    if (active.mode === 'prompt') {
      // Switching to prompt mode - show prompt
      this.term.write(`\r\n\x1b[32m${active.cwd} $\x1b[0m `);
    } else {
      // Switching to bash mode - notify backend if needed
      this.term.write('\r\n[Switched to Bash mode - direct PTY interaction]\r\n');
    }

    // Update terminal modes to Bash and Command Prompt
    const currentMode = this.terminals[this.activeTerminalIndex]?.mode;
    if (currentMode === 'bash') {
      console.log('Bash terminal is active');
    } else if (currentMode === 'cmd') {
      console.log('Command Prompt terminal is active');
    }
  }
}