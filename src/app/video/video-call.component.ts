import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterOutlet } from '@angular/router'; // Import ActivatedRoute
import { AuthService } from '../services/auth.service';
import { CollaborationService } from '../services/collaboration.service'; // Import CollaborationService

interface SignalMessage {
  type: 'join' | 'offer' | 'answer' | 'candidate' | 'leave';
  roomId?: string;
  userId?: string;
  userName?: string; // Add userName property
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  targetId?: string;
  leavingUserId?: string;
  leavingUserName?: string; // Add leavingUserName property
}

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.component.html',
  styleUrls: ['./video-call.component.css'],
  imports: [FormsModule, CommonModule], // Ensure FormsModule is imported
  standalone: true
})
export class VideoCallComponent implements OnInit, OnDestroy {
  private ws!: WebSocket;
  public localStream: MediaStream | null = null;
  public peerConnections: Map<string, RTCPeerConnection> = new Map();
  // private defaultRoomId: string = 'defaultVideoCallRoom'; // Remove this line
  private userId: string = Math.random().toString(36).substring(2, 15);
  public userName: string = ''; // Add userName property
  private pendingCandidates: Map<string, RTCIceCandidate[]> = new Map();
  private connectionRetryCount: Map<string, number> = new Map();
  private maxRetries: number = 3;
  private isJoiningRoom: boolean = false;
  private currentSessionId: string | null = null; // Add this property

  isConnected: boolean = false;
  isConnecting: boolean = false;

  // Map to store user IDs and their corresponding names
  public participantNames: Map<string, string> = new Map();

  constructor(private authService: AuthService, private collaborationService: CollaborationService, private route: ActivatedRoute) { } // Inject ActivatedRoute

  ngOnInit(): void {
    this.authService.user$.subscribe(user => {
      if (user) {
        this.userName = user;
      }
    });

    // Get session ID from route parameters or CollaborationService
    this.route.queryParams.subscribe(params => {
      const routeSessionId = params['sessionId'];
      const serviceSessionId = this.collaborationService.getCurrentSessionId();
      this.currentSessionId = routeSessionId || serviceSessionId;

      if (!this.currentSessionId) {
        console.error('No session ID available for video call.');
        // Optionally, you can alert the user or redirect them
        // alert('No active collaboration session found. Please start or join a session first.');
      }
    });
  }

  async startCall(): Promise<void> {
    try {
      // Request with lower video quality for better performance with multiple participants
      
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
        },
        audio: true
      };
      
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      const localVideo: HTMLVideoElement = document.getElementById('localVideo') as HTMLVideoElement;
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }
      console.log('Local stream obtained:', this.localStream);
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Could not access camera/microphone. Please ensure permissions are granted.');
    }
  }

  joinRoom(): void {
    // Prevent multiple join attempts if already connecting or connected
    if (this.isConnecting || this.isConnected) {
      console.log('Already connecting or connected to a room. Please wait or end the current call.');
      return;
    }

    if (!this.localStream) {
      alert('Please start your camera and microphone first by clicking "Start Call".');
      return;
    }

    if (!this.currentSessionId) { // Check for session ID
      alert('No session ID is active. Please start or join a collaboration session first.');
      return;
    }

    // Ensure any existing WebSocket is closed before creating a new one
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('Closing existing WebSocket connection before joining a new room.');
      this.ws.close();
    }

    // Clean up existing peer connections before joining a new room
    this.cleanup(false); // Pass false to not close the WebSocket here

    console.log('Attempting to join room:', this.currentSessionId); // Use currentSessionId
    this.isConnecting = true;
    this.isConnected = false;

    // Single WebSocket initialization
    this.ws = new WebSocket(`ws://localhost:8081/signal/${this.currentSessionId}`); // Use currentSessionId

    this.ws.onopen = () => {
      console.log('WebSocket connected. Joining room:', this.currentSessionId); // Use currentSessionId
      // Send the currentSessionId, userId, and userName in the join message
      this.ws.send(JSON.stringify({ type: 'join', roomId: this.currentSessionId, userId: this.userId, userName: this.userName })); // Use currentSessionId
      this.isConnecting = false;
      this.isConnected = true;
      // Add local user to participant names map
      this.participantNames.set(this.userId, this.userName);
    };

    this.ws.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data) as SignalMessage;
        const senderId = data.userId;

        // Ignore messages from ourselves
        if (senderId === this.userId) {
          return;
        }

        // Ensure senderId is defined before proceeding
        if (senderId === undefined) {
          console.warn('Received message with undefined userId:', data);
          return;
        }

        if (data.type === 'join') {
          console.log('New user joined:', data.userId, 'with name:', data.userName);
          if (data.userId && data.userId !== this.userId) {
            // Store the new user's name
            if (data.userName) {
                this.participantNames.set(data.userId, data.userName);
            }
            // For a new user joining, create an offer to them
            // Check if a peer connection already exists for this user to avoid duplicates
            if (!this.peerConnections.has(data.userId)) {
              this.createPeerConnection(data.userId, true);
            } else {
              console.log(`Peer connection already exists for ${data.userId}. Not creating a new one.`);
            }
          }
        } else if (data.type === 'offer') {
          console.log('Received offer from:', senderId);
          await this.handleOffer(data, senderId);
        } else if (data.type === 'answer') {
          console.log('Received answer from:', senderId);
          await this.handleAnswer(data, senderId);
        } else if (data.type === 'candidate') {
          console.log('Received ICE candidate from:', senderId);
          await this.handleCandidate(data, senderId);
        } else if (data.type === 'leave') {
          console.log('User left:', data.leavingUserId, 'with name:', data.leavingUserName);
          // Ensure leavingUserId is defined before calling removePeerConnection
          if (data.leavingUserId) {
            this.removePeerConnection(data.leavingUserId);
            // Remove user from participant names map
            this.participantNames.delete(data.leavingUserId);
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event);
      this.isConnecting = false;
      this.isConnected = false;
      // Cleanup is handled by endCall() or ngOnDestroy()
      // Clear participant names on disconnect
      this.participantNames.clear();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      alert('WebSocket connection error. Check server status and console for details.');
      this.isConnecting = false;
      this.isConnected = false;
      // Clear participant names on error
      this.participantNames.clear();
    };
  }

  private createPeerConnection(targetId: string, isInitiator: boolean): RTCPeerConnection {
    // Use multiple STUN servers for better connectivity
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    this.peerConnections.set(targetId, pc); // Corrected from remoteUserId to targetId
    console.log('Created RTCPeerConnection for:', targetId); // Corrected from remoteUserId to targetId

    // Reset retry count for new connections
    this.connectionRetryCount.set(targetId, 0); // Corrected from remoteUserId to targetId

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream!));
      console.log('Added local tracks to peer connection for:', targetId); // Corrected from remoteUserId to targetId
    } else {
      console.warn('Local stream not available when creating peer connection for:', targetId); // Corrected from remoteUserId to targetId
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', targetId);
        // Use the currentSessionId when sending candidate messages
        this.ws.send(JSON.stringify({
          type: 'candidate',
          candidate: event.candidate,
          targetId: targetId,
          userId: this.userId,
          roomId: this.currentSessionId // Use currentSessionId
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log('ontrack event received:', event);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.addRemoteVideo(targetId, remoteStream);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${targetId}: ${pc.iceConnectionState}`); // Corrected from remoteUserId to targetId
      if (pc.iceConnectionState === 'failed') {
        console.log(`Attempting to restart ICE for ${targetId}`); // Corrected from remoteUserId to targetId
        pc.restartIce();
      }
    };

    pc.onnegotiationneeded = async () => {
      // The `createOffer` variable is not defined. Assuming it should be `isInitiator`.
      if (isInitiator) {
        console.log('Negotiation needed, creating offer for:', targetId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          // Use the currentSessionId when sending offer messages
          this.ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            targetId: targetId,
            userId: this.userId,
            roomId: this.currentSessionId // Use currentSessionId
          }));
        } catch (e) {
          console.error('Error creating or sending offer:', e);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer connection state for ${targetId}: ${pc.connectionState}`); // Corrected from remoteUserId to targetId
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`Peer connection for ${targetId} disconnected/failed/closed. Removing.`); // Corrected from remoteUserId to targetId
        this.removePeerConnection(targetId); // Corrected from remoteUserId to targetId
      }
    };

    return pc;
  }

  private addRemoteVideo(userId: string, stream: MediaStream): void {
    const remoteVideosContainer = document.getElementById('remoteVideosContainer');
    if (remoteVideosContainer) {
      // Check if video element for this user already exists
      let videoElement = document.getElementById(`video-${userId}`) as HTMLVideoElement;
      if (!videoElement) {
        // Create a container div for video and name
        const videoContainer = document.createElement('div');
        videoContainer.id = `container-${userId}`;
        videoContainer.className = 'remote-video-container'; // Add a class for styling

        videoElement = document.createElement('video');
        videoElement.id = `video-${userId}`;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.muted = false; // Unmute remote videos

        // Create a label for the participant name
        const nameLabel = document.createElement('div');
        nameLabel.id = `name-${userId}`;
        nameLabel.className = 'user-label'; // Use the same class as local user label
        // Set the name from the participantNames map
        nameLabel.innerText = this.participantNames.get(userId) || 'Unknown Participant';

        videoContainer.appendChild(videoElement);
        videoContainer.appendChild(nameLabel);
        remoteVideosContainer.appendChild(videoContainer);

        console.log(`Added video element for user ${userId}`);
      } else {
          console.log(`Video element for user ${userId} already exists.`);
      }
      videoElement.srcObject = stream;
    }
  }

  private removePeerConnection(userId: string): void {
    const pc = this.peerConnections.get(userId);
    if (pc) {
      console.log('Closing peer connection for user:', userId);
      pc.close();
      this.peerConnections.delete(userId);

      // Remove the video and name elements from the DOM
      const videoContainer = document.getElementById(`container-${userId}`);
      if (videoContainer) {
        videoContainer.remove();
        console.log(`Removed video element for user ${userId}`);
      }

      // Remove from participant names map
      this.participantNames.delete(userId);

      // Clear pending candidates for this user
      this.pendingCandidates.delete(userId);
      this.connectionRetryCount.delete(userId);
    }
  }

  private async handleOffer(data: any, senderId: string): Promise<void> {
    try {
      let pc = this.peerConnections.get(senderId);
      if (!pc) {
        // If peer connection doesn't exist, create it as a receiver (not initiator)
        pc = this.createPeerConnection(senderId, false);
      }

      // Offer collision detection and resolution
      // If we already have a local offer and receive another offer, we need to decide who wins.
      // A common strategy is to compare user IDs to break the tie.
      const offerCollision = (
        pc.signalingState === 'have-local-offer' ||
        pc.signalingState === 'have-remote-offer'
      );

      if (offerCollision) {
        // If both sides offer simultaneously, the one with the lexicographically smaller ID wins.
        const ourId = this.userId;
        const theirId = senderId;

        if (ourId > theirId) {
          // We lose the collision, so we rollback our offer and accept theirs.
          console.log(`Offer collision: ${ourId} > ${theirId}. Rolling back local offer.`);
          await pc.setLocalDescription(new RTCSessionDescription({ type: 'rollback' }));
        } else {
          // We win the collision, so we ignore their offer and wait for their rollback.
          console.log(`Offer collision: ${ourId} < ${theirId}. Ignoring their offer.`);
          return; // Ignore this offer
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      console.log(`Successfully set remote description for offer from ${senderId}.`);

      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.ws.send(JSON.stringify({
        type: 'answer',
        answer: answer,
        targetId: senderId,
        userId: this.userId,
        roomId: this.currentSessionId // Use currentSessionId
      }));

      // Apply any pending ICE candidates after setting remote description
      await this.applyPendingCandidates(senderId, pc);

    } catch (error) {
      console.error(`Offer handling failed for ${senderId}:`, error);
      this.removePeerConnection(senderId);
    }
  }

  private async handleAnswer(data: any, senderId: string): Promise<void> {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      // Ensure the signaling state is 'have-local-offer' before setting the remote answer.
      // This means we have sent an offer and are waiting for an answer.
      if (pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`Successfully set remote description for answer from ${senderId}.`);
          
          // Apply any pending ICE candidates
          await this.applyPendingCandidates(senderId, pc);
        } catch (e) {
          console.error(`Error processing answer from ${senderId}:`, e);
        }
      } else {
        console.warn(`Received answer from ${senderId} in unexpected signaling state: ${pc.signalingState}. Expected 'have-local-offer'. Ignoring this answer.`);
        // This might happen if an answer arrives for an offer that was ignored due to tie-breaking,
        // or if there's a race condition where the state hasn't transitioned yet.
      }
    } else {
      console.warn('Received answer for unknown peer connection:', senderId);
    }
  }

  private async handleCandidate(data: any, senderId: string): Promise<void> {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      try {
        // Check if the peer connection is in a state where it can accept candidates
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          // Store the candidate for later if the remote description isn't set yet
          if (!this.pendingCandidates.has(senderId)) {
            this.pendingCandidates.set(senderId, []);
          }
          this.pendingCandidates.get(senderId)?.push(new RTCIceCandidate(data.candidate));
          console.log(`Stored pending ICE candidate for ${senderId}. Total pending: ${this.pendingCandidates.get(senderId)?.length}`);
        }
      } catch (e) {
        console.error('Error adding received ICE candidate:', e);
      }
    } else {
      console.warn('Received candidate for unknown peer connection:', senderId);
      // Store the candidate in case the peer connection is created later
      if (!this.pendingCandidates.has(senderId)) {
        this.pendingCandidates.set(senderId, []);
      }
      this.pendingCandidates.get(senderId)?.push(new RTCIceCandidate(data.candidate));
      console.log(`Stored pending ICE candidate for future connection with ${senderId}`);
    }
  }

  private async applyPendingCandidates(userId: string, pc: RTCPeerConnection): Promise<void> {
    const candidates = this.pendingCandidates.get(userId);
    if (candidates && candidates.length > 0) {
      console.log(`Applying ${candidates.length} pending ICE candidates for ${userId}`);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.error(`Error applying pending ICE candidate for ${userId}:`, e);
        }
      }
      // Clear the pending candidates after applying them
      this.pendingCandidates.delete(userId);
    }
  }

  private shouldRetryConnection(userId: string): boolean {
    const retryCount = this.connectionRetryCount.get(userId) || 0;
    if (retryCount < this.maxRetries) {
      this.connectionRetryCount.set(userId, retryCount + 1);
      return true;
    }
    return false;
  }

  ngOnDestroy(): void {
    this.cleanup(true);
  }

  private cleanup(closeWebSocket: boolean): void {
      // Cleanup all peer connections
      this.peerConnections.forEach((pc, userId) => {
          pc.close();
          this.removePeerConnection(userId);
      });
      
      if (closeWebSocket && this.ws) {
          this.ws.close();
      }
  }

  endCall(): void {
    console.log('Ending call and cleaning up resources.');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send a leave message to the signaling server
      this.ws.send(JSON.stringify({
        type: 'leave',
        roomId: this.currentSessionId,
        leavingUserId: this.userId,
        leavingUserName: this.userName
      }));
    }

    // Stop all local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop(); // Stop each track (video and audio)
      });
      this.localStream = null; // Clear the local stream reference
      const localVideo: HTMLVideoElement = document.getElementById('localVideo') as HTMLVideoElement;
      if (localVideo) {
        localVideo.srcObject = null; // Detach stream from video element
      }
    }

    // Cleanup all peer connections and close WebSocket
    this.cleanup(true);

    this.isConnecting = false;
    this.isConnected = false;
    this.participantNames.clear();
  }
}
