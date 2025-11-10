import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, AiStreamResponse } from '../services/ai.service';
import { FileNode } from '../project-explorer/project-explorer.component';
import { Subscription } from 'rxjs';

interface Message {
  type: 'user' | 'assistant';
  content: string;
  context?: string;
  metadata?: {
    appliedChanges?: number;
    generatedFiles?: number;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

interface BackendResponse {
  type: string;
  parsed?: {
    type: 'code_generation' | 'code_changes';
    changes: any[];
    summary?: string;
  };
  session_id: string;
  is_code_change: boolean;
  request_type: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

@Component({
  selector: 'app-ai-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-panel.component.html',
  styleUrls: ['./ai-panel.component.css']
})
export class AiPanelComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  // UI State
  messages: Message[] = [];
  userInput = '';
  selectedModel = 'claude sonnet 4.5';
  isProcessing = false;
  private shouldScrollToBottom = false;

  // Context management
  selectedContexts: string[] = [];
  selectedContextItems = new Set<string>();
  showContextPicker = false;

  // Project structure
  projectTree: FileNode[] = [];
  flatList: Array<{ node: FileNode; depth: number; path: string }> = [];

  // Subscriptions
  private subscription?: Subscription;
  private loadingSubscription?: Subscription;

  constructor(private aiService: AiService) {}

  ngOnInit(): void {
    this.loadSavedMessages();
    this.loadProjectTree();

    // Subscribe to file structure changes
    this.subscription = this.aiService.fileStructureChanged$.subscribe(() => {
      this.loadProjectTree();
    });

    // Subscribe to loading state
    this.loadingSubscription = this.aiService.isLoading$.subscribe(isLoading => {
      this.isProcessing = isLoading;
      if (isLoading) {
        this.shouldScrollToBottom = true;
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.loadingSubscription?.unsubscribe();
    this.saveMessages();
  }

  // LocalStorage handling
  private loadSavedMessages(): void {
    const saved = localStorage.getItem('ai_panel_messages');
    if (saved) {
      try {
        this.messages = JSON.parse(saved);
        this.shouldScrollToBottom = true;
      } catch (err) {
        console.error('Error loading saved messages:', err);
      }
    }
  }

  private saveMessages(): void {
    try {
      localStorage.setItem('ai_panel_messages', JSON.stringify(this.messages));
    } catch (err) {
      console.error('Error saving messages:', err);
    }
  }

  // Scroll to bottom
  private scrollToBottom(): void {
    try {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  // Project tree loading and flattening
  async loadProjectTree(): Promise<void> {
    this.projectTree = await this.aiService.getProjectTree();
    this.flatList = [];
    this.flattenTree(this.projectTree, 0, '');
  }

  private flattenTree(nodes: FileNode[], depth: number, parentPath: string): void {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.name}` : node.path || node.name;
      this.flatList.push({ node, depth, path });

      if (node.type === 'folder' && node.children) {
        this.flattenTree(node.children, depth + 1, path);
      }
    }
  }

  trackByPath(index: number, item: { path: string }): string {
    return item.path;
  }

  // Context picker
  toggleContextPicker(): void {
    this.showContextPicker = !this.showContextPicker;
    if (this.showContextPicker && this.flatList.length === 0) {
      this.loadProjectTree();
    }
  }

  closeContextPicker(): void {
    this.showContextPicker = false;
  }

  toggleSelect(path: string): void {
    if (this.selectedContextItems.has(path)) {
      this.selectedContextItems.delete(path);
    } else {
      this.selectedContextItems.add(path);
    }
  }

  shortContextLabel(ctx: string): string {
    return ctx.length > 80 ? ctx.slice(0, 80) + '...' : ctx;
  }

  // Send message with streaming
  async sendMessage(): Promise<void> {
    if (!this.userInput.trim() || this.isProcessing) return;

    console.group('AI Request');
    console.log('Starting new request...');

    const contextFiles = await Promise.all(
      this.selectedContexts.map(async (path) => {
        const content = await this.aiService.fetchFileContent(path);
        console.log(`Context file loaded: ${path}, content length: ${content.length}`);
        return { path, content };
      }));

    const userMessage: Message = {
      type: 'user',
      content: this.userInput,
      context: contextFiles.length > 0
        ? `Using context from: ${contextFiles.map(c => this.getContextName(c.path)).join(', ')}`
        : undefined
    };

    this.messages.push(userMessage);
    this.saveMessages();
    this.shouldScrollToBottom = true;

    const input = this.userInput;
    this.userInput = '';
    this.selectedContexts = [];
    this.selectedContextItems.clear();

    // Reset textarea height
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
    }

    // Assistant message placeholder
    const assistantMessage: Message = { type: 'assistant', content: '' };
    this.messages.push(assistantMessage);

    // Log the request structure
    const aiRequest = {
      query: input,
      contextFiles: contextFiles,
      workspaceTree: undefined,
      sessionId: undefined
    };
    
    console.group('AI Request Details');
    console.log('Full Request:', aiRequest);
    console.log('Query:', aiRequest.query);
    console.log('Context Files:', aiRequest.contextFiles.map(cf => ({
      path: cf.path,
      contentLength: cf.content.length
    })));
    console.groupEnd();

    // Stream response
    this.aiService.generateCode(aiRequest).subscribe({
      next: (event) => {
        console.group('AI Response Event');
        console.log('Event type:', event.type);
        console.log('Full event:', event);

        switch (event.type) {
          case 'progress':
            console.log(`Upload progress: ${event.loaded}/${event.total}`);
            break;

          case 'stream':
            if (event.content) {
              console.log('Stream content received:', event.content);
              try {
                const parsedContent = JSON.parse(event.content);
                console.log('Parsed stream content:', parsedContent);
                
                if (parsedContent.parsed?.summary) {
                  console.log('Found summary:', parsedContent.parsed.summary);
                  assistantMessage.content = parsedContent.parsed.summary;
                } else if (parsedContent.error) {
                  console.error('Error in response:', parsedContent.error);
                  assistantMessage.content = `Error: ${parsedContent.error}`;
                }
              } catch (error) {
                console.log('Raw content (not JSON):', event.content);
                assistantMessage.content += event.content;
              }
              this.shouldScrollToBottom = true;
              this.saveMessages();
            }
            break;

          case 'complete':
            console.group('Complete Response');
            if (event.body) {
              console.log('Raw response body:', event.body);
              try {
                const response = JSON.parse(event.body);
                console.log('Parsed complete response:', response);

                if (response.error) {
                  console.error('Error in complete response:', response.error);
                  assistantMessage.content = `Error: ${response.error}`;
                } else if (response.parsed?.summary) {
                  console.log('Found summary in complete response:', response.parsed.summary);
                  assistantMessage.content = response.parsed.summary;

                  // Process code changes internally
                  if (response.parsed.type === 'code_generation' || response.parsed.type === 'code_changes') {
                    console.log('Processing code changes/generation:', response.parsed);
                    this.aiService.applyResponse(response.parsed).then(result => {
                      console.log('Apply response result:', result);
                      if (result.appliedChangesCount > 0) {
                        assistantMessage.content += `\n\nApplied ${result.appliedChangesCount} code changes.`;
                      }
                      if (result.generatedFilesCount > 0) {
                        assistantMessage.content += `\n\nGenerated ${result.generatedFilesCount} new files.`;
                      }
                      
                      // Add usage information if available
                      if (response.usage) {
                        console.log('Usage stats:', response.usage);
                        assistantMessage.metadata = {
                          ...assistantMessage.metadata,
                          usage: response.usage
                        };
                      }
                      
                      this.saveMessages();
                    }).catch(error => {
                      console.error('Error applying changes:', error);
                      assistantMessage.content += `\n\nError applying changes: ${error.message}`;
                      this.saveMessages();
                    });
                  }
                }
              } catch (error) {
                console.error('Error parsing complete response:', error);
                // Only show the body if it's a valid message
                if (typeof event.body === 'string' && event.body.trim()) {
                  assistantMessage.content = event.body;
                }
              }
            }
            console.groupEnd(); // Complete Response
            this.isProcessing = false;
            this.saveMessages();
            break;
        }
        console.groupEnd(); // AI Response Event
      },
      error: (error) => {
        console.group('AI Response Error');
        console.error('Full error:', error);
        console.groupEnd();
        
        assistantMessage.content += '\n\nSorry, there was an error processing your request.';
        this.isProcessing = false;
        this.saveMessages();
        this.shouldScrollToBottom = true;
      },
      complete: () => {
        console.log('Request completed');
        console.groupEnd(); // AI Request
        this.isProcessing = false;
        this.saveMessages();
      }
    });
  }

  // Context helpers
  async addFileContext(): Promise<void> {
    const context = await this.aiService.getFileContext();
    if (context && !this.selectedContexts.includes(context)) {
      this.selectedContexts.push(context);
    }
  }

  async addFolderContext(): Promise<void> {
    const context = await this.aiService.getFolderContext();
    if (context && !this.selectedContexts.includes(context)) {
      this.selectedContexts.push(context);
    }
  }

  clearContext(): void {
    this.selectedContexts = [];
    this.selectedContextItems.clear();
  }

  async selectAndAddContext(path: string): Promise<void> {
    const node = this.findNodeInFlatList(path);
    if (!node) return;
    await this.addContextFromNode(node, path);
  }

  async addContextFromNode(node: FileNode, path: string): Promise<void> {
    if (!this.selectedContexts.includes(path)) {
      this.selectedContexts.push(path);
    }
    this.closeContextPicker();
  }

  removeContext(context: string): void {
    this.selectedContexts = this.selectedContexts.filter(ctx => ctx !== context);
    this.selectedContextItems.delete(context);
  }

  isFolder(path: string): boolean {
    const item = this.flatList.find(i => i.path === path);
    return item?.node.type === 'folder';
  }

  getContextName(path: string): string {
    const item = this.flatList.find(i => i.path === path);
    return item ? item.node.name : path.split('/').pop() || path;
  }

  findNodeInFlatList(path: string): FileNode | null {
    const found = this.flatList.find(f => f.path === path);
    return found ? found.node : null;
  }

  // Utility: stringify node (for debugging or context)
  stringifyNode(node: FileNode, depth = 0): string {
    const pad = ' '.repeat(depth * 2);
    let out = `${pad}- ${node.name} (${node.type})\n`;

    if (node.type === 'folder' && node.children) {
      for (const child of node.children) {
        out += this.stringifyNode(child, depth + 1);
      }
    } else if (node.type === 'file') {
      out += `${pad}  Content: ${node.content ? '\n' + node.content : 'No content'}\n`;
    }
    return out;
  }

  // Input handlers
  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  autoResizeTextarea(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}