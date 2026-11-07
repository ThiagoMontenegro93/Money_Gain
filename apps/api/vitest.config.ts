import { defineConfig } from 'vitest/config';

// Os testes ponta a ponta compartilham o mesmo banco (e a restauração de backup sobrescreve tudo): rodar em série.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 60_000, hookTimeout: 60_000 } });
