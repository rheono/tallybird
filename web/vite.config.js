import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ANON_KEY, LEAKED_AI_KEY } from '../server/config.js';

// The vulnerable build bakes both keys into the bundle, like a .env file full
// of VITE_ variables would. The fixed build ships only the public database key.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(ANON_KEY),
    'import.meta.env.VITE_AI_API_KEY': JSON.stringify(mode === 'fixed' ? '' : LEAKED_AI_KEY),
  },
  server: { proxy: { '^/(rest|auth|storage|api|mock-ai)/': 'http://127.0.0.1:4747' } },
}));
