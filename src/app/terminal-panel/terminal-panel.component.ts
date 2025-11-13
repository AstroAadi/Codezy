import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WebContainer } from '@webcontainer/api';
import { CollaborationService } from '../services/collaboration.service';
import { FileNode } from '../project-explorer/project-explorer.component';

/**
 * Terminal Panel using WebContainers (StackBlitz Technology)
 * - Runs Node.js entirely in the browser
 * - No backend needed for terminal
 * - Files stored in browser memory
 * - Full npm support
 */
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
  private webContainerInstance: WebContainer | null = null;
  private fileWatchController?: AbortController;
  
  // Preview panel
  previewUrl: string = '';
  showPreview: boolean = false;
  isPreviewLoading: boolean = false;
  safePreviewUrl: SafeResourceUrl | null = null;
  private portMonitor: any = null;

  // Multi-terminal support
  terminals: Array<{
    name: string;
    sessionId: string;
    shellProcess: any; // WebContainer shell process
    inputWriter: any; // WritableStreamDefaultWriter for input
    isReady: boolean;
  }> = [];
  activeTerminalIndex: number = 0;
  connectionReady: boolean = false;
  editingTabIndex: number = -1;
  editingTabName: string = '';
  isInitializing: boolean = false;

  constructor(
    private collaborationService: CollaborationService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    // Will initialize in ngAfterViewInit
  }

  ngAfterViewInit() {
    this.initializeTerminal();
    this.initializeWebContainer();
    // Port monitoring will start after WebContainer is ready
  }

  private initializeTerminal(): void {
    // Create terminal with proper configuration
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
      convertEol: true,
      allowProposedApi: true,
      cols: 80,
      rows: 24
    });

    // Initialize FitAddon
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    
    // Load WebLinks addon
    const webLinksAddon = new WebLinksAddon();
    this.term.loadAddon(webLinksAddon);
    
    // Open terminal in container
    this.term.open(this.terminalDiv.nativeElement);
    
    // Initial fit
    setTimeout(() => {
      this.fitTerminalToContainer();
    }, 100);
    
    // Setup copy/paste handlers
    this.setupTerminalHandlers();
    
    // Handle window resize
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        this.fitTerminalToContainer();
      });
    });
    this.resizeObserver.observe(this.terminalDiv.nativeElement);

    window.addEventListener('resize', this.handleWindowResize);
  }

  private async initializeWebContainer() {
    this.isInitializing = true;
    this.term.writeln('\x1b[33m⏳ Initializing WebContainer...\x1b[0m');
    this.term.writeln('\x1b[90mThis may take a few seconds on first load...\x1b[0m');
    
    try {
      // Boot WebContainer
      this.webContainerInstance = await WebContainer.boot();
      console.log('[WebContainer] Booted successfully');
      
      this.term.writeln('\x1b[32m✅ WebContainer initialized successfully!\x1b[0m');
      this.term.writeln('\x1b[32m🌐 Node.js environment ready in browser\x1b[0m');
      this.term.writeln('');
      
      // Mount initial file system
      await this.mountProjectFiles();
      
      this.connectionReady = true;
      this.isInitializing = false;
      
      // Create first terminal
      this.createNewTerminal();

      // Start port monitoring AFTER WebContainer is ready
      this.setupPortMonitoring();
      
    } catch (error: any) {
      console.error('[WebContainer] Failed to boot:', error);
      this.term.writeln('\x1b[31m❌ Failed to initialize WebContainer\x1b[0m');
      this.term.writeln('\x1b[31m' + error.message + '\x1b[0m');
      this.term.writeln('');
      this.term.writeln('\x1b[33m💡 WebContainers requires:\x1b[0m');
      this.term.writeln('  - Modern browser (Chrome, Edge, Opera)');
      this.term.writeln('  - Cross-Origin Isolation headers');
      this.term.writeln('  - HTTPS connection (or localhost)');
      this.isInitializing = false;
    }
  }

  private async mountProjectFiles() {
    if (!this.webContainerInstance) return;

    try {
        // Convert project files to WebContainer file tree format
        const fileTree: any = {};

        if (this.projectFiles && this.projectFiles.length > 0) {
            this.buildFileTree(this.projectFiles, fileTree);
        }

        // Mount the file tree
        await this.webContainerInstance.mount(fileTree);
        console.log('[WebContainer] Files mounted:', Object.keys(fileTree));

        // Start watching for file changes (simplified approach)
        this.setupFileChangePolling();

        // Write welcome file
        try {
            await this.webContainerInstance.fs.writeFile(
                '/README.txt',
                'Welcome to WebContainer Terminal!\n\n' +
                'Your project files are mounted here.\n' +
                'Use "ls" to see all files.\n' +
                'Use "cat <filename>" to read files.\n' +
                'Use "nano <filename>" to edit files.\n\n' +
                'Try these commands:\n' +
                '  ls              - List files\n' +
                '  node --version  - Check Node.js version\n' +
                '  npm install     - Install dependencies\n' +
                '  npm start       - Run the project\n'
            );
        } catch (err) {
            console.warn('[WebContainer] Could not create README:', err);
        }

    } catch (error) {
        console.error('[WebContainer] Failed to mount files:', error);
    }
  }

  private buildFileTree(nodes: any[], tree: any, parentPath: string = '') {
    nodes.forEach(node => {
      if (node.type === 'file') {
        // Get file content from localStorage or node.content
        let content = node.content || '';
        
        // Try to get from localStorage if path is available
        if (node.path) {
          const stored = localStorage.getItem(node.path);
          if (stored !== null) {
            content = stored;
          }
        }
        
        tree[node.name] = {
          file: {
            contents: content
          }
        };
      } else if (node.type === 'folder' && node.children) {
        tree[node.name] = {
          directory: {}
        };
        if (node.children.length > 0) {
          this.buildFileTree(node.children, tree[node.name].directory, node.name);
        }
      }
    });
  }

  // Method to sync file from WebContainer back to localStorage and project explorer
  public async syncFileFromWebContainer(filePath: string): Promise<string | null> {
    if (!this.webContainerInstance) return null;

    try {
      // Read file from WebContainer
      const content = await this.webContainerInstance.fs.readFile(filePath, 'utf-8');
      
      // Save to localStorage
      localStorage.setItem(filePath, content);
      
      // Notify collaboration service to update project explorer
      this.collaborationService.notifyFileStructureChanged();
      
      console.log('[WebContainer] Synced file:', filePath);
      return content;
    } catch (error) {
      console.error('[WebContainer] Failed to sync file:', error);
      return null;
    }
  }

  // Simplified file change monitoring using polling instead of async iterator
  // Simplified file change monitoring using polling instead of async iterator
  private async setupFileChangePolling() {
    if (!this.webContainerInstance) return;

    // Store known files AND directories to detect new ones
    const knownPaths = new Set<string>();

    // IMPORTANT: Initialize knownPaths with all currently mounted files to prevent duplicates
    try {
      const initialPaths = await this.scanWebContainerFiles('', this.webContainerInstance.fs);
      initialPaths.forEach(path => knownPaths.add(path));
      console.log('[WebContainer] Initialized file monitor with', knownPaths.size, 'existing paths');
    } catch (error) {
      console.error('[WebContainer] Failed to initialize known paths:', error);
    }

    const pollInterval = setInterval(async () => {
      if (!this.webContainerInstance) {
        clearInterval(pollInterval);
        return;
      }

      try {
        // Recursively scan for all files and directories in the WebContainer
        const allPaths = await this.scanWebContainerFiles('', this.webContainerInstance.fs);
        
        // Find new paths (files or directories) that weren't there before
        for (const filePath of allPaths) {
          if (!knownPaths.has(filePath) && !filePath.startsWith('/proc')) {
            knownPaths.add(filePath);
            console.log('[WebContainer] New path detected:', filePath);
            // New path detected - sync it to project explorer
            await this.syncNewPathToExplorer(filePath);
          }
        }
        
      } catch (error) {
        console.error('[WebContainer] File monitoring error:', error);
      }
    }, 2000); // Check every 2 seconds

    // Store the interval ID so we can clear it on destroy
    (this as any).fileMonitorInterval = pollInterval;
  }

  // Recursively scan WebContainer filesystem for all files AND directories
  private async scanWebContainerFiles(basePath: string, fs: any): Promise<string[]> {
    const paths: string[] = [];
    // Only ignore .git, .cache, README.txt (do NOT ignore node_modules)
    const ignore = ['.git', '.cache', 'README.txt'];

    try {
      const entries = await fs.readdir(basePath || '/', { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = basePath ? `${basePath}/${entry.name}` : `/${entry.name}`;
        
        if (ignore.includes(entry.name)) continue;
        
        if (entry.isDirectory?.()) {
          // Add directory to paths
          paths.push(fullPath);
          // Recursively scan subdirectories
          const subPaths = await this.scanWebContainerFiles(fullPath, fs);
          paths.push(...subPaths);
        } else if (entry.isFile?.()) {
          paths.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`[WebContainer] Failed to scan ${basePath}:`, error);
    }
    
    return paths;
  }

  // Sync newly created file or directory to project explorer via collaboration service
  private async syncNewPathToExplorer(filePath: string) {
    try {
      // Skip system paths and already synced paths
      if (filePath.startsWith('/proc') || filePath.startsWith('/sys')) {
        return;
      }
      let isDirectory = false;
      let content: string = '';
      try {
        // Get parent directory and entry name
        const lastSlash = filePath.lastIndexOf('/');
        const parentDir = lastSlash > 0 ? filePath.substring(0, lastSlash) || '/' : '/';
        const entryName = filePath.substring(lastSlash + 1);
        const entries = await this.webContainerInstance?.fs.readdir(parentDir, { withFileTypes: true });
        if (entries) {
          const entry = entries.find((e: any) => e.name === entryName);
          if (entry) {
            if (entry.isDirectory?.()) {
              isDirectory = true;
            } else if (entry.isFile?.()) {
              isDirectory = false;
              content = await this.webContainerInstance?.fs.readFile(filePath, 'utf-8') || '';
            }
          }
        }
      } catch (error) {
        // Fallback: try reading as file
        try {
          content = await this.webContainerInstance?.fs.readFile(filePath, 'utf-8') || '';
          isDirectory = false;
        } catch {
          isDirectory = true;
        }
      }
      if (isDirectory) {
        this.collaborationService.ensureFolderExists(filePath);
        console.log('[WebContainer] Synced new folder to explorer:', filePath);
      } else {
        this.collaborationService.ensureFileExists(filePath, content);
        console.log('[WebContainer] Synced new file to explorer:', filePath);
      }
    } catch (error) {
      console.error('[WebContainer] Failed to sync path:', filePath, error);
    }
  }

  // Public method to update a file in WebContainer (called from project explorer)
  public async updateFileInWebContainer(filePath: string, content: string): Promise<void> {
    if (!this.webContainerInstance) return;

    try {
      // Ensure directory exists
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      if (dirPath) {
        try {
          await this.webContainerInstance.fs.mkdir(dirPath, { recursive: true });
        } catch (err) {
          // Directory might already exist
        }
      }

      // Write file to WebContainer
      await this.webContainerInstance.fs.writeFile(filePath, content, 'utf-8');
      console.log('[WebContainer] Updated file:', filePath);
    } catch (error) {
      console.error('[WebContainer] Failed to update file:', error);
    }
  }

  private handleWindowResize = () => {
    requestAnimationFrame(() => {
      this.fitTerminalToContainer();
    });
  };

  private fitTerminalToContainer(): void {
    try {
      if (!this.term || !this.fitAddon) return;
      this.fitAddon.fit();
    } catch (e) {
      console.warn('[Terminal] Fit error:', e);
    }
  }

  private setupTerminalHandlers(): void {
    // Handle keyboard events
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Handle Ctrl+C - send interrupt signal to running process
      if (event.ctrlKey && event.key === 'c') {
        event.preventDefault();
        const active = this.terminals[this.activeTerminalIndex];
        if (active && active.inputWriter && active.isReady) {
          // Send Ctrl+C (ASCII code 3) to the shell process
          active.inputWriter.write('\u0003');
        }
        // Also copy if text is selected
        if (this.term.hasSelection()) {
          document.execCommand('copy');
        }
        return false;
      }
      
      // Allow Ctrl+V for pasting
      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault();
        navigator.clipboard.readText().then(text => {
          const active = this.terminals[this.activeTerminalIndex];
          if (active && active.inputWriter && active.isReady) {
            active.inputWriter.write(text);
          }
        });
        return false;
      }
      
      // Allow Ctrl+A for select all
      if (event.ctrlKey && event.key === 'a') {
        this.term.selectAll();
        return false;
      }
      
      // Allow all other keys to pass through to shell
      return true;
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectFiles'] && !changes['projectFiles'].firstChange) {
      // Remount files when project files change
      this.mountProjectFiles();
    }
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.handleWindowResize);
    
    // Clear file monitoring interval
    if ((this as any).fileMonitorInterval) {
      clearInterval((this as any).fileMonitorInterval);
    }

    // Clear port monitoring interval
    if (this.portMonitor) {
      clearInterval(this.portMonitor);
    }

    // Abort file watching if active
    if (this.fileWatchController) {
      this.fileWatchController.abort();
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.fitAddon) {
      try {
        this.fitAddon.dispose();
      } catch (e) {
        console.error('[Terminal] Error disposing fitAddon:', e);
      }
    }

    if (this.term) {
      try {
        this.term.dispose();
      } catch (e) {
        console.error('[Terminal] Error disposing terminal:', e);
      }
    }

    // Kill all shell processes
    this.terminals.forEach(t => {
      if (t.shellProcess) {
        try {
          t.shellProcess.kill();
        } catch (e) {
          console.error('[Terminal] Error killing shell:', e);
        }
      }
    });
  }

  // ----------------- Multi-terminal implementation -----------------
  public async createNewTerminal(customName?: string) {
    if (!this.connectionReady || !this.webContainerInstance) {
      console.warn('[Terminal] WebContainer not ready');
      this.term.writeln('\x1b[33m⏳ Waiting for WebContainer...\x1b[0m');
      setTimeout(() => this.createNewTerminal(customName), 500);
      return;
    }

    const sessionId = `term-${Date.now()}`;
    const title = customName || `Terminal ${this.terminalCounter++}`;
    
    const termObj: any = {
      name: title,
      sessionId,
      shellProcess: null,
      inputWriter: null,
      isReady: false
    };

    this.terminals.push(termObj);
    const termIndex = this.terminals.length - 1;

    try {
      // Spawn shell process in WebContainer
      const shellProcess = await this.webContainerInstance.spawn('jsh', {
        terminal: {
          cols: this.term.cols,
          rows: this.term.rows
        }
      });

      termObj.shellProcess = shellProcess;
      termObj.isReady = true;

      console.log('[WebContainer] Shell started for', sessionId);

      // Pipe shell output to terminal
      shellProcess.output.pipeTo(
        new WritableStream({
          write: (data) => {
            // Only write to terminal if this is the active terminal
            const activeIndex = this.terminals.findIndex(t => t.sessionId === sessionId);
            if (activeIndex === this.activeTerminalIndex && this.term) {
              this.term.write(data);
            }
          }
        })
      );

      // Get the writable stream for input (only once, stored in termObj)
      termObj.inputWriter = shellProcess.input.getWriter();

      // Switch to new terminal first
      this.switchToTerminal(termIndex);

      // NOW connect terminal input to shell (after switching)
      // Remove any existing listeners first
      if ((this.term as any)._onDataDisposable) {
        (this.term as any)._onDataDisposable.dispose();
      }

      // Add new listener that forwards input to ACTIVE terminal's shell
      (this.term as any)._onDataDisposable = this.term.onData(data => {
        const active = this.terminals[this.activeTerminalIndex];
        if (active && active.inputWriter && active.isReady) {
          active.inputWriter.write(data);
        }
      });

      // Show welcome message (don't get writer again, use the stored one)
      await this.showWelcomeMessage(termObj.inputWriter);

    } catch (error: any) {
      console.error('[WebContainer] Failed to create terminal:', error);
      this.term.writeln('\x1b[31m❌ Failed to start terminal\x1b[0m');
      this.term.writeln('\x1b[31m' + error.message + '\x1b[0m');
      this.terminals.splice(termIndex, 1);
    }
  }

  private async showWelcomeMessage(inputWriter: any) {
    try {
      const welcomeCommands = [
        'echo "\\x1b[32m✅ WebContainer Terminal Ready\\x1b[0m"',
        'echo "\\x1b[36m🌐 Running Node.js in your browser\\x1b[0m"',
        'echo "\\x1b[90m💡 Try: node --version, npm --version, ls\\x1b[0m"',
        'echo ""'
      ];

      for (const cmd of welcomeCommands) {
        await inputWriter.write(cmd + '\n');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      console.error('[Terminal] Error showing welcome message:', error);
    }
  }

  public switchToTerminal(index: number) {
    if (index < 0 || index >= this.terminals.length) return;
    
    const previousIndex = this.activeTerminalIndex;
    this.activeTerminalIndex = index;
    
    const t = this.terminals[index];
    
    // Clear terminal
    this.term.reset();
    this.term.writeln('\x1b[36m🔌 Switched to ' + t.name + '\x1b[0m');
    this.term.writeln('');
    
    // Reconnect input handler to the active terminal
    if ((this.term as any)._onDataDisposable) {
      (this.term as any)._onDataDisposable.dispose();
    }
    
    // Connect input to the newly active terminal
    (this.term as any)._onDataDisposable = this.term.onData(data => {
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.inputWriter && active.isReady) {
        active.inputWriter.write(data);
      }
    });
    
    setTimeout(() => {
      this.fitTerminalToContainer();
    }, 10);
  }

  public closeTerminal(index: number) {
    if (this.terminals.length <= 1) {
      console.warn('[Terminal] Cannot close the last terminal');
      return;
    }

    const t = this.terminals[index];
    if (!t) return;
    
    // Kill shell process
    if (t.shellProcess) {
      try {
        t.shellProcess.kill();
      } catch (error) {
        console.error('[Terminal] Error killing shell:', error);
      }
    }
    
    this.terminals.splice(index, 1);
    
    // Adjust active index
    if (this.activeTerminalIndex >= this.terminals.length) {
      this.activeTerminalIndex = Math.max(0, this.terminals.length - 1);
    } else if (this.activeTerminalIndex > index) {
      this.activeTerminalIndex--;
    }
    
    this.switchToTerminal(this.activeTerminalIndex);
  }

  // Tab renaming
  public startEditingTabName(index: number, event: MouseEvent) {
    event.stopPropagation();
    this.editingTabIndex = index;
    this.editingTabName = this.terminals[index].name;
    
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

  // Clear terminal
  public clearTerminal() {
    if (this.term) {
      this.term.clear();
    }
  }

  // Copy selection
  public copySelection() {
    if (this.term && this.term.hasSelection()) {
      const selection = this.term.getSelection();
      navigator.clipboard.writeText(selection);
    }
  }

  // Paste from clipboard
  public pasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
      const active = this.terminals[this.activeTerminalIndex];
      if (active && active.inputWriter) {
        active.inputWriter.write(text);
      }
    });
  }

  // Install npm package
  public async installPackage(packageName: string) {
    const active = this.terminals[this.activeTerminalIndex];
    if (!active || !active.inputWriter) return;

    try {
      await active.inputWriter.write(`npm install ${packageName}\n`);
    } catch (error) {
      console.error('[Terminal] Error installing package:', error);
    }
  }

  // Preview panel methods
  public togglePreview() {
    this.showPreview = !this.showPreview;
  }

  public refreshPreview() {
    if (!this.previewUrl) return;
    
    this.isPreviewLoading = true;
    
    // Regenerate the safe URL to force reload
    this.safePreviewUrl = null;
    
    setTimeout(() => {
      const url = this.previewUrl + (this.previewUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
      this.safePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      setTimeout(() => {
        this.isPreviewLoading = false;
      }, 1000);
    }, 100);
  }

  // Monitor for port listening (server startup) to show preview
  private setupPortMonitoring() {
    if (this.portMonitor) return;
    if (!this.webContainerInstance) return;
    // Listen for server-ready event from WebContainer
    this.webContainerInstance.on('server-ready', (port: number, url: string) => {
      if (!this.previewUrl) {
        this.previewUrl = url;
        this.safePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        this.showPreview = true;
        console.log('[WebContainer] Preview available at', url);
      }
    });
  }

  public openPreviewInNewTab() {
    if (this.previewUrl) {
      window.open(this.previewUrl, '_blank');
    }
  }

  public copyPreviewUrl() {
    if (this.previewUrl) {
      navigator.clipboard.writeText(this.previewUrl).then(() => {
        this.term.writeln('\x1b[32m✓ Preview URL copied to clipboard\x1b[0m');
      });
    }
  }
}