import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpEvent } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SelectedFileService } from './selected-file.service';
import { FileNode } from '../project-explorer/project-explorer.component';
import { EditorActionsService } from './editor-actions.service';
import { CollaborationService } from './collaboration.service';
import { Subject, Observable, from } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';

export interface AiStreamResponse {
  type: 'chunk' | 'complete' | 'progress' | 'stream';
  content?: string;
  loaded?: number;
  total?: number;
  body?: string;
}

export interface AiRequestFile {
  path: string;
  name: string;
  type: 'file';
  content: string;
}

export interface AiRequestFolder {
  path: string;
  name: string;
  type: 'folder';
  children: (AiRequestFile | AiRequestFolder)[];
}

export type AiOperation = 'replace' | 'insert' | 'delete' | 'insert_before';

export interface AiModification {
  operation: AiOperation;
  start_line: number;
  end_line: number;
  old_content?: string;
  new_content?: string;
}

export interface AiFileChangePayload {
  file: string;
  modifications: AiModification[];
}

export interface AiRequest {
  query: string;
  contextFiles: { path: string; content: string }[];
  workspaceTree?: any;
  sessionId?: string;
}

export interface AiResponseCodeChangeModification {
  operation: AiOperation;
  start_line: number;
  end_line: number;
  old_content?: string;
  new_content?: string;
}

export interface AiResponseCodeChangeItem {
  file: string;
  modifications: AiResponseCodeChangeModification[];
}

export interface AiResponseCodeChanges {
  type: 'code_changes';
  changes: AiResponseCodeChangeItem[];
  summary?: string;
}

export interface AiResponseCodeGenerationItem {
  file: string;
  content: string;
}

export interface AiResponseCodeGeneration {
  type: 'code_generation';
  changes: AiResponseCodeGenerationItem[];
  summary?: string;
}

export type AiStructuredResponse = AiResponseCodeChanges | AiResponseCodeGeneration | { content: string };

@Injectable({ providedIn: 'root' })
export class AiService {
  private fileStructureChanged = new Subject<void>();
  private contentCache = new Map<string, { content: string; timestamp: number }>();
  private readonly CACHE_DURATION = 5000; // 5 seconds cache
  private isLoadingSubject = new Subject<boolean>();
  private currentSessionId?: string;

  public fileStructureChanged$ = this.fileStructureChanged.asObservable();
  public isLoading$ = this.isLoadingSubject.asObservable();

  constructor(
    private http: HttpClient,
    private selectedFileService: SelectedFileService,
    private editorActions: EditorActionsService,
    private collaborationService: CollaborationService
  ) { }

  // Build structured request per user's expected format
  private async buildStructuredRequest(req: AiRequest): Promise<FormData> {
    const formData = new FormData();

    // Get or generate a session ID
    if (!this.currentSessionId) {
      this.currentSessionId = this.generateSessionId();
    }

    // Get workspace tree
    const workspaceTree = await this.getProjectTree();

    // Create the request metadata with all required fields
    const requestData: AiRequest = {
      query: req.query,
      contextFiles: req.contextFiles,
      workspaceTree: workspaceTree,
      sessionId: this.currentSessionId
    };

    // Add required fields to FormData
    formData.append('query', requestData.query);
    formData.append('session_id', requestData.sessionId || 'default');
    formData.append('model_name', ''); // Default to empty string

    // Add context files
    console.group('Context Files Debug');
    requestData.contextFiles.forEach(file => {
      console.log(`Adding file:`, {
        path: file.path,
        contentLength: file.content?.length || 0,
        content: file.content?.substring(0, 100) + '...' // Log first 100 chars
      });
      // Verify content is not undefined or empty
      if (!file.content) {
        console.warn(`Empty or undefined content for file: ${file.path}`);
      }
      formData.append('files', new Blob([file.content || ''], { type: 'text/plain' }), file.path);
    });
    console.groupEnd();

    // Add workspace tree if available
    if (requestData.workspaceTree && requestData.workspaceTree.length > 0) {
      formData.append('workspace_tree', JSON.stringify({
        root: '/',
        children: requestData.workspaceTree
      }));
    }

    return formData;
  }

  generateCode(req: AiRequest): Observable<AiStreamResponse> {
    this.isLoadingSubject.next(true);

    return from(this.buildStructuredRequest(req)).pipe(
      switchMap(formData => this.http.post(`${environment.apiAiUrl}/chat`, formData, {
        reportProgress: true,
        observe: 'events',
        responseType: 'text'
      })),
      map((event: HttpEvent<string>): AiStreamResponse => {
        switch (event.type) {
          case HttpEventType.UploadProgress:
            return {
              type: 'progress',
              loaded: event.loaded,
              total: event.total
            } as AiStreamResponse;
          case HttpEventType.DownloadProgress:
            if ('partialText' in event) {
              return {
                type: 'stream',
                content: (event as any).partialText
              } as AiStreamResponse;
            }
            break;
          case HttpEventType.Response:
            return {
              type: 'complete',
              body: event.body || ''
            } as AiStreamResponse;
        }
        return { type: 'chunk', content: '' } as AiStreamResponse;
      }),
      tap({
        error: (error) => {
          console.error('Error in generateCode:', error);
          this.isLoadingSubject.next(false);
        },
        complete: () => this.isLoadingSubject.next(false)
      })
    );
  }
  public async applyResponse(resp: AiStructuredResponse): Promise<{ appliedChangesCount: number; generatedFilesCount: number; summary?: string }> {

    console.group('Processing AI Response');
    console.log('Raw Response:', resp);

    if (!resp) {
      console.log('No response to process');
      console.groupEnd();
      return { appliedChangesCount: 0, generatedFilesCount: 0 };
    }

    let appliedChangesCount = 0;
    let generatedFilesCount = 0;
    let summary: string | undefined = (resp as any).summary;

    if ((resp as any).type === 'code_changes') {
      console.log('Processing code changes...');
      const r = resp as AiResponseCodeChanges;
      console.log('Changes to apply:', r.changes);
      appliedChangesCount = await this.applyCodeChanges(r.changes);
      console.log(`Applied ${appliedChangesCount} code changes`);
    } else if ((resp as any).type === 'code_generation') {
      console.log('Processing code generation...');
      const r = resp as AiResponseCodeGeneration;
      console.log('Files to generate:', r.changes);
      generatedFilesCount = await this.applyCodeGeneration(r.changes);
      console.log(`Generated ${generatedFilesCount} files`);
    } else if ((resp as any).content) {
      console.log('Processing plain content response');
      // Plain assistant content
      summary = (resp as any).content;
    }

    const result = { appliedChangesCount, generatedFilesCount, summary };
    console.log('Final result:', result);
    console.groupEnd();
    return result;
  }

  private async applyCodeChanges(changes: AiResponseCodeChangeItem[]): Promise<number> {
    if (!Array.isArray(changes) || changes.length === 0) return 0;

    // Broadcast to CodeEditor for current file, and update others via localStorage
    const payloads: AiFileChangePayload[] = changes.map(c => ({
      file: c.file,
      modifications: c.modifications as AiModification[]
    }));

    this.editorActions.applyAiChanges(payloads);

    // Also persist updates for non-open files in localStorage
    try {
      const raw = localStorage.getItem('fileStructure');
      if (raw) {
        const tree: FileNode[] = JSON.parse(raw);
        for (const change of changes) {
          const node = this.findFileNodeByPath(tree, change.file);
          if (node) {
            const original = node.content || '';
            const updated = this.applyModsToText(original, change.modifications);
            node.content = updated;
          }
        }
        localStorage.setItem('fileStructure', JSON.stringify(tree));
      }
    } catch (err) {
      console.error('Error persisting code changes to localStorage', err);
    }

    return changes.length;
  }

  private applyModsToText(text: string, mods: AiResponseCodeChangeModification[]): string {
    if (!mods || mods.length === 0) return text;
    const lines = text.split('\n');
    // Apply bottom-up to keep indices stable
    const ordered = [...mods].sort((a, b) => b.start_line - a.start_line);
    for (const m of ordered) {
      const startIdx = Math.max(0, m.start_line - 1);
      const endIdx = Math.max(0, m.end_line - 1);
      const rangeText = lines.slice(startIdx, endIdx + 1).join('\n');
      // Try to verify old_content; if mismatch, attempt global text replacement
      if (m.old_content && m.old_content.trim() && rangeText.trim() !== (m.old_content || '').trim()) {
        // Fallback: global replace first occurrence
        if (m.operation === 'replace' && m.new_content) {
          const idx = text.indexOf(m.old_content!);
          if (idx >= 0) {
            text = text.slice(0, idx) + m.new_content + text.slice(idx + m.old_content!.length);
            // Recompute lines after replacement for subsequent ops
            const newLines = text.split('\n');
            for (let i = 0; i < newLines.length; i++) lines[i] = newLines[i];
            continue;
          }
        }
      }
      switch (m.operation) {
        case 'replace': {
          const newLines = (m.new_content || '').split('\n');
          lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
          break;
        }
        case 'delete': {
          lines.splice(startIdx, endIdx - startIdx + 1);
          break;
        }
        case 'insert_before': {
          const newLines = (m.new_content || '').split('\n');
          lines.splice(startIdx, 0, ...newLines);
          break;
        }
        case 'insert': {
          const newLines = (m.new_content || '').split('\n');
          lines.splice(endIdx + 1, 0, ...newLines);
          break;
        }
      }
    }
    return lines.join('\n');
  }

  private async applyCodeGeneration(changes: AiResponseCodeGenerationItem[]): Promise<number> {
    if (!Array.isArray(changes) || changes.length === 0) return 0;
    try {
      const raw = localStorage.getItem('fileStructure');
      const tree: FileNode[] = raw ? JSON.parse(raw) : [];
      for (const ch of changes) {
        this.ensurePathAndAddFile(tree, ch.file, ch.content || '');
        // Notify explorer to add file
        this.collaborationService.ensureFileExists(ch.file, ch.content || '');
      }
      localStorage.setItem('fileStructure', JSON.stringify(tree));
      // Notify about structure change
      this.notifyFileStructureChanged();
      // Also notify the collaboration service so components relying on it can refresh
      this.collaborationService.notifyFileStructureChanged();
    } catch (err) {
      console.error('Error applying code generation', err);
    }
    return changes.length;
  }

  private ensurePathAndAddFile(tree: FileNode[], fullPath: string, content: string) {
    const parts = fullPath.split('/').filter(Boolean);
    let current: FileNode[] = tree;
    let constructedPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      constructedPath = constructedPath ? `${constructedPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      let node = current.find(n => n.name === part);
      if (!node) {
        node = {
          name: part,
          type: isLast ? 'file' : 'folder',
          children: isLast ? undefined : [],
          path: constructedPath,
          content: isLast ? content : undefined,
          isExpanded: true
        };
        current.push(node);
      } else if (isLast) {
        node.type = 'file';
        node.content = content;
        node.path = constructedPath;
      }
      if (!isLast) {
        if (!node.children) node.children = [];
        current = node.children;
      }
    }
  }

  async getFileContext(): Promise<string | null> {
    const currentFile = this.selectedFileService.getSelectedFile();
    if (!currentFile) {
      alert('Please select a file first');
      return null;
    }

    try {
      // Here you would typically read the file contents
      // Try to read from project structure stored in localStorage first
      const fileContent = await this.readFileContent(currentFile.path);
      return `File: ${currentFile.path}\n\nContent:\n${fileContent}`;
    } catch (error) {
      console.error('Error getting file context:', error);
      return null;
    }
  }

  async getFolderContext(): Promise<string | null> {
    try {
      // This is a placeholder - implement actual folder structure reading logic
      const folderStructure = await this.readFolderStructure();
      return `Folder Structure:\n${folderStructure}`;
    } catch (error) {
      console.error('Error getting folder context:', error);
      return null;
    }
  }

  private async readFileContent(filePath: string): Promise<string> {
    try {
      console.group(`Reading file content: ${filePath}`);
      
      // Check cache first
      const cached = this.contentCache.get(filePath);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
        console.log(`Using cached content for ${filePath}`, {
          contentLength: cached.content.length,
          preview: cached.content.substring(0, 100) + '...'
        });
        console.groupEnd();
        return cached.content;
      }

      let content: string | null = null;

      // Try to get content from currently selected file in editor
      const currentFile = this.selectedFileService.getSelectedFile();
      if (currentFile && currentFile.path === filePath && currentFile.content !== undefined) {
        content = currentFile.content;
      }

      // If not found, try to get from localStorage fileStructure
      if (!content) {
        const raw = localStorage.getItem('fileStructure');
        if (raw) {
          const tree: FileNode[] = JSON.parse(raw);
          const node = this.findFileNodeByPath(tree, filePath);
          if (node && node.content !== undefined) {
            content = node.content;
          }
        }
      }

      // If still not found, try workspace_files
      if (!content) {
        const raw2 = localStorage.getItem('workspace_files');
        if (raw2) {
          const files = JSON.parse(raw2);
          const file = files.find((f: any) => f.path === filePath);
          if (file && file.content !== undefined) {
            content = file.content;
          }
        }
      }

      if (content !== null) {
        console.log('Found content from source:', {
          contentLength: content.length,
          preview: content.substring(0, 100) + '...'
        });
        // Cache the found content
        this.contentCache.set(filePath, {
          content,
          timestamp: Date.now()
        });
        console.groupEnd();
        return content;
      }

      console.warn(`No content found for file: ${filePath}`);
      console.log('Checked sources:', {
        editor: Boolean(this.selectedFileService.getSelectedFile()),
        fileStructure: Boolean(localStorage.getItem('fileStructure')),
        workspaceFiles: Boolean(localStorage.getItem('workspace_files'))
      });
      console.groupEnd();
      return 'No content available for this file';
    } catch (err) {
      console.error('readFileContent error for file:', filePath, err);
      console.groupEnd();
      return `Error reading content for ${filePath}`;
    }
  }

  private async readFolderStructure(): Promise<string> {
    try {
      const raw = localStorage.getItem('fileStructure');
      if (!raw) return 'No file structure available';
      const tree: FileNode[] = JSON.parse(raw);
      return this.stringifyTree(tree);
    } catch (err) {
      console.error('readFolderStructure error', err);
      return 'Error reading folder structure';
    }
  }

  // Helper to find a node by path
  private findFileNodeByPath(nodes: FileNode[], path: string): FileNode | null {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.type === 'folder' && n.children) {
        const found = this.findFileNodeByPath(n.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  // Helper that returns a simple textual representation of tree
  private stringifyTree(nodes: FileNode[], depth = 0): string {
    let out = '';
    const pad = (d: number) => '  '.repeat(d);
    for (const n of nodes) {
      out += `${pad(depth)}- ${n.name} (${n.type})\n`;
      if (n.type === 'folder' && n.children) {
        out += this.stringifyTree(n.children, depth + 1);
      }
    }
    return out;
  }

  // Generate a unique session ID
  private generateSessionId(): string {
    const timestamp = new Date().getTime();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}`;
  }

  // Get current session ID
  getCurrentSessionId(): string {
    return this.currentSessionId || this.generateSessionId();
  }

  // Return parsed project tree from localStorage
  async getProjectTree(): Promise<FileNode[]> {
    try {
      const raw = localStorage.getItem('fileStructure');
      if (!raw) return [];
      const tree: FileNode[] = JSON.parse(raw);
      return tree;
    } catch (err) {
      console.error('getProjectTree error', err);
      return [];
    }
  }

  // Public wrapper to fetch a file's content by path
  async fetchFileContent(path: string): Promise<string> {
    return this.readFileContent(path);
  }

  private async convertWorkspaceTree(nodes: FileNode[]): Promise<(AiRequestFile | AiRequestFolder)[]> {
    const result: (AiRequestFile | AiRequestFolder)[] = [];

    for (const node of nodes) {
      if (node.type === 'file') {
        // Only include structural information, not content
        result.push({
          path: node.path,
          name: node.name,
          type: 'file',
          content: '' // Empty content in workspace tree
        });
      } else {
        // It's a folder
        const children = node.children ? await this.convertWorkspaceTree(node.children) : [];
        result.push({
          path: node.path,
          name: node.name,
          type: 'folder',
          children
        });
      }
    }

    return result;
  }

  // Notify subscribers that file structure has changed
  private notifyFileStructureChanged(): void {
    this.fileStructureChanged.next();
  }
}