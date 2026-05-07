import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    // VS Code 터널 / Tailscale / 임의 호스트네임 모두 허용 (dev only)
    allowedHosts: true,
    cors: true,
    // VS Code 터널·Tailscale 환경에서 HMR WebSocket 이 자주 깨져 페이지 백지 됨.
    // dev 편의보다 페이지 로딩 우선 — false 로 비활성화. 필요 시 개별 설정.
    hmr: false,
    proxy: {
      // 어댑터 라이브 WebSocket 스트림 (/ws/map, /ws/pose).
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      // /api/system/* 은 어댑터(:8000) 가 직접 처리 — 인증 X, 빠른 라이브 데이터.
      // 나머지 /api/* 는 Spring(:8080) 으로.
      '/api/system': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
