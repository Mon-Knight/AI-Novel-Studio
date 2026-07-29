import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const VENDOR_CHUNKS = [
  {
    name: 'vendor-react',
    packages: ['react', 'react-dom', 'scheduler'],
  },
  {
    name: 'vendor-router',
    packages: ['react-router', 'react-router-dom', '@remix-run/router'],
  },
  {
    name: 'vendor-zustand',
    packages: ['zustand', 'use-sync-external-store'],
  },
  {
    name: 'vendor-tauri',
    packages: ['@tauri-apps/api'],
  },
] as const;

function resolveVendorChunk(moduleId: string): string | undefined {
  const normalizedId = moduleId.replaceAll('\\', '/');
  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  for (const vendorChunk of VENDOR_CHUNKS) {
    if (
      vendorChunk.packages.some((packageName) =>
        normalizedId.includes(`/node_modules/${packageName}/`),
      )
    ) {
      return vendorChunk.name;
    }
  }

  return 'vendor-misc';
}

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  build: {
    manifest: true,
    chunkSizeWarningLimit: 450,
    rollupOptions: {
      output: {
        manualChunks: resolveVendorChunk,
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
