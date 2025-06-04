import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { Terminal } from 'xterm';
import { CommonModule } from '@angular/common';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-output-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './output-panel.component.html'
})
export class OutputPanelComponent {
  @Input() fileContent: string = '';
  @Input() fileName: string = '';
  @ViewChild('terminalContainer', { static: true }) terminalContainer!: ElementRef;
  terminal!: Terminal;
  socket!: WebSocket;
  needsInput: boolean = false;
  inputBuffer: string = '';
  output: string = '';

  ngOnInit() {
    this.terminal = new Terminal({ convertEol: true });
    this.terminal.open(this.terminalContainer.nativeElement);
    this.terminal.write('✅ Terminal initialized!\r\n');

    this.socket = new WebSocket(environment.wsTerminalUrl);
    this.socket.onopen = () => {
      this.terminal.write('🔗 WebSocket connected!\r\n');
    };

    this.socket.onmessage = (msg) => {
      this.output += msg.data;
      this.terminal.write(msg.data);
      
      if (msg.data.includes('[Input required]')) {
        this.needsInput = true;
      } else if (msg.data.includes('[Process completed]')) {
        this.needsInput = false;
      }
    };

    this.terminal.onData((data) => {
      if (this.needsInput) {
        if (data === '\r') { // Enter key
          this.socket.send(JSON.stringify({ type: 'input', value: this.inputBuffer }));
          this.terminal.write('\r\n');
          this.inputBuffer = '';
        } else if (data === '\u007f') { // Backspace
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            this.terminal.write('\b \b');
          }
        } else {
          this.inputBuffer += data;
          this.terminal.write(data);
        }
      }
    });
  }

  detectNeedsInput(code: string, language: string): boolean {
    if (language === 'python') return /input\s*\(/.test(code);
    if (language === 'java') return /Scanner|System\.in/.test(code);
    if (language === 'c') return /scanf|gets/.test(code);
    if (language === 'node') return /readline|process\.stdin/.test(code);
    return false;
  }

  runCode() {
    const language = this.getLanguageFromFileName(this.fileName);
    this.needsInput = this.detectNeedsInput(this.fileContent, language);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        fileName: this.fileName,
        code: this.fileContent,
        type: 'code'
      });
      this.socket.send(payload);
      this.terminal.write('▶ Code sent to backend!\r\n');
    } else if (this.socket) {
      this.socket.onopen = () => {
        const payload = JSON.stringify({
          fileName: this.fileName,
          code: this.fileContent,
          type: 'code'
        });
        this.socket.send(payload);
        this.terminal.write('▶ Code sent to backend!\r\n');
      };
      this.terminal.write('⏳ Waiting for WebSocket connection to open...\r\n');
    } else {
      this.terminal.write('❌ WebSocket not initialized.\r\n');
    }
  }

  private getLanguageFromFileName(fileName: string): string {
    const extension = fileName.split('.').pop();
    switch (extension) {
      case 'py': return 'python';
      case 'java': return 'java';
      case 'c': return 'c';
      case 'js': return 'node';
      default: return 'plaintext';
    }
  }
}