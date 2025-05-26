import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { Terminal } from 'xterm';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-output-panel',
    imports: [CommonModule, FormsModule],
    templateUrl: './output-panel.component.html'
})
export class OutputPanelComponent {
  @Input() code: string = '';
  @Input() language: string = 'python';
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

    this.socket = new WebSocket('wss://spring-app-380351855140.asia-south1.run.app/terminal');
    this.socket.onopen = () => {
        this.terminal.write('🔗 WebSocket connected!\r\n');
    };
    this.socket.onmessage = (msg) => {
      this.output += msg.data;
      this.terminal.write(msg.data);
    };
    this.terminal.onData((data) => {
      if (this.needsInput) {
        if (data === '\r') {
          this.socket.send(JSON.stringify({ type: 'input', value: this.inputBuffer }));
          this.terminal.write('\r\n');
          this.inputBuffer = '';
        } else if (data === '\u007f') {
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            this.terminal.write('\b \b');
          }
        } else {
          this.inputBuffer += data;
          this.terminal.write(data);
        }
      } else {
        this.socket.send(data);
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
    this.needsInput = this.detectNeedsInput(this.code, this.language);
    if (this.socket && this.terminal) {
      const payload = JSON.stringify({ code: this.code, language: this.language });
      this.socket.send(payload);
      this.terminal.write('▶️ Code sent to backend!\r\n');
      if (this.needsInput) {
        this.terminal.write('\r\n[Input required] ');
      }
    }
  }
}
