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
    include: ["tests/front/**/*.test.{ts,tsx}"],
    // Sem isto o vitest varre node_modules e as cópias do repositório que
    // moram em .claude/worktrees — o mesmo problema que a catraca de lint teve.
    exclude: ["node_modules/**", "dist/**", ".claude/**", "supabase/**"],
    reporters: ["default"],
    // DOIS AJUSTES QUE VALEM SÓ FORA DO CI — e as duas causas que os pediram.
    //
    // (1) TETO DE TRABALHADORES. O Vitest 4 usa `pool: "forks"` e, em
    // `vitest run`, resolve `max(núcleos - 1, 1)` — 11 nesta máquina de 12
    // núcleos (`resolveMaxWorkers`, em
    // `node_modules/vitest/dist/chunks/cli-api.*.js`). Cada fork é um processo
    // Node inteiro, e 58 dos 69 arquivos daqui pedem jsdom pelo docblock
    // `@vitest-environment jsdom`. Onze desses ao mesmo tempo esgotam o
    // Windows: o sistema passa a recusar `spawn` e até `lstat` de arquivo que
    // existe, com `errno -4094` (UV_UNKNOWN), e o Vitest reporta
    // `Worker exited unexpectedly`.
    //
    // O efeito era pior que lentidão. A suíte reprovava um conjunto DIFERENTE
    // de testes a cada rodada, e uma delas terminou em
    // `Test Files 61 passed (61)` — verde no resumo, com 8 arquivos que nunca
    // nasceram contados à parte como `Errors`. O exit code era 1, então CI e
    // hook barravam; quem lê o resumo, não. A âncora do denominador é o disco
    // (`ls tests/front/ | wc -l` → 69), nunca o próprio relatório: quando o
    // arquivo falha no `spawn`, ele sai TAMBÉM do número entre parênteses.
    //
    // Medido em 20/08/2026, mesma árvore, sem nenhuma mudança entre rodadas,
    // alternando os modos na mesma janela para descartar "a máquina estava mais
    // folgada" — o padrão reprovou com 3,29 GB livres enquanto o teto de 4
    // passava limpo com 2,88 GB:
    //
    //   11 (padrão) — 6 rodadas, 0 verdes
    //    8          — 2 rodadas, 0 verdes
    //    6          — 2 rodadas, 1 verde   (ainda instável)
    //    4          — 9 rodadas, 9 verdes, mais 10 de confirmação
    //
    // O limite é de MEMÓRIA, não de CPU — por isso número fixo, e não fração
    // dos núcleos. Antes de subir, meça: 6 já reprovou aqui.
    //
    // (2) `testTimeout`. O teto de trabalhadores resolveu o esgotamento de
    // recurso e não tinha como resolver a segunda causa, que é lentidão pura
    // desta máquina: dois testes passam dos 5000 ms padrão em TODA rodada.
    // Medido com `--testTimeout=60000`, para o próprio teto não truncar a
    // medição (5 rodadas, todas verdes):
    //
    //   admin-user-detail... > "o card conta os pedidos que valem"
    //     5522 · 5685 · 6342 · 7689 ms
    //   user-profile-view-gate-avaliacoes... > "com o flag DESLIGADO"
    //     5752 · 5776 · 5920 · 6808 · 7845 ms
    //
    // O primeiro já reprovou de verdade, com `Test timed out in 5000ms` aos
    // 5180 ms — e voltou a bater 5102 ms JÁ COM o teto de 4 aplicado. São duas
    // causas independentes; nenhum dos dois ajustes cobre a do outro.
    //
    // POR QUE 15000, E POR QUE ISSO NÃO É AFROUXAR: os mesmos dois testes
    // custam no máximo 2878 ms e 2448 ms no CI (teto superior lido do log do
    // run verde, por arquivo) contra 5522–7845 ms aqui — uma razão de 2,7x a
    // 3,2x entre as maquinas. `5000 x 3,2 ≈ 16000`. Ou seja: 15000 local é o
    // 5000 do CI convertido para esta máquina, com 6% de aperto. Os dois
    // limites são o MESMO limite, normalizado pela velocidade de quem roda.
    //
    // POR QUE O CI FICA DE FORA DOS DOIS: lá a suíte passa verde. Pelo log do
    // run, o front leva `Duration 84.07s` com razão trabalho/parede ≈ 0,93 —
    // isto é, UM trabalhador (o que sugere runner de 2 vCPU; inferido da razão,
    // não medido com `nproc`). Um fork só significa zero contenção, então o
    // teto não resolveria nada lá, e manter 5000 ms preserva a única rede que
    // pega regressão real de performance.
    //
    // ANTES DE CRESCER: o teto de 4 é de memória, então o tempo de parede local
    // cresce linearmente com o número de arquivos e não há para onde escapar
    // subindo trabalhador. Hoje: ~2,7 s de trabalho por arquivo (dos quais
    // ~1,36 s só para montar jsdom), 69 arquivos, ~51 s de parede. Por volta de
    // 150 arquivos a rodada local passa de 100 s. A saída, quando chegar, NÃO é
    // subir este número — é baixar o custo de jsdom por arquivo.
    //
    // Os dois testes lentos são lentos de verdade (5,5 a 7,8 s para renderizar
    // uma tela). Isso é cheiro, não defeito medido: deixá-los rápidos é outro
    // trabalho, com outra justificativa.
    ...(process.env.CI ? {} : { maxWorkers: 4, testTimeout: 15000 }),
  },
});
