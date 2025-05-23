import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RightPanelComponent } from '../right-panel/right-panel.component';
import { ToolbarActionsService } from '../services/toolbar-actions.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, RightPanelComponent],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.css']
})
export class ToolbarComponent {
  @Output() toggleExplorer = new EventEmitter<void>();
  @Output() newFile = new EventEmitter<void>();
  @Output() addFolder = new EventEmitter<void>();
  @Output() openFile = new EventEmitter<File>();
  @Output() saveFile = new EventEmitter<void>();
  @Output() run = new EventEmitter<void>();
  @Output() toolbarAction = new EventEmitter<string>();

  leftToolbarItems = [
    { icon: 'folder2', title: 'Project Explorer', action: 'toggleExplorer' },
    { icon: 'file-earmark-plus', title: 'New File', action: 'newFile' },
    { icon: 'folder2-open', title: 'Create Folder', action: 'addFolder' },
    { icon: 'folder-symlink', title: 'Open File', action: 'openFile' },
    { icon: 'save', title: 'Save Project', action: 'saveFile' },
    { divider: true },
    { icon: 'arrow-counterclockwise', title: 'Undo', action: 'undo' },
    { icon: 'arrow-clockwise', title: 'Redo', action: 'redo' }
  ];

  rightToolbarItems = [
    { icon: 'play-fill', title: 'Run', action: 'run' },
    { icon: 'bug', title: 'Debug', action: 'debug' },
    { icon: 'stop-fill', title: 'Stop', action: 'stop' }
  ];
  constructor(private toolbarActions: ToolbarActionsService) {}


  languages = ['python', 'java', 'node', 'c'];
  selectedLanguage = 'python';
  @Output() languageChange = new EventEmitter<string>();

   onToolbarClick(item: any): void {
    switch (item.action) {
      case 'newFile':
        this.toolbarActions.newFile.emit();
        this.newFile.emit();
        break;
      case 'saveFile':
        this.toolbarActions.saveFile.emit();
        this.saveFile.emit();
        break;
      case 'openFile':
        this.toolbarActions.openFile.emit();
        const fileInput = document.getElementById('toolbar-file-input') as HTMLInputElement;
        if (fileInput) fileInput.click();
        break;
      case 'addFolder':
        this.toolbarActions.addFolder.emit();
        this.addFolder.emit();
        break;
      case 'exportFile':
        this.toolbarActions.exportFile.emit();
        break;
      case 'deleteFile':
        this.toolbarActions.deleteFile.emit();
        break;
      case 'toggleExplorer':
        this.toggleExplorer.emit();
        break;
      case 'run':
        this.run.emit();
        break;
      case 'debug':
        alert('This function is not allowed for unpaid version');
        break;
      default:
        if (item.action) this.toolbarAction.emit(item.action);
        break;
    }
  }

  onLanguageChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedLanguage = select.value;
    this.languageChange.emit(this.selectedLanguage);
  }
  
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.openFile.emit(file);
    }
  }
}
