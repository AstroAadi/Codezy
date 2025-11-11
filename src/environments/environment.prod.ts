export const environment = {
  production: true,
  // apiUrl: 'https://codezy-backend.onrender.com',
  // wsTerminalUrl: 'wss://codezy-backend.onrender.com/terminal',
  // wsSignalUrl: 'wss://codezy-backend.onrender.com/signal'
  apiUrl: 'http://localhost:8080',
  apiAiUrl: 'https://f2e4256f986c.ngrok-free.app',

  // Use the STOMP SockJS endpoint registered by the backend (/ws)
  wsTerminalUrl: 'http://localhost:8080/terminal',
  wsSignalUrl: 'ws://localhost:8080/signal'
  // apiUrl:'https://codezy-backend-185224543792.asia-south2.run.app',
  // wsSignalUrl:'wss://codezy-backend-185224543792.asia-south2.run.app/signal',
  // wsTerminalUrl:'wss://codezy-backend-185224543792.asia-south2.run.app/terminal'

};