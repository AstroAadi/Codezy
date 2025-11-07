import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SelectedFileService } from './selected-file.service';
import { FileNode } from '../project-explorer/project-explorer.component';
import { EditorActionsService, AiFileChangePayload, AiModification } from './editor-actions.service';
import { CollaborationService } from './collaboration.service';

interface StructuredAiRequestContextFile {
  path: string;
  content: string;
}

interface StructuredAiRequestContextTreeNode {
  name: string;
  type: 'file' | 'folder';
  children?: StructuredAiRequestContextTreeNode[];
}

interface StructuredAiRequestContext {
  open_files: StructuredAiRequestContextFile[];
  workspace_tree: { root: string; children: StructuredAiRequestContextTreeNode[] };
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
  constructor(
    private http: HttpClient,
    private selectedFileService: SelectedFileService,
    private editorActions: EditorActionsService,
    private collaborationService: CollaborationService
  ) {}

  // Build structured request per user’s expected format
  async buildStructuredRequest(query: string): Promise<StructuredAiRequest> {
    const openFiles: StructuredAiRequestContextFile[] = [];
    const selected = this.selectedFileService.getSelectedFile();
    if (selected && selected.type === 'file') {
      const content = await this.readFileContent(selected.path);
      openFiles.push({ path: selected.path, content });
    }

    const projectTree = await this.getProjectTree();
    const contextTreeChildren = projectTree.map(n => this.toRequestTreeNode(n));
    const sessionId = this.collaborationService.getCurrentSessionId() || undefined;

    return {
      query,
      context: {
        open_files: openFiles,
        workspace_tree: { root: '/project', children: contextTreeChildren }
      },
      session_id: sessionId
    };
  }

  async sendStructuredRequest(req: StructuredAiRequest): Promise<AiStructuredResponse | BackendResponse> {
    try {
      const response = await this.http.post<AiStructuredResponse | BackendResponse>(
        `${environment.apiUrl}/chat`,
        req
      ).toPromise();
      if (!response) throw new Error('No response from server');
      return response;
    } catch (error) {
      console.error('Error sending structured AI request:', error);
      throw error;
    }
  }

  async applyResponse(resp: AiStructuredResponse): Promise<{ appliedChangesCount: number; generatedFilesCount: number; summary?: string }>
  {
    if (!resp) return { appliedChangesCount: 0, generatedFilesCount: 0 };
    let appliedChangesCount = 0;
    let generatedFilesCount = 0;
    let summary: string | undefined = (resp as any).summary;

    if ((resp as any).type === 'code_changes') {
      const r = resp as AiResponseCodeChanges;
      appliedChangesCount = await this.applyCodeChanges(r.changes);
    } else if ((resp as any).type === 'code_generation') {
      const r = resp as AiResponseCodeGeneration;
      generatedFilesCount = await this.applyCodeGeneration(r.changes);
    } else if ((resp as any).content) {
      // Plain assistant content
      summary = (resp as any).content;
    }

    return { appliedChangesCount, generatedFilesCount, summary };
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
    // Try to read a file from the saved project structure in localStorage
    try {
      const raw = localStorage.getItem('fileStructure');
      if (!raw) return 'No file structure available';
      const tree: FileNode[] = JSON.parse(raw);
      const node = this.findFileNodeByPath(tree, filePath);
      if (node && node.content) return node.content;
      return 'No content available for this file';
    } catch (err) {
      console.error('readFileContent error', err);
      return 'Error reading file content';
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

  private toRequestTreeNode(node: FileNode): StructuredAiRequestContextTreeNode {
    return {
      name: node.name,
      type: node.type,
      children: node.children ? node.children.map(c => this.toRequestTreeNode(c)) : undefined
    };
  }
}