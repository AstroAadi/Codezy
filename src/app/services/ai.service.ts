import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SelectedFileService } from './selected-file.service';
import { FileNode } from '../project-explorer/project-explorer.component';

interface AiRequest {
  message: string;
  model: string;
  context?: string;
}

interface AiResponse {
  content: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  constructor(
    private http: HttpClient,
    private selectedFileService: SelectedFileService
  ) {}

  async sendMessage(request: AiRequest): Promise<AiResponse> {
    try {
      const response = await this.http.post<AiResponse>(
        `${environment.apiUrl}/ai/chat`,
        request
      ).toPromise();
      
      if (!response) {
        throw new Error('No response from server');
      }
      
      return response;
    } catch (error) {
      console.error('Error sending message to AI:', error);
      throw error;
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
}