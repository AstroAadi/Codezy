import { Component, HostBinding, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OutputPanelComponent } from '../output-panel/output-panel.component';
import { Output, EventEmitter } from '@angular/core';
import { ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TerminalPanelComponent } from '../terminal-panel/terminal-panel.component';

interface PanelState {
  isOpen: boolean;
  height: number;
}

export type PanelType = 'terminal' | 'output' | 'problems' | 'services' | 'versionControl';

@Component({
    selector: 'app-bottom-panel',
    imports: [CommonModule, OutputPanelComponent, FormsModule, TerminalPanelComponent],
    templateUrl: './bottom-panel.component.html',
    styleUrls: ['./bottom-panel.component.css']
})
export class BottomPanelComponent {
  @Input() outputText: string = '';
  @Input() activePanel: PanelType | null = null;
  @Input() projectPath: string | undefined;
  @Input() projectFiles: any[] | undefined;
  @Output() activePanelChange = new EventEmitter<PanelType | null>();

  bottomToolbarItems: Array<{ id: PanelType; icon: string; title: string; label: string }> = [
    { id: 'terminal', icon: 'terminal', title: 'Terminal', label: 'Terminal' },
    { id: 'output', icon: 'terminal-split', title: 'Output', label: 'Output' },
    { id: 'problems', icon: 'exclamation-triangle', title: 'Problems', label: 'Problems' },
    { id: 'services', icon: 'gear', title: 'Services', label: 'Services' },
    { id: 'versionControl', icon: 'git', title: 'Version Control', label: 'Version Control' }
  ];

  panels: Record<PanelType, PanelState> = {
    terminal: { isOpen: false, height: 300 },
    output: { isOpen: false, height: 300 },
    problems: { isOpen: false, height: 300 },
    services: { isOpen: false, height: 300 },
    versionControl: { isOpen: false, height: 300 }
  };

 // activePanel: PanelType | null = null;
  private isDragging = false;
  private startY = 0;
  private startHeight = 0;

  @HostBinding('class.is-dragging')
  get isDraggingClass(): boolean {
    return this.isDragging;
  }


  startResize(event: MouseEvent): void {
    if (this.activePanel) {
      event.preventDefault();
      this.isDragging = true;
      this.startY = event.clientY;
      this.startHeight = this.panels[this.activePanel].height;
      
      document.addEventListener('mousemove', this.resize);
      document.addEventListener('mouseup', this.stopResize);
    }
  }

  private resize = (event: MouseEvent): void => {
    if (this.isDragging && this.activePanel) {
      const diff = this.startY - event.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight - 200, this.startHeight + diff));
      this.panels[this.activePanel].height = newHeight;
    }
  }

  private stopResize = (): void => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.resize);
    document.removeEventListener('mouseup', this.stopResize);
  }

  getPanelContent(panelName: PanelType | null): string {
    if (!panelName) return '';
    
    switch(panelName) {
      case 'terminal':
        return 'Terminal > _';
      case 'output':
        return this.outputText || 'Build output and console logs will appear here';
      case 'problems':
        return 'No problems found';
      case 'services':
        return 'No services configured';
      case 'versionControl':
        return 'No changes';
    }
  }
  @ViewChild(OutputPanelComponent) outputPanelComponent!: OutputPanelComponent;
  togglePanel(panelId: PanelType): void {
    if (this.activePanel === panelId) {
      // Clicking the same panel again - close it
      this.panels[panelId].isOpen = false;
      this.activePanel = null;
      this.activePanelChange.emit(null);
    } else {
      // Switching to a different panel - close others and open this one
      Object.keys(this.panels).forEach(key => {
        this.panels[key as PanelType].isOpen = false;
      });
      this.panels[panelId].isOpen = true;
      this.activePanel = panelId;
      this.activePanelChange.emit(panelId);
    }
  }
  showResizeArrow = false;
}

