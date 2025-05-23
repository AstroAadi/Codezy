import { Component, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebsocketService } from '../services/websocket.service';
import { CollaborationService } from '../services/collaboration.service';

@Component({
  selector: 'app-video',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="video-container">
      <div class="video-content" *ngIf="!isCallActive">
        <h3 class="text-center mb-4">Start a Video Call</h3>
        <div class="text-center">
          <button class="btn btn-primary btn-lg" (click)="startCall()">
            <i class="bi bi-camera-video-fill me-2"></i>
            Start Video Call
          </button>
        </div>
      </div>

      <div class="video-call" *ngIf="isCallActive">
        <div class="video-grid" [ngStyle]="{'grid-template-columns': 'repeat(' + participants.length + ', 1fr)'}">
          <video #localVideo autoplay muted></video>
          <video #remoteVideo autoplay></video>
        </div>
        
        <div class="video-controls">
          <button class="btn btn-danger" (click)="endCall()">
            <i class="bi bi-telephone-x-fill"></i>
            End Call
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `.video-container {
      height: 100%;
      padding: 20px;
      background-color: #2b2b2b;
      color: #fff;
    }

    .video-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
    }

    .video-call {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .video-grid {
      flex: 1;
      display: grid;
      gap: 16px;
      padding: 16px;
    }

    .video-placeholder {
      background-color: #1e1e1e;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 16/9;
    }

    .main-video {
      width: 100%;
    }

    .placeholder-text {
      color: #afb1b3;
      font-size: 14px;
    }

    .video-controls {
      padding: 16px;
      display: flex;
      justify-content: center;
      gap: 16px;
      background-color: #3c3f41;
    }
  `]
})
export class VideoComponent implements OnInit {
  isCallActive = false;
  private pc: RTCPeerConnection;
  private localStream!: MediaStream;
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;
  participants: any[] = [];
  sessionId: string = '';

  constructor(private websocketService: WebsocketService, private collaborationService: CollaborationService) {
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  }

  // ngOnInit() {
  //   this.sessionId = this.collaborationService.getCurrentSessionId() || '';
  //   if (this.sessionId) {
  //     this.websocketService.connect('VideoComponent', this.sessionId);
  //   }
  // }

  // async startCall() {
  //   this.isCallActive = true;
  //   this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  //   this.localVideo.nativeElement.srcObject = this.localStream;
  
  //   this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
  
  //   const offer = await this.pc.createOffer();
  //   await this.pc.setLocalDescription(offer);
  //   this.websocketService.sendMessage('VideoComponent', JSON.stringify({ offer }), this.sessionId);
  // }

  endCall() {
    console.log('Ending call...');
    this.isCallActive = false;
    this.localStream.getTracks().forEach(track => track.stop());
    this.pc.close();
    console.log('Call ended and peer connection closed.');
  }

  // In video.component.ts
async startCall() {
  console.log('Starting call...');
  this.isCallActive = true;
  try {
    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log('Local stream obtained.');
    this.localVideo.nativeElement.srcObject = this.localStream;
    this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('Sending offer via WebSocket.');
    this.websocketService.sendMessage('VideoComponent', JSON.stringify({ offer }), this.sessionId);
    this.websocketService.broadcastStartCall(this.sessionId);
  } catch (error) {
    console.error('Error starting call:', error);
  }
}

ngOnInit() {
  console.log('VideoComponent initialized.');
  this.sessionId = this.collaborationService.getCurrentSessionId() || '';
  if (this.sessionId) {
    console.log('Connecting to WebSocket with session ID:', this.sessionId);
    this.websocketService.connect('VideoComponent', this.sessionId);
    this.websocketService.onStartCall().subscribe(() => {
      if (!this.isCallActive) {
        console.log('Received start call event.');
        this.startCall();
      }
    });
  }
}
}