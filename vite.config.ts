import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works both at the root and under a project path
  // like username.github.io/last-exit/ without having to hard-code the repository name.
  base: './',
  server: { port: Number(process.env.PORT) || 5178, strictPort: false },
  // three is a single large dependency and there is nothing to code-split it against;
  // the warning is not actionable here.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
