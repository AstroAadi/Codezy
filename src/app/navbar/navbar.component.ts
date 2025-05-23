import { Component, ViewChild, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SelectedFileService } from '../services/selected-file.service';
import { EditorActionsService } from '../services/editor-actions.service';
import { ToolbarActionsService } from '../services/toolbar-actions.service';
import { ThemeService } from '../services/theme.service';
import { BottomPanelComponent } from '../bottom-panel/bottom-panel.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  @ViewChild(BottomPanelComponent) bottomPanel!: BottomPanelComponent;
  @Output() run = new EventEmitter<void>();
  menuItems = [
   { title: 'File',
    options: ['New File','Save File','Open File','Export','delete','Create folder','Exit']},
    {
      title : 'Edit',
      options: ['Undo','Redo','Cut','Copy','Paste','Find','Replace','Delete']
    },
    {
      title : 'View',
      options: ['Search','Extension','Chat','Terminal']
    },
    {
      title : 'Run',
      options: ['Run','Stop','Debug']
    },
    {
      title : 'Help',
      options: ['Help','Connect Us']
    }
  ];

  user$ = this.auth.user$;
  isDarkMode = false;
  constructor(
    private auth: AuthService,
    public toolbarActions: ToolbarActionsService,
    private selectedFileService: SelectedFileService,
    private editorActions: EditorActionsService,
    public themeService: ThemeService
  ) {
    this.themeService.darkMode$.subscribe(mode => this.isDarkMode = mode);
  }

  logout() {
    this.auth.logout();
  }
  
  handleOptionClick(menu: string, option: string) {
    console.log(`Clicked ${option} from ${menu}`);
    if (menu === 'Run' && option === 'Run') {
      this.run.emit();
    }
    if (menu === 'File') {
      if (option === 'New File') {
        this.toolbarActions.newFile.emit();
      } else if (option === 'Save File') {
        this.toolbarActions.saveFile.emit();
      } else if (option === 'Open File') {
        this.toolbarActions.openFile.emit();
      } else if (option === 'Create folder') {
        this.toolbarActions.addFolder.emit();
      } else if (option === 'Export') {
        this.toolbarActions.exportFile.emit();
      } else if (option === 'delete' || option === 'Delete') {
        this.toolbarActions.deleteFile.emit();
      } else if (option === 'Exit') {
        this.exitApp();
      }
} else if (menu === 'Edit') {
  if (option === 'Undo') {
    this.undoAction();
  } else if (option === 'Redo') {
    this.redoAction();
  } else if (option === 'Cut') {
    this.cut();
  } else if (option === 'Copy') {
    this.copy();
  } else if (option === 'Paste') {
    this.paste();
  } else if (option === 'Find') {
    this.find();
  } else if (option === 'Replace') {
    this.replace();
  } else if (option === 'Delete') {
    this.delete();
  }
} else if (menu === 'View') {
  if (option === 'Search') {
    this.searchView();
  } else if (option === 'Extension') {
    this.extensionView();
  } else if (option === 'Chat') {
    this.chatView();
  } else if (option === 'Terminal') {
    this.terminalView();
  }
} else if (menu === 'Run') {
  if (option === 'Run') {
    this.runCode();
  } else if (option === 'Debug') {
    this.debugCode();
  }
} else if (menu === 'Help') {
  if (option === 'Help') {
    this.help();
  } else if (option === 'Connect Us') {
    this.connectUs();
  }
}
}

// FILE
newFile() { alert('New File created.'); }
saveFile() {
  this.toolbarActions.saveFile.emit();
}
openFile() { 
  this.toolbarActions.openFile.emit();
 }
exportFile() {
  const selectedFile = this.selectedFileService.getSelectedFile();
  if (!selectedFile || selectedFile.type === 'folder') {
    return;
  }
  const content = selectedFile.content || '';
  const filename = selectedFile.name || 'export.txt';
  const blob = new Blob([content], { type: 'text/plain' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

exitApp() { alert('Application exited.'); }

// EDIT
undoAction() { this.editorActions.trigger('undo'); }
redoAction() { this.editorActions.trigger('redo'); }
cut() { this.editorActions.trigger('cut'); }
copy() { this.editorActions.trigger('copy'); }
paste() { this.editorActions.trigger('paste'); }
find() { this.editorActions.trigger('find'); }
replace() { this.editorActions.trigger('replace'); }
delete() { this.toolbarActions.deleteFile.emit(); }

// VIEW
searchView() { alert('Search View opened.'); }
extensionView() { alert('Extensions View opened.'); }
chatView() { alert('Chat View opened.'); }
terminalView() { alert('Terminal View opened.'); }

// RUN
runCode() {
    if (this.bottomPanel && this.bottomPanel.activePanel === 'output') {
      const outputPanel = this.bottomPanel.outputPanelComponent;
      if (outputPanel) {
        outputPanel.runCode();
      } else {
        console.error('OutputPanelComponent is not available');
      }
    }
  }
debugCode() { alert('This function is not allowed for unpaid version'); }

// HELP
help() { alert('Help dialog opened.'); }
connectUs() { alert('Connecting to support...'); }

toggleTheme() {
  this.themeService.toggleTheme();
}
}


