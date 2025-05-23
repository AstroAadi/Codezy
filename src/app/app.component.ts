import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './navbar/navbar.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
import { BottomPanelComponent } from './bottom-panel/bottom-panel.component';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { FileNode, ProjectExplorerComponent } from './project-explorer/project-explorer.component';
import { OutputPanelComponent } from './output-panel/output-panel.component';
import { PanelType } from './bottom-panel/bottom-panel.component'; // Add this import
import { WebsocketService, CodeChange } from './services/websocket.service';
import { CollaborationService } from './services/collaboration.service';
import { ToolbarActionsService } from './services/toolbar-actions.service';
import { SelectedFileService } from './services/selected-file.service';
import { UserFileService } from './services/user-file.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    ToolbarComponent,
    BottomPanelComponent,
    RouterModule,
    ProjectExplorerComponent,
    CodeEditorComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'Codzy';
  isAuthRoute = false;
  isExplorerOpen = true;
  explorerWidth = 220;

  uploadedFiles: File[] = [];
  fileNodes: FileNode[] = [];
  selectedFile: FileNode | null = null;

  // Add these if you still need them elsewhere, otherwise remove all references
  selectedFileContent: string | null = null;
  selectedFileName: string | null = null;

  code: string = '';
  output: string = '';


  onOutputChanged(newOutput: string) {
    this.output = newOutput;
  }

selectedSessionMode: 'create' | 'join' | null = null;
onSessionModeSelected(mode: 'create' | 'join') {
  this.selectedSessionMode = mode;
}

  toggleExplorer() {
    this.isExplorerOpen = !this.isExplorerOpen;
    this.explorerWidth = this.isExplorerOpen ? 220 : 0;
  }

  onToolbarFileSelected(file: File) {
    this.onFileUploaded(file);
  }

  onFileUploaded(file: File) {
    this.uploadedFiles = [...this.uploadedFiles, file];
    this.onSidebarFileUploaded(file);
  }

  onSidebarFileUploaded(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const newNode: FileNode = {
        name: file.name,
        type: 'file',
        path: file.name,
        content: reader.result as string,
      };
      this.fileNodes.push(newNode);
      this.selectedFile = newNode;
    };
    reader.readAsText(file);
  }
 

  onSidebarFileSelected(file: FileNode) {
    this.selectedFile = file;
  }

  onToolbarNewFile() {
    const name = prompt('Enter new file name:');
    if (name) {
      const newNode: FileNode = {
        name,
        type: 'file',
        path: name,
        content: '',
      };
      this.fileNodes.push(newNode);
      this.selectedFile = newNode;
    }
  }

  onToolbarAddFolder() {
    const name = prompt('Enter new folder name:');
    if (name) {
      const newFolder: FileNode = {
        name,
        type: 'folder',
        path: name,
        children: [],
      };
      this.fileNodes.push(newFolder);
    }
  }

  @ViewChild('projectExplorer') projectExplorer: any;
  constructor(
    private router: Router,
    private websocketService: WebsocketService,
    private collaborationService: CollaborationService,
    private toolbarActions: ToolbarActionsService,
    private selectedFileService: SelectedFileService,
    private userFileService: UserFileService,
    private themeService: ThemeService

  ) {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isAuthRoute = ['/login', '/register'].includes(this.router.url);
        if (this.isAuthRoute) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = '';
        }
      }
    });
    // Ensure 'untitled' file exists on startup
    if (!this.fileNodes.some(f => f.name === 'untitled')) {
      const untitledFile: FileNode = {
        name: 'untitled',
        type: 'file', // <-- This must be the literal 'file'
        path: 'untitled',
        content: '// This is the untitled file.\n// You can observe code changes here.\n',
      };
      this.fileNodes.push(untitledFile);
      if (!this.selectedFile) {
        this.selectedFile = untitledFile;
      }
    }
    // Subscribe to code changes from WebSocket
    this.websocketService.getCodeChanges().subscribe((changes: CodeChange[]) => {
      const latestChange = changes[changes.length - 1];
      if (latestChange) {
        this.handleIncomingCodeChange(latestChange);
      }
    });

    // Subscribe to file added events (for file creation by collaborators)
    this.collaborationService.fileAdded$.subscribe((fileNode: FileNode) => {
      if (!this.findFileByPath(this.fileNodes, fileNode.path)) {
        this.fileNodes.push(fileNode);
      }
    });

    //  // Subscribe to toolbar actions for navbar and toolbar
    //  this.toolbarActions.newFile.subscribe(() => {
    //   if (this.projectExplorer) this.projectExplorer.startAdd('file');
    // });
    // this.toolbarActions.addFolder.subscribe(() => {
    //   if (this.projectExplorer) this.projectExplorer.startAdd('folder');
    // });
    // this.toolbarActions.openFile.subscribe(() => {
    //   // Optionally trigger file input dialog or handle file open logic
    // });
    this.toolbarActions.saveFile.subscribe(() => {
      this.saveUserFile();
    });
  }

  // Add file to root or folder
  onAddFile(node: FileNode) {
    if (node.parent) {
      node.parent.children!.push({ ...node, isEditingName: false, parent: undefined });
      node.parent.children = node.parent.children!.filter(child => child.isEditingName !== true);
    } else {
      this.fileNodes = this.fileNodes.filter(child => child.isEditingName !== true);
    }
    this.selectedFile = node;
    // Broadcast file creation to collaborators
    this.collaborationService.ensureFileExists(node.path, node.content || '');
  }

  // Add folder to root or folder
  onAddFolder(node: FileNode) {
    if (node.parent) {
      node.parent.children!.push({ ...node, isEditingName: false, parent: undefined });
      node.parent.children = node.parent.children!.filter(child => child.isEditingName !== true);
    } else {
      this.fileNodes = this.fileNodes.filter(child => child.isEditingName !== true);
    }
  }

  isResizing = false;
  showResizeArrows = false;
  private startX = 0;
  private startWidth = 0;

  startSidebarResize(event: MouseEvent) {
    event.preventDefault();
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = this.explorerWidth;

    document.addEventListener('mousemove', this.onSidebarResize);
    document.addEventListener('mouseup', this.stopSidebarResize);
  }

  onSidebarResize = (event: MouseEvent) => {
    if (!this.isResizing) return;
    let newWidth = this.startWidth + (event.clientX - this.startX);
    newWidth = Math.max(0, Math.min(400, newWidth)); // min 0, max 400px
    this.explorerWidth = newWidth;
    if (newWidth === 0) this.isExplorerOpen = false;
    else this.isExplorerOpen = true;
  };

  stopSidebarResize = () => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.onSidebarResize);
    document.removeEventListener('mouseup', this.stopSidebarResize);
  };

  onSidebarMouseMove(event: MouseEvent) {
    // Optionally, you can add logic to show the resize arrow only near the edge
  }

  onSidebarMouseLeave() {
    this.showResizeArrows = false;
  }

  outputText: string = '';
  activeBottomPanel: PanelType | null = null;
  selectedLanguage: string = 'python'; // Set default language
  // Change type here
  onToolbarLanguageChange(lang: string) {
    this.selectedLanguage = lang;
  }

  runCounter = 0;
  @ViewChild(BottomPanelComponent) bottomPanelComponent!: BottomPanelComponent;
onRun() {
    this.activeBottomPanel = 'output';
    setTimeout(() => {
      if (this.bottomPanelComponent && this.bottomPanelComponent.outputPanelComponent) {
        this.bottomPanelComponent.outputPanelComponent.code = this.selectedFile?.content || '';
        this.bottomPanelComponent.outputPanelComponent.language = this.selectedLanguage || 'python';
        this.bottomPanelComponent.outputPanelComponent.runCode();
      }
    });
    this.runCounter++;
}

  onRunnerOutput(output: string) {
    this.outputText = output;
    this.activeBottomPanel = 'output';
  }

  onBottomPanelToggle(panel: PanelType | null) {
    this.activeBottomPanel = this.activeBottomPanel === panel ? null : panel;
  }

  onCodeChanged(newCode: string) {
    if (this.selectedFile) {
      this.selectedFile.content = newCode;
      // Broadcast code change to collaborators
      const username = this.collaborationService.getCurrentUserEmail() || 'unknown';
      const sessionId = this.collaborationService.getCurrentSessionId?.() || '';
      this.websocketService.sendCodeChange(newCode, username, this.selectedFile.path);
      this.code = newCode;
    }
  }

  handleIncomingCodeChange(change: CodeChange) {
    // Find the file by path, create if not exists
    let file = this.findFileByPath(this.fileNodes, change.filePath);
    if (!file) {
      file = {
        name: change.filePath.split('/').pop() || change.filePath,
        type: 'file',
        path: change.filePath,
        content: change.content
      };
      this.fileNodes.push(file);
    } else {
      file.content = change.content;
    }
    // Optionally, update selectedFile if it's the same file
    if (this.selectedFile && this.selectedFile.path === change.filePath) {
      this.selectedFile.content = change.content;
    }
  }

  findFileByPath(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.type === 'folder' && node.children) {
        const found = this.findFileByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }
  
  ngOnInit() {
    this.themeService.initializeTheme();

    // Subscribe to code changes from WebSocket
    this.websocketService.getCodeChanges().subscribe((changes: CodeChange[]) => {
      if (!Array.isArray(changes)) return;
      const latestChange = changes[changes.length - 1];
      if (latestChange && latestChange.filePath) {
        // Find the file node and update its content
        const fileNode = this.fileNodes.find(f => f.path === latestChange.filePath);
        if (fileNode) {
          fileNode.content = latestChange.content;
          // If this file is currently selected, update the editor as well
          if (this.selectedFile && this.selectedFile.path === fileNode.path) {
            this.selectedFile.content = latestChange.content;
          }
        }
      }
    });
  }
  saveUserFile() {
    if (!this.selectedFile || this.selectedFile.type === 'folder') {
      console.error('No file selected or selected item is a folder.');
      return;
    }
    const fileName = this.selectedFile.name;
    const codeContent = this.selectedFile.content || '';
    this.userFileService.saveFile(fileName, codeContent).subscribe(
      response => {
        console.log('File saved:', response);
      },
      error => {
        console.error('Error saving file:', error);
      }
    );
  }
}
