import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../services/ai.service';
import { FileNode } from '../project-explorer/project-explorer.component';

interface Message {
  type: 'user' | 'assistant';
  content: string;
  context?: string;
}

@Component({
  selector: 'app-ai-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ai-panel">
      <div class="ai-header">
        <div class="title">AI Assistant</div>
        <div class="header-actions">
          <select [(ngModel)]="selectedModel" class="model-select">
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5">GPT-3.5</option>
          </select>
        </div>
      </div>

      <div class="chat-container">
        <div class="messages" #messagesContainer>
          <div *ngFor="let message of messages" class="message-row" [ngClass]="message.type">
            <div class="avatar" [ngClass]="{'user': message.type === 'user', 'assistant': message.type === 'assistant'}">
              <span *ngIf="message.type === 'assistant'">AI</span>
              <span *ngIf="message.type === 'user'">U</span>
            </div>
            <div class="bubble">
              <div class="message-content">{{ message.content }}</div>
              <div *ngIf="message.context" class="context-info">
                <small>{{ message.context }}</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="input-container">
        <div class="selected-contexts" *ngIf="selectedContext">
          <div class="context-chip">Context: <strong>{{ shortContextLabel(selectedContext) }}</strong></div>
        </div>

        <div class="context-controls">
          <button (click)="toggleContextPicker()" class="context-btn">Add Context</button>
          <div class="context-picker" *ngIf="showContextPicker">
            <div class="picker-list">
              <div *ngFor="let item of flatList; trackBy: trackByPath" class="picker-item">
                <label [style.paddingLeft.px]="item.depth * 12">
                  <input type="checkbox" [checked]="selectedContextItems.has(item.path)" (change)="toggleSelect(item.path)" />
                  <span [class.folder]="item.node.type === 'folder'">{{ item.node.name }}</span>
                </label>
              </div>
            </div>
            <div class="picker-actions">
              <button (click)="addSelectedContext()">Add Selected</button>
              <button (click)="closeContextPicker()">Close</button>
            </div>
          </div>
        </div>

        <div class="message-input">
          <textarea 
            [(ngModel)]="userInput" 
            placeholder="Ask me anything..."
            (keydown)="handleKeydown($event)"
            rows="3"
          ></textarea>
          <button (click)="sendMessage()" [disabled]="!userInput.trim()">Send</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ai-panel { display:flex; flex-direction:column; height:100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
    .ai-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--vscode-panel-border); }
    .ai-header .title { font-weight:600; }
    .chat-container { flex:1; overflow:auto; padding:12px; }
    .messages { display:flex; flex-direction:column; gap:12px; }
    .message-row { display:flex; gap:10px; align-items:flex-start; }
    .message-row.user { justify-content:flex-end; }
    .avatar { width:36px; height:36px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-weight:600; color:var(--vscode-editor-foreground); }
    .avatar.user { background: var(--vscode-button-background); }
    .avatar.assistant { background: var(--vscode-input-background); }
    .bubble { max-width:75%; background:var(--vscode-editor-background); border-radius:8px; padding:10px; box-shadow: var(--vscode-widget-shadow); border:1px solid var(--vscode-editorWidget-border); }
    .message-row.user .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .message-content { white-space:pre-wrap; }
    .context-info { margin-top:6px; font-size:12px; opacity:0.8; color:var(--vscode-descriptionForeground); }
    .input-container { padding:12px; border-top:1px solid var(--vscode-panel-border); }
    .selected-contexts { margin-bottom:8px; }
    .context-chip { display:inline-block; padding:6px 10px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); border-radius:16px; font-size:12px; }
    .context-controls { display:flex; gap:8px; align-items:center; position:relative; }
    .context-btn { padding:6px 10px; border-radius:6px; border:none; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); cursor:pointer; }
    .model-select { padding:6px; border-radius:6px; background:var(--vscode-dropdown-background); color:var(--vscode-dropdown-foreground); border:1px solid var(--vscode-dropdown-border); }
    .message-input { display:flex; gap:8px; margin-top:8px; }
    textarea { flex:1; padding:10px; border-radius:8px; border:1px solid var(--vscode-input-border); background:var(--vscode-input-background); color:var(--vscode-input-foreground); resize:none; }
    button { padding:8px 12px; border-radius:6px; border:none; background:var(--vscode-button-background); color:var(--vscode-button-foreground); cursor:pointer; }

    /* context picker */
    .context-picker { position:absolute; top:38px; left:0; width:320px; max-height:320px; overflow:auto; background:var(--vscode-sideBar-background); border:1px solid var(--vscode-panel-border); box-shadow: var(--vscode-widget-shadow); padding:10px; z-index:50; border-radius:6px; }
    .picker-list { max-height:240px; overflow:auto; }
    .picker-item { padding:6px 4px; font-size:13px; }
    .picker-item label { cursor:pointer; display:flex; align-items:center; gap:8px; }
    .picker-item .folder { font-weight:600; }
    .picker-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
  `]
})
export class AiPanelComponent {
  messages: Message[] = [];
  userInput = '';
  selectedModel = 'gpt-4';
  selectedContext: string | null = null;

  showContextPicker = false;
  projectTree: FileNode[] = [];
  flatList: Array<{ node: FileNode; depth: number; path: string }> = [];
  selectedContextItems = new Set<string>();

  constructor(private aiService: AiService ) {}

  async ngOnInit() {
    await this.loadProjectTree();
  }

  async loadProjectTree() {
    this.projectTree = await this.aiService.getProjectTree();
    this.flatList = [];
    this.flattenTree(this.projectTree, 0, '');
  }

  flattenTree(nodes: FileNode[], depth: number, parentPath: string) {
    for (const n of nodes) {
      const path = parentPath ? `${parentPath}/${n.name}` : n.path || n.name;
      this.flatList.push({ node: n, depth, path });
      if (n.type === 'folder' && n.children) {
        this.flattenTree(n.children, depth + 1, path);
      }
    }
  }

  trackByPath(_: number, item: {node: FileNode; depth:number; path:string}) { return item.path; }

  toggleContextPicker() {
    this.showContextPicker = !this.showContextPicker;
    if (this.showContextPicker && this.flatList.length === 0) {
      this.loadProjectTree();
    }
  }

  closeContextPicker() { this.showContextPicker = false; }

  toggleSelect(path: string) {
    if (this.selectedContextItems.has(path)) this.selectedContextItems.delete(path);
    else this.selectedContextItems.add(path);
  }

  shortContextLabel(ctx: string) {
    return ctx.length > 80 ? ctx.slice(0,80) + '...' : ctx;
  }

  async sendMessage() {
    if (!this.userInput.trim()) return;

    const userMessage: Message = {
      type: 'user',
      content: this.userInput,
      context: this.selectedContext || undefined
    };

    this.messages.push(userMessage);
    const input = this.userInput;
    this.userInput = '';
    this.selectedContext = null;

    try {
      const response = await this.aiService.sendMessage({
        message: input,
        model: this.selectedModel,
        context: this.selectedContext || undefined
      });

      this.messages.push({
        type: 'assistant',
        content: response.content
      });
    } catch (error) {
      this.messages.push({
        type: 'assistant',
        content: 'Sorry, there was an error processing your request.'
      });
    }
  }

  async addFileContext() {
    // preserve legacy behavior: get currently selected file from SelectedFileService
    const context = await this.aiService.getFileContext();
    if (context) this.selectedContext = context;
  }

  async addFolderContext() {
    // preserve legacy behavior
    const context = await this.aiService.getFolderContext();
    if (context) this.selectedContext = context;
  }

  // Adds all selected items from the picker into the current context
  async addSelectedContext() {
    if (this.selectedContextItems.size === 0) {
      alert('Select files or folders to add as context');
      return;
    }

    const parts: string[] = [];
    for (const path of Array.from(this.selectedContextItems)) {
      // find node
      const node = this.findNodeInFlatList(path);
      if (!node) continue;
      if (node.type === 'file') {
        const content = await this.aiService.fetchFileContent(node.path || path);
        parts.push(`File: ${node.path || node.name}\n\n${content}`);
      } else {
        // folder -> stringify its children
        parts.push(`Folder: ${node.path || node.name}\n\n${this.stringifyNode(node)}`);
      }
    }

    this.selectedContext = parts.join('\n\n----\n\n');
    this.selectedContextItems.clear();
    this.showContextPicker = false;
  }

  findNodeInFlatList(path: string): FileNode | null {
    const found = this.flatList.find(f => f.path === path);
    return found ? found.node : null;
  }

  // Simple stringify for a node subtree
  stringifyNode(node: FileNode, depth = 0): string {
    const pad = (d:number) => '  '.repeat(d);
    let out = `${pad(depth)}- ${node.name} (${node.type})\n`;
    if (node.type === 'folder' && node.children) {
      for (const c of node.children) out += this.stringifyNode(c, depth + 1);
    } else if (node.type === 'file') {
      out += `${pad(depth+1)}Content: ${node.content ? '\n' + node.content : 'No content available'}\n`;
    }
    return out;
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }
}