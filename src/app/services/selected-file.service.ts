import { Injectable } from '@angular/core';
import { FileNode } from '../project-explorer/project-explorer.component';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SelectedFileService {
  private selectedFileSubject = new BehaviorSubject<FileNode|null>(null);
  selectedFile$ = this.selectedFileSubject.asObservable();

  setSelectedFile(file: FileNode|null) {
    // If setting a new file, ensure it has the latest content from localStorage
    if (file && file.type === 'file') {
      try {
        const raw = localStorage.getItem('fileStructure');
        if (raw) {
          const tree = JSON.parse(raw);
          const storedFile = this.findFileInTree(tree, file.path);
          if (storedFile && storedFile.content !== undefined) {
            file.content = storedFile.content;
          }
        }
      } catch (err) {
        console.error('Error getting file content:', err);
      }
    }
    this.selectedFileSubject.next(file);
  }

  getSelectedFile() {
    return this.selectedFileSubject.getValue();
  }

  updateSelectedFileContent(content: string) {
    const currentFile = this.selectedFileSubject.getValue();
    if (currentFile && currentFile.type === 'file') {
      currentFile.content = content;
      // Also update in localStorage
      try {
        const raw = localStorage.getItem('fileStructure');
        if (raw) {
          const tree = JSON.parse(raw);
          const storedFile = this.findFileInTree(tree, currentFile.path);
          if (storedFile) {
            storedFile.content = content;
            localStorage.setItem('fileStructure', JSON.stringify(tree));
          }
        }
      } catch (err) {
        console.error('Error updating file content:', err);
      }
      this.selectedFileSubject.next({...currentFile});
    }
  }

  private findFileInTree(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.type === 'folder' && node.children) {
        const found = this.findFileInTree(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }
}