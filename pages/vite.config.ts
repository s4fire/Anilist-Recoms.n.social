import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // TODO: replace REPO_NAME with the GitHub repository name before publishing.
  base: '/REPO_NAME/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
})
