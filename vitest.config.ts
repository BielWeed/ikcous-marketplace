import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runner de teste do front (INFRA-150, #70).
 *
 * POR QUE UM ARQUIVO SEPARADO DO `vite.config.ts`:
 * o config de build daquele arquivo é uma função que lê `branding.json`,
 * monta o plugin do PWA e imprime a versão no console. Rodar tudo isso a cada
 * `vitest` custa tempo e, pior, faz o teste depender de arquivo de branding e
 * de variável de ambiente que ele não usa. Aqui só entra o que o teste precisa:
 * o alias `@` e o padrão de arquivos.
 *
 * POR QUE `environment: "node"` E NÃO jsdom:
 * o que existe hoje são testes de função pura (os mappers). Instalar jsdom e
 * @testing-library agora seria dependência sem um único teste que a use. Quem
 * escrever o primeiro teste de componente instala as duas NAQUELE PR, onde dá
 * para julgar se valem o peso.
 *
 * POR QUE `tests/front/` E NÃO UM `.test.ts` AO LADO DE CADA FONTE EM `src/`:
 * `npm run test:unit` roda `deno test` em `tests/`, e o Deno considera
 * `*.test.ts` arquivo de teste dele. Sem uma pasta própria os dois runners
 * brigariam pelos mesmos arquivos. O `--ignore=tests/front` do script do Deno
 * é a outra metade desse acordo.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/front/**/*.test.ts"],
    // Sem isto o vitest varre node_modules e as cópias do repositório que
    // moram em .claude/worktrees — o mesmo problema que a catraca de lint teve.
    exclude: ["node_modules/**", "dist/**", ".claude/**", "supabase/**"],
    reporters: ["default"],
  },
});
