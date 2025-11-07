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
import { EditorActionsService, AiFileChangePayload, AiModification } from '../services/editor-actions.service';
import { SelectedFileService } from '../services/selected-file.service';

@Component({
    selector: 'app-code-editor',
    standalone: true,
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
    <style>
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .editor-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        position: relative;
      }
      .editor-codemirror-wrapper {
        flex: 1;
        position: relative;
        height: 100%;
      }
      .editor-header {
        flex-shrink: 0;
      }
      ::ng-deep .CodeMirror {
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }
    </style>
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
      position: relative;
    }
    .editor-header {
      padding: 8px;
      background-color: #3c3f41;
      border-bottom: 1px solid #323232;
      flex: 0 0 auto;
      z-index: 1;
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
      position: relative;
      height: calc(100% - 40px);
    }
    ::ng-deep .CodeMirror {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: 100%;
      width: 100%;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      line-height: 1.6;
      background-color: #2b2b2b;
      color: #a9b7c6;
    }
    ::ng-deep .CodeMirror-scroll {
      height: 100%;
      overflow-y: scroll;
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
    /* Style the scrollbars */
    ::ng-deep .CodeMirror-scroll::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }
    ::ng-deep .CodeMirror-scroll::-webkit-scrollbar-track {
      background: #2b2b2b;
    }
    ::ng-deep .CodeMirror-scroll::-webkit-scrollbar-thumb {
      background-color: #4a4a4a;
      border-radius: 6px;
      border: 3px solid #2b2b2b;
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
    private editorActions: EditorActionsService,
    private selectedFileService: SelectedFileService
  ) {
    // Subscribe to file structure changes
    this.subscriptions.push(
      this.collaborationService.fileStructureChanged$.subscribe(() => {
        // Reload file structure from localStorage
        const savedFiles = localStorage.getItem('fileStructure');
        if (savedFiles) {
          this.files = JSON.parse(savedFiles);
          
          // If we have a current file, check if it still exists
          if (this.file) {
            const currentFile = this.findFileNodeByPath(this.files, this.file.path);
            if (!currentFile) {
              // Current file was deleted, clear editor
              this.file = null;
              this.code = '';
            }
          }
        }
      }));
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

    // Apply AI changes to the currently open file when payloads arrive
    this.editorActions.aiChanges$.subscribe((changes: AiFileChangePayload[]) => {
      if (!changes || !this.file) return;
      const target = changes.find(c => c.file === this.file!.path);
      if (target && target.modifications && target.modifications.length > 0) {
        this.applyModificationsToCurrentDoc(target.modifications);
        // Update local state and selected file content
        const cm = this.codemirror?.codeMirror;
        const updated = cm ? cm.getValue() : this.code;
        this.code = updated;
        if (this.file) {
          this.file.content = updated;
        }
        // Persist to localStorage under fileStructure for consistency
        try {
          const raw = localStorage.getItem('fileStructure');
          if (raw) {
            const tree = JSON.parse(raw);
            const node = this.findFileNodeByPath(tree, this.file!.path);
            if (node) {
              node.content = updated;
              localStorage.setItem('fileStructure', JSON.stringify(tree));
            }
          }
        } catch {}
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
        // Update the selected file content in the service
        this.selectedFileService.updateSelectedFileContent(newCode);
        // Also update the fileStructure in localStorage
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

  // Apply line-based modifications to the current CodeMirror document
  private applyModificationsToCurrentDoc(mods: AiModification[]) {
    const cm = this.codemirror?.codeMirror;
    if (!cm) return;
    const doc = cm.getDoc();
    // Apply in a single operation for performance
    cm.operation(() => {
      // Sort modifications to avoid line index shifting issues: apply bottom-up by start_line
      const ordered = [...mods].sort((a, b) => b.start_line - a.start_line);
      for (const m of ordered) {
        const from = { line: Math.max(0, m.start_line - 1), ch: 0 };
        const toLine = Math.max(0, m.end_line - 1);
        const toCh = doc.getLine(toLine)?.length ?? 0;
        const to = { line: toLine, ch: toCh };
        const currentText = doc.getRange(from, to);

        // Optional verification of old_content; if mismatch, try to locate exact old_content
        if (m.old_content && m.old_content.trim() && currentText.trim() !== (m.old_content || '').trim()) {
          const foundPos = this.findTextInDoc(doc, m.old_content!);
          if (foundPos) {
            from.line = foundPos.from.line; from.ch = foundPos.from.ch;
            to.line = foundPos.to.line; to.ch = foundPos.to.ch;
          }
        }

        switch (m.operation) {
          case 'replace':
            doc.replaceRange(m.new_content || '', from, to);
            break;
          case 'delete':
            doc.replaceRange('', from, to);
            break;
          case 'insert_before': {
            const insertPos = { line: Math.max(0, m.start_line - 1), ch: 0 };
            doc.replaceRange((m.new_content || '') + '\n', insertPos);
            break;
          }
          case 'insert': {
            const insertPos = { line: Math.max(0, m.end_line - 1), ch: 0 };
            // Insert after the end_line by adding at the beginning of that line
            doc.replaceRange((m.new_content || '') + '\n', insertPos);
            break;
          }
        }
      }
    });
  }

  private findFileNodeByPath(nodes: any[], path: string): any | null {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.type === 'folder' && n.children) {
        const found = this.findFileNodeByPath(n.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  private findTextInDoc(doc: CodeMirror.Doc, text: string): { from: CodeMirror.Position, to: CodeMirror.Position } | null {
    // @ts-ignore: searchcursor is loaded as addon
    const cursor = (doc as any).cm.getSearchCursor(text, { line: 0, ch: 0 });
    if (cursor.findNext()) {
      return { from: cursor.from(), to: cursor.to() };
    }
    return null;
  }
}
