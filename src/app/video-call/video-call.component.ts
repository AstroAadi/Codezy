import { Component } from '@angular/core';

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.component.html',
  styleUrls: ['./video-call.component.css']
})
export class VideoCallComponent {
  private ws: WebSocket;
  private pc: RTCPeerConnection;
  private localStream!: MediaStream;

  constructor() {
    this.ws = new WebSocket('ws://localhost:8081/signal');
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    this.ws.onmessage = async (message) => {
      const data = JSON.parse(message.data);

      if (data.offer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.ws.send(JSON.stringify({ answer }));
      } else if (data.answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({ candidate: event.candidate }));
      }
    };

    this.pc.ontrack = (event) => {
      const remoteVideo: HTMLVideoElement = document.getElementById('remoteVideo') as HTMLVideoElement;
      remoteVideo.srcObject = event.streams[0];
    };
  }

  async startCall() {
    const localVideo: HTMLVideoElement = document.getElementById('localVideo') as HTMLVideoElement;
  
    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = this.localStream;
  
    this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
  
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ offer }));
  }
  
}
