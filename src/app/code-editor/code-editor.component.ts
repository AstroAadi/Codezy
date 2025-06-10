import { Component, Input, OnInit, OnDestroy, SimpleChanges, OnChanges, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CodemirrorComponent, CodemirrorModule } from '@ctrl/ngx-codemirror';
import { WebsocketService } from '../services/websocket.service';
import { Subscription } from 'rxjs';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/css/css';
import 'codemirror/mode/clike/clike';  // For Java and C
import 'codemirror/mode/python/python';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/matchbrackets';
import 'codemirror/addon/fold/foldcode';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/lint/lint';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/javascript-hint';
import 'codemirror/addon/hint/anyword-hint';
import 'codemirror/addon/search/searchcursor';
import 'codemirror/addon/search/search';
import 'codemirror/addon/search/match-highlighter';
import { ActivatedRoute, Router } from '@angular/router';
import { CollaborationService } from '../services/collaboration.service';
import { FileNode } from '../project-explorer/project-explorer.component';
import CodeMirror from 'codemirror';
import { EditorActionsService } from '../services/editor-actions.service';

@Component({
    selector: 'app-code-editor',
    imports: [CommonModule, FormsModule, CodemirrorModule],
    template: `
    <div class="editor-container">
      <div class="editor-header">
        <div class="connected-users">
          <span *ngFor="let user of connectedUsers" class="user-badge">
            {{ user }}
          </span>
        </div>
      </div>
      <div class="editor-codemirror-wrapper">
        <ngx-codemirror
          [(ngModel)]="code"
          [options]="codeMirrorOptions"
          (ngModelChange)="onCodeChange($event)"
        ></ngx-codemirror>
      </div>
    </div>
    <div *ngIf="showFindBox" class="find-box">
      <input [(ngModel)]="findQuery" (keydown.enter)="performFind()" placeholder="Find..." autofocus />
      <button (click)="performFind()">Find</button>
      <button (click)="closeFindBox()">Close</button>
    </div>
  `,
    styles: [`
    .editor-container {
      height: 100%;
      min-height: 0;
      background-color: #2b2b2b;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .editor-header {
      padding: 8px;
      background-color: #3c3f41;
      border-bottom: 1px solid #323232;
      flex: 0 0 auto;
    }
    .connected-users {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .user-badge {
      background-color: #2c5a7c;
      color: #fff;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
    }
    .editor-codemirror-wrapper {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      scrollbar-width: none; /* Firefox */
      -ms-overflow-style: none; /* IE and Edge */
    }
    ::ng-deep .CodeMirror {
      height: 100%;
      width: 100%;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      line-height: 1.6;
      background-color: #2b2b2b;
      color: #a9b7c6;
      display: flex;
      flex: 1 1 auto;
    }
    ::ng-deep .CodeMirror-scroll {
      height: 100%;
      overflow-y: auto;
      overflow-x: auto;
    }
    ::ng-deep .CodeMirror-gutters {
      background-color: #2b2b2b;
      border-right: 1px solid #3c3f41;
    }
    ::ng-deep .CodeMirror-linenumber {
      color: #606366;
    }
    ::ng-deep .cm-s-darcula.CodeMirror {
      background-color: #2b2b2b;
      color: #a9b7c6;
    }
    ::ng-deep .CodeMirror-scroll {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    ::ng-deep .CodeMirror-scroll::-webkit-scrollbar {
      display: none;
    }
  `]
})
export class CodeEditorComponent implements OnInit, OnDestroy, OnChanges {
  @Input() file: FileNode | null = null;
  files: FileNode[] = []; // Add this line to declare the 'files' property
  @Output() codeChange = new EventEmitter<string>();
  code = '';
  connectedUsers: string[] = [];
  private subscriptions: Subscription[] = [];
  username = '';
  sessionId = '';
  canEdit = true;
  canAddCollaborator = true;
  codeMirrorOptions = {
    theme: 'darcula',
    mode: 'javascript',
    lineNumbers: true,
    lineWrapping: false,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    autoCloseBrackets: true,
    matchBrackets: true,
    lint: true,
    extraKeys: {
      'Ctrl-Space': 'autocomplete',
      'Alt-Space': 'autocomplete',
      'Ctrl-Enter': (cm: CodeMirror.Editor) => {
        CodeMirror.showHint(cm, CodeMirror.hint.anyword);
      },
      '.': (cm: CodeMirror.Editor) => {
        setTimeout(() => {
          CodeMirror.showHint(cm, CodeMirror.hint.anyword);
        }, 300);
      },
      'Tab': (cm: CodeMirror.Editor) => {
        setTimeout(() => {
          CodeMirror.showHint(cm, CodeMirror.hint.anyword);
        }, 300);
      }
    },
    hintOptions: {
      completeSingle: false,
      alignWithWord: true,
      closeOnUnfocus: true,
      closeCharacters: /[\s()\[\]{};:>,]/,
      async: true
    },
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    autofocus: true,
    readOnly: !this.canEdit
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private websocketService: WebsocketService,
    private collaborationService: CollaborationService,
    private editorActions: EditorActionsService
  ) {
    this.editorActions.action$.subscribe(action => {
      switch(action) {
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'cut': this.cut(); break;
        case 'copy': this.copy(); break;
        case 'paste': this.paste(); break; 
        case 'find': this.find(); break;
        case 'replace': this.replace(); break;
        case 'delete': this.delete(); break;
      }
    });
  }

  ngOnInit() {
    const savedFiles = localStorage.getItem('fileStructure');

    if (savedFiles) {
    this.files = JSON.parse(savedFiles);

}
    this.route.paramMap.subscribe(params => {
      const paramSessionId = params.get('sessionId');
      const serviceSessionId = this.collaborationService.getCurrentSessionId();
      this.sessionId = paramSessionId || serviceSessionId || '';
      if (this.sessionId) {
        if (serviceSessionId && !paramSessionId) {
          this.router.navigate(['/collaborate', serviceSessionId]);
        }
        this.verifyCollaborator();
      } else {
        console.error('No session ID available');
      }
    });
    // Load initial code if a file is already selected
    this.loadCodeForFile();
    setTimeout(() => this.setupAutocomplete(), 1000);
  }

  verifyCollaborator(): void {
    this.collaborationService.verifySession(this.sessionId).subscribe({
      next: (response) => {
        if (response.isValid) {
          this.username = response.email;
          this.canEdit = response.canEdit;
          this.websocketService.connect(this.username, this.sessionId);
          this.setupWebSocketSubscriptions();
          // Wait for connection before sending initial code
          const connectionSub = this.websocketService.getConnectionStatus().subscribe(connected => {
            if (connected && this.code && this.code.trim() !== '' && this.file) {
              this.websocketService.sendCodeChange(this.code, this.username, this.file.path);
              connectionSub.unsubscribe();
            }
          });
        } else {
          alert('Invalid or expired session.');
        }
      },
      error: (err) => {
        console.error('Session verification failed', err);
        alert('Failed to verify session.');
      }
    });
  }

  private setupWebSocketSubscriptions() {
    this.subscriptions.push(
      this.websocketService.getCodeChanges().subscribe((changes) => {
        if (changes.length > 0) {
          const latestChange = changes[changes.length - 1];
          if (latestChange.username !== this.username) {
            this.code = latestChange.content;
          }
        }
      })
    );
  }

  onCodeChange(newCode: string) {
    this.code = newCode;
    if (this.file) {
        this.file.content = newCode; // Save code to the file object
        localStorage.setItem(this.file.path, newCode); // Save code to local storage
        // Also update the fileStructure in localStorage to persist content changes across refreshes
        const fileStructureString = localStorage.getItem('fileStructure');
        if (fileStructureString) {
            try {
                const fileStructure = JSON.parse(fileStructureString) as FileNode[];
                const updateFileContentRecursive = (nodes: FileNode[], path: string, content: string) => {
                    for (const node of nodes) {
                        if (node.path === path) {
                            node.content = content;
                            return true;
                        }
                        if (node.children && node.children.length > 0) {
                            if (updateFileContentRecursive(node.children, path, content)) {
                                return true;
                            }
                        }
                    }
                    return false;
                };
                updateFileContentRecursive(fileStructure, this.file.path, newCode);
                localStorage.setItem('fileStructure', JSON.stringify(fileStructure));
            } catch (e) {
                console.error('Failed to update fileStructure in localStorage:', e);
            }
        }
    }
    if (this.sessionId && this.username && this.file && this.websocketService.isConnected()) {
      this.websocketService.sendCodeChange(this.code, this.username, this.file.path);
    }
    this.codeChange.emit(this.code);
}

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.websocketService.disconnect();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['file'] && this.file !== null) {
      this.loadCodeForFile();
      if (this.sessionId && this.username) {
        setTimeout(() => {
          if (this.websocketService.isConnected() && this.file) {
            this.websocketService.sendCodeChange(this.code, this.username, this.file.path);
          }
        }, 1000); // Delay to ensure WebSocket is ready
      }
    }
  }

  private getEditorMode(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'py': return 'python';
      case 'java': return 'text/x-java';
      case 'c': return 'text/x-csrc';
      case 'cpp': case 'h': case 'hpp': return 'text/x-c++src';
      case 'js': return 'javascript';
      case 'html': return 'xml';
      case 'css': return 'css';
      default: return 'javascript';
    }
  }

  private loadCodeForFile() {
    if (this.file) {
      // Update the mode based on file extension
      this.codeMirrorOptions = {
        ...this.codeMirrorOptions,
        mode: this.getEditorMode(this.file.path)
      };
      // Prefer content from the file object if available
      this.code = this.file.content || localStorage.getItem(this.file.path) || '';
      // If content was loaded from localStorage and file.content was empty, update file.content
      if (!this.file.content && this.code) {
        this.file.content = this.code;
      }
    } else {
      this.code = ''; // No file selected
    }
  }

  @ViewChild(CodemirrorComponent) codemirror?: CodemirrorComponent;
  undo() {
    this.codemirror?.codeMirror?.undo();
  }
  redo() {
    this.codemirror?.codeMirror?.redo();
  
  }
  cut() {
    const cm = this.codemirror?.codeMirror;
    if (cm) {
      cm.execCommand('cut');
    }
  }
  copy() {
    const cm = this.codemirror?.codeMirror;
    if (cm) {
      const selectedText = cm.getSelection();
      if (selectedText) {
        navigator.clipboard.writeText(selectedText).catch(err => {
          console.error('Failed to copy text:', err);
        });
      }
    }
  }
  paste() {
    const cm = this.codemirror?.codeMirror;
    if (cm) {
      cm.focus();
    }
  }
  showFindBox = false;
  findQuery = '';
  
  find() {
    const query = window.prompt('Enter text to find:');
    if (query && query.trim()) {
      this.findQuery = query.trim();
      this.performFind();
    }
  }
  
  performFind() {
    const cm = this.codemirror?.codeMirror;
    if (cm && this.findQuery) {
      // Set the highlightSelectionMatches option
      cm.setOption('highlightSelectionMatches', {
        showToken: /./,
        annotateScrollbar: true,
        minChars: 5,
        style: 'searching'
      });
      // Use searchcursor to find and select the first match
      // @ts-ignore
      const cursor = cm.getSearchCursor(this.findQuery, {line:0, ch:0});
      if (cursor.findNext()) {
        cm.setSelection(cursor.from(), cursor.to());
        cm.scrollIntoView({from: cursor.from(), to: cursor.to()});
      }else {
        alert('No Match found in the selected file!');
      }
    }
    this.showFindBox = false;
  }
  
  closeFindBox() {
    this.showFindBox = false;
  }
  replace() {
    const cm = this.codemirror?.codeMirror;
    if (cm) {
      cm.execCommand('replace');
    }
  }
  delete() {
    const cm = this.codemirror?.codeMirror;
    if (cm) {
      const selections = cm.listSelections();
      cm.operation(() => {
        selections.forEach(sel => {
          cm.replaceRange('', sel.anchor, sel.head);
        });
      });
    }
  }
  // Add this method to the component class
  private setupAutocomplete() {
    if (this.codemirror?.codeMirror) {
      this.codemirror.codeMirror.on('change', (cm, change) => {
        if (change.origin === '+input' && change.text[0] !== '\n') {
          setTimeout(() => {
            CodeMirror.showHint(cm, CodeMirror.hint.anyword);
          }, 500);
        }
      });
    }
  }
}
