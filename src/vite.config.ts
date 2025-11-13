import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '7abd41af669c.ngrok-free.app'  // Add your specific ngrok host here
    ]
  }
});