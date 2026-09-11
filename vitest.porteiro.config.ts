import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config PRÓPRIO para a prova ponta a ponta com hosts do porteiro (T6, etapa
 * 2 da escala, ADENDO C, 11/09/2026): `tests/porteiro-dois-hosts/*.test.ts`
 * SOBE UM SERVIDOR HTTP DE VERDADE (`node:http`) e serve arquivos reais de
 * `dist-test/` — não é o mesmo tipo de teste de `vitest.config.ts`
 * (funções puras, sem I/O real), e por isso vive num config separado, fora
 * de `npm run test:front`.
 *
 * POR QUE UM JOB PRÓPRIO NO CI, NÃO `npm run test:front`: `dist-test/` só
 * existe DEPOIS de `IKCOUS_IDENTITY_MODE=fixture npm run build`, que roda no
 * job `build` — `npm run test:front` roda no job `test`, sem o build. Este
 * config é chamado com `npx vitest run --config vitest.porteiro.config.ts`
 * logo depois do build, no MESMO job (ver `.github/workflows/ci.yml`).
 *
 * POR QUE `environment: "node"`: o servidor e o cliente de teste (`node:http`)
 * são puro Node, sem DOM. `jsdom` aqui seria peso morto.
 *
 * SEM `setupFiles`: `tests/front/setup-build-identity.ts` existe para os
 * testes de `tests/front/`, que importam código que lê `__STORE_IDENTITY__`
 * (o define do build). Nada no caminho `middleware.ts -> porteiro.ts -> ...`
 * que este ensaio exercita depende daquele define — importar o setup aqui
 * seria acoplamento sem uso.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/porteiro-dois-hosts/*.test.ts"],
    reporters: ["default"],
  },
});
