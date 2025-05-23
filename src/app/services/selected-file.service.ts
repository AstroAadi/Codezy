import { Injectable } from '@angular/core';
import { FileNode } from '../project-explorer/project-explorer.component';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SelectedFileService {
  private selectedFileSubject = new BehaviorSubject<FileNode|null>(null);
  selectedFile$ = this.selectedFileSubject.asObservable();

  setSelectedFile(file: FileNode|null) {
    this.selectedFileSubject.next(file);
  }
  getSelectedFile() {
    return this.selectedFileSubject.getValue();
  }
}