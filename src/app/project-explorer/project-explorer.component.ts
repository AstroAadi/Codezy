import { DOCUMENT } from '@angular/common';
import { Component, EventEmitter, Inject, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollaborationService } from '../services/collaboration.service';
import { ToolbarActionsService } from '../services/toolbar-actions.service';

export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  path: string;
  isExpanded?: boolean;
  content?: string;
  isEditingName?: boolean;
  parent?: FileNode;
}

@Component({
  selector: 'app-project-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-explorer.component.html',
  styleUrl: './project-explorer.component.css',
})
export class ProjectExplorerComponent {
  canShowAddButtons(node: FileNode): boolean {
    return node.type === 'folder' && !(node.children && node.children.some(child => child.isEditingName));
  }
  selectedNode: FileNode | null = null;
  constructor(
    @Inject(DOCUMENT) public document: Document,
    public collaborationService: CollaborationService,
    private toolbarActions: ToolbarActionsService
  ) {
    this.toolbarActions.newFile.subscribe(() => this.startAdd('file'));
    this.toolbarActions.addFolder.subscribe(() => this.startAdd('folder'));
    this.toolbarActions.openFile.subscribe(() => this.triggerFileInput());
    this.toolbarActions.deleteFile.subscribe(() => this.deleteSelected());
  }
  @Input() files: FileNode[] = [];
  @Output() fileSelected = new EventEmitter<FileNode>();
  @Output() addFile = new EventEmitter<FileNode>();
  @Output() addFolder = new EventEmitter<FileNode>();
  @Input() sidebarWidth: number = 220;
  @Output() sidebarWidthChange = new EventEmitter<number>();

  isResizing = false;
  showResizeArrows = false;
  private startX = 0;
  private startWidth = 0;

  // Track which folder is being edited for new file/folder
  editingNode: FileNode | null = null;
  newNodeType: 'file' | 'folder' | null = null;

  onFileClick(file: FileNode, event: MouseEvent) {
    event.stopPropagation();
    this.selectedNode = file;
    if (file.type === 'file') {
      this.fileSelected.emit(file);
    } else if (file.type === 'folder') {
      file.isExpanded = !file.isExpanded;
    }
  }

  startAdd(type: 'file' | 'folder', parent?: FileNode) {
    let siblings: FileNode[];
    if (parent) {
      if (!parent.children) parent.children = [];
      siblings = parent.children;
    } else {
      siblings = this.files;
    }
    // Prevent multiple edit nodes
    if (siblings.some(n => n.isEditingName)) {
      return;
    }
    const newNode: FileNode = {
      name: '',
      type,
      isEditingName: true,
      children: type === 'folder' ? [] : undefined,
      path: ''
    };
    siblings.push(newNode);
    this.editingNode = newNode;
    this.newNodeType = type;
  }


  finishAdd(node: FileNode, parent?: FileNode) {
    // Use node.parent if available, otherwise use the provided parent
    const actualParent = node.parent || parent;
    
    // Validate empty name
    if (!node.name || node.name.trim() === '') {
      alert('File/folder name cannot be empty');
      this.cancelAdd(actualParent);
      return;
    }

    // Check for duplicate names
    const siblings = actualParent ? actualParent.children! : this.files;
    const isDuplicate = siblings.some(item => 
      item !== node && // Exclude the current node
      item.name.toLowerCase() === node.name.toLowerCase() // Case-insensitive comparison
    );

    if (isDuplicate) {
      alert('A file/folder with this name already exists');
      this.cancelAdd(actualParent);
      return;
    }

    node.isEditingName = false;
    node.path = node.name;
    if (node.type === 'file') {
      node.content = '';
      // Remove this line if handled elsewhere
      // this.addFile.emit({ ...node, parent: actualParent });
    } else {
      node.children = [];
      // Remove this line if handled elsewhere
      // this.addFolder.emit({ ...node, parent: actualParent });
    }
    this.editingNode = null;
    this.newNodeType = null;
}

  cancelAdd(parent?: FileNode) {
    if (parent && parent.children) {
      parent.children = parent.children.filter(child => !child.isEditingName);
    } else {
      this.files = this.files.filter(child => !child.isEditingName);
    }
    this.editingNode = null;
    this.newNodeType = null;
  }
  onFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const newNode: FileNode = {
          name: file.name,
          type: 'file',
          path: file.name,
          content: reader.result as string
        };
        this.fileSelected.emit(newNode);
      };
      reader.readAsText(file);
    }
  }

  onSidebarResize(event: MouseEvent) {
    if (!this.isResizing) return;
    let newWidth = this.startWidth + (event.clientX - this.startX);
    newWidth = Math.max(0, Math.min(400, newWidth)); // min 0, max 400px
    this.sidebarWidthChange.emit(newWidth);
  }

  stopSidebarResize() {
    this.isResizing = false;
    this.document.removeEventListener('mousemove', this.onSidebarResize.bind(this));
    this.document.removeEventListener('mouseup', this.stopSidebarResize.bind(this));
  }

  startSidebarResize(event: MouseEvent) {
    event.preventDefault();
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = this.sidebarWidth;

    this.document.addEventListener('mousemove', this.onSidebarResize.bind(this));
    this.document.addEventListener('mouseup', this.stopSidebarResize.bind(this));
  }

  ngOnInit() {
    // Subscribe to fileAdded$ and add the file if it doesn't exist
    this.collaborationService.fileAdded$.subscribe((fileNode) => {
      // Check if file already exists by path
      const exists = this.findFileByPath(this.files, fileNode.path);
      if (!exists) {
        this.files.push(fileNode);
      } else {
        // Optionally update content if file exists
        exists.content = fileNode.content;
      }
    });
  }

  findFileByPath(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.type === 'folder' && node.children) {
        const found = this.findFileByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }
  triggerFileInput() {
    const fileInput = this.document.getElementById('explorer-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }
  
  deleteSelected() {
    if (!this.selectedNode) return;
    this.removeNode(this.files, this.selectedNode);
    this.selectedNode = null;
  }
  
  removeNode(nodes: FileNode[], target: FileNode): boolean {
    const idx = nodes.indexOf(target);
    if (idx !== -1) {
      nodes.splice(idx, 1);
      return true;
    }
    for (const node of nodes) {
      if (node.type === 'folder' && node.children) {
        if (this.removeNode(node.children, target)) return true;
      }
    }
    return false;
  }
}
