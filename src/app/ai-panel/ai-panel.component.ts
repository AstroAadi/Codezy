import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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
  templateUrl: './ai-panel.component.html',
  styleUrls: ['./ai-panel.component.css']
})
export class AiPanelComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  
  messages: Message[] = [];
  userInput = '';
  selectedModel = 'claude sonnet 4.5';
  selectedContext: string | null = null;
  selectedContexts: string[] = [];

  showContextPicker = false;
  projectTree: FileNode[] = [];
  flatList: Array<{ node: FileNode; depth: number; path: string }> = [];
  selectedContextItems = new Set<string>();
  
  private shouldScrollToBottom = false;

  constructor(private aiService: AiService ) {}

  async ngOnInit() {
    await this.loadProjectTree();
  }
  
  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }
  
  private scrollToBottom(): void {
    try {
      this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
    } catch (err) { 
      console.error('Error scrolling to bottom:', err);
    }
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

    // Create context string from all selected contexts
    let contextString = '';
    if (this.selectedContexts.length > 0) {
      for (const contextPath of this.selectedContexts) {
        const node = this.findNodeInFlatList(contextPath);
        if (node) {
          if (node.type === 'file') {
            const content = await this.aiService.fetchFileContent(node.path || contextPath);
            contextString += `File: ${node.name}\n\n${content}\n\n`;
          } else {
            contextString += `Folder: ${node.name}\n\n${this.stringifyNode(node)}\n\n`;
          }
        }
      }
    }

    const userMessage: Message = {
      type: 'user',
      content: this.userInput,
      context: contextString || undefined
    };

    this.messages.push(userMessage);
    this.shouldScrollToBottom = true;
    
    const input = this.userInput;
    this.userInput = '';
    this.selectedContext = null;
    
    // Clear contexts after sending message
    this.selectedContexts = [];
    
    // Reset textarea height to default
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
    }

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
      this.shouldScrollToBottom = true;
    } catch (error) {
      this.messages.push({
        type: 'assistant',
        content: 'Sorry, there was an error processing your request.'
      });
      this.shouldScrollToBottom = true;
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

  // Clear the selected contexts
  clearContext(): void {
    this.selectedContexts = [];
  }

  // Select and add context directly when an item is clicked
  async selectAndAddContext(path: string) {
    const node = this.findNodeInFlatList(path);
    if (!node) return;
    
    this.addContextFromNode(node, path);
  }
  
  async addContextFromNode(node: FileNode, path: string) {
    if (node.type === 'file') {
      if (!this.selectedContexts.includes(path)) {
        this.selectedContexts.push(path);
      }
    } else {
      if (!this.selectedContexts.includes(path)) {
        this.selectedContexts.push(path);
      }
    }
    
    this.closeContextPicker();
  }
  
  removeContext(context: string) {
    this.selectedContexts = this.selectedContexts.filter(ctx => ctx !== context);
  }

  isFolder(path: string): boolean {
    const item = this.flatList.find(item => item.path === path);
    return item ? item.node.type === 'folder' : false;
  }

  getContextName(path: string): string {
    const item = this.flatList.find(item => item.path === path);
    return item ? item.node.name : path.split('/').pop() || path;
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
  
  autoResizeTextarea(event: any) {
    const textarea = event.target;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}