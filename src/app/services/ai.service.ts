import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SelectedFileService } from './selected-file.service';
import { FileNode } from '../project-explorer/project-explorer.component';
import { EditorActionsService, AiFileChangePayload, AiModification } from './editor-actions.service';
import { CollaborationService } from './collaboration.service';

import { Subject } from 'rxjs';

interface StructuredAiRequestContextFile {
  path: string;
  content: string;
  type: 'file';
  name: string;
}

interface StructuredAiRequestContextFolder {
  path: string;
  type: 'folder';
  name: string;
  children: (StructuredAiRequestContextFile | StructuredAiRequestContextFolder)[];
}

interface StructuredAiRequestContext {
  // Currently selected files in editor
  open_files: StructuredAiRequestContextFile[];
  // Files selected for context in AI panel
  context_files: StructuredAiRequestContextFile[];
  // Full workspace structure
  workspace_tree: {
    root: string;
    children: (StructuredAiRequestContextFile | StructuredAiRequestContextFolder)[];
  };
}

export interface StructuredAiRequest {
  query: string;
  context: StructuredAiRequestContext;
  session_id?: string;
}

type AiOperation = 'replace' | 'insert' | 'delete' | 'insert_before';

interface AiResponseCodeChangeModification {
  operation: AiOperation;
  start_line: number;
  end_line: number;
  old_content?: string;
  new_content?: string;
}

interface AiResponseCodeChangeItem {
  file: string;
  modifications: AiResponseCodeChangeModification[];
}

interface AiResponseCodeChanges {
  type: 'code_changes';
  changes: AiResponseCodeChangeItem[];
  summary?: string;
}

interface AiResponseCodeGenerationItem {
  file: string;
  content: string;
}

interface AiResponseCodeGeneration {
  type: 'code_generation';
  changes: AiResponseCodeGenerationItem[];
  summary?: string;
}

type AiStructuredResponse = AiResponseCodeChanges | AiResponseCodeGeneration | { content: string };

interface BackendResponse {
  response: string;
  parsed: AiStructuredResponse | null;
  session_id: string;
  is_code_change: boolean;
  request_type: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private fileStructureChanged = new Subject<void>();
  private currentSessionId: string | null = null;
  private contentCache = new Map<string, { content: string; timestamp: number }>();
  private readonly CACHE_DURATION = 5000; // 5 seconds cache
  private isLoadingSubject = new Subject<boolean>();

  fileStructureChanged$ = this.fileStructureChanged.asObservable();
  isLoading$ = this.isLoadingSubject.asObservable();

  constructor(
    private http: HttpClient,
    private selectedFileService: SelectedFileService,
    private editorActions: EditorActionsService,
    private collaborationService: CollaborationService
  ) {
    // Initialize session ID if not exists
    this.currentSessionId = localStorage.getItem('ai_session_id');
    if (!this.currentSessionId) {
      this.currentSessionId = this.generateSessionId();
      localStorage.setItem('ai_session_id', this.currentSessionId);
    }
  }

  // Build structured request per user's expected format
  async buildStructuredRequest(query: string, selectedContexts: string[] = []): Promise<StructuredAiRequest> {
    const openFiles: StructuredAiRequestContextFile[] = [];
    const contextFiles: StructuredAiRequestContextFile[] = [];
    
    // Add currently selected file in editor with its content
    const selected = this.selectedFileService.getSelectedFile();
    if (selected && selected.type === 'file') {
      const content = await this.readFileContent(selected.path);
      console.log(`Adding open file: ${selected.path} (content length: ${content.length})`);
      openFiles.push({ 
        path: selected.path, 
        content,
        type: 'file',
        name: selected.name
      });
    }

    // Add selected context files with their content
    for (const path of selectedContexts) {
      // Don't add duplicates
      if (!openFiles.some(f => f.path === path) && !contextFiles.some(f => f.path === path)) {
        const content = await this.readFileContent(path);
        const name = path.split('/').pop() || path;
        console.log(`Adding context file: ${path} (content length: ${content.length})`);
        contextFiles.push({ 
          path, 
          content,
          type: 'file',
          name
        });
      }
    }

    // Get project tree (structure only, no content)
    const projectTree = await this.getProjectTree();
    const workspaceTree = await this.convertWorkspaceTree(projectTree);
    const sessionId = this.collaborationService.getCurrentSessionId() || undefined;

    // Prepare the final request with file contents in context
    const request: StructuredAiRequest = {
      query,
      context: {
        open_files: openFiles,
        context_files: contextFiles,
        workspace_tree: { 
          root: '/project', 
          children: workspaceTree // Contains only structure, no content
        }
      },
      session_id: sessionId
    };

    // Log the context being sent
    console.group('AI Request Context');
    console.log('Open Files:', request.context.open_files);
    console.log('Context Files:', request.context.context_files);
    console.log('Workspace Tree:', request.context.workspace_tree);
    console.groupEnd();

    return request;
  }

  async sendStructuredRequest(req: StructuredAiRequest): Promise<AiStructuredResponse | BackendResponse> {
    try {
      // Set loading state to true
      this.isLoadingSubject.next(true);

      // Log the request payload
      console.group('AI Request Payload');
      console.log('Query:', req.query);
      console.log('Session ID:', req.session_id);
      console.log('Files in Context:', req.context.open_files.map(f => ({
        path: f.path,
        contentLength: f.content.length,
        preview: f.content.substring(0, 100) + (f.content.length > 100 ? '...' : '')
      })));
      console.log('Project Tree:', req.context.workspace_tree);
      console.groupEnd();

      const response = await this.http.post<AiStructuredResponse | BackendResponse>(
        `${environment.apiAiUrl}/chat`,
        req
      ).toPromise();
      
      if (!response) throw new Error('No response from server');

      // Log the response
      console.group('AI Response');
      console.log('Response:', response);
      if ('response' in response) {
        console.log('Is Code Change:', response.is_code_change);
        if (response.parsed) {
          console.log('Parsed Response:', response.parsed);
        }
      }
      console.groupEnd();

      return response;
    } catch (error) {
      console.error('Error sending structured AI request:', error);
      throw error;
    } finally {
      // Set loading state to false whether request succeeded or failed
      this.isLoadingSubject.next(false);
    }
  }

  async applyResponse(resp: AiStructuredResponse): Promise<{ appliedChangesCount: number; generatedFilesCount: number; summary?: string }>
  {
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
      // Check cache first
      const cached = this.contentCache.get(filePath);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
        console.log(`Using cached content for ${filePath}`);
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
        // Cache the found content
        this.contentCache.set(filePath, {
          content,
          timestamp: Date.now()
        });
        return content;
      }

      console.warn(`No content found for file: ${filePath}`);
      return 'No content available for this file';
    } catch (err) {
      console.error('readFileContent error for file:', filePath, err);
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

  private async convertWorkspaceTree(nodes: FileNode[]): Promise<(StructuredAiRequestContextFile | StructuredAiRequestContextFolder)[]> {
    const result: (StructuredAiRequestContextFile | StructuredAiRequestContextFolder)[] = [];
    
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