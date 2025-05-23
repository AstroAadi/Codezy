import { Injectable, EventEmitter } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToolbarActionsService {
  newFile = new EventEmitter<void>();
  saveFile = new EventEmitter<void>();
  openFile = new EventEmitter<void>();
  addFolder = new EventEmitter<void>();
  exportFile = new EventEmitter<void>();
  deleteFile = new EventEmitter<void>();
}