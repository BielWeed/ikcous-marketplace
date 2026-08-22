/**
 * Config RÁPIDA — para o ciclo de trabalho, NUNCA para provar nada.
 *
 * Idêntica ao `eslint.config.js`, com UMA regra desligada:
 * `tailwindcss/no-custom-classname`.
 *
 * ## O número que justifica
 *
 * Medido em 20/08/2026 com `TIMING=10`, no mesmo arquivo
 * (`src/views/admin/AdminCouponsView.tsx`), nesta máquina:
 *
 * | rodada                                   | tempo   |
 * |------------------------------------------|---------|
 * | config normal                            | 48,4 s  |
 * | apontando `settings.tailwindcss.config`  | 42,2 s  |
 * | **sem `no-custom-classname`**            | **4,5 s** |
 *
 * Ranking de regras na rodada normal:
 *   tailwindcss/no-custom-classname .... 43.210 ms .... 96,3%
 *   todas as outras juntas .............. 1.632 ms ..... 3,7%
 *
 * A regra é de thread única (medido: 8,2% de CPU em 12 núcleos) e não
 * paraleliza por dentro — dar mais processador não a acelera. Ela monta o
 * conjunto completo de classes do Tailwind e refaz esse trabalho por arquivo.
 *
 * ## 🔴 POR QUE ISTO NÃO SUBSTITUI O `lint:ratchet`, e a distinção é o ponto
 *
 * `tailwindcss/no-custom-classname` está como **"warn"** no
 * `flat/recommended` do plugin (conferido em `eslint-plugin-tailwindcss`,
 * e o `eslint.config.js` não sobrescreve). Ou seja: ela produz **warnings**,
 * e warnings são exatamente o que a catraca de `.lint-baseline.json` protege.
 *
 * Se esta config alimentasse a catraca, a contagem local ficaria **abaixo** do
 * teto sempre — e a catraca só reprova quando um número SOBE. Ela passaria
 * sempre, viraria decorativa, e diria "sim" para dívida nova de verdade.
 *
 * **Trocar espera por um verde falso é pior que esperar.** Por isso são dois
 * comandos, com dois propósitos:
 *
 *   npm run lint:rapido    -> trabalhar (esta config, ~10x mais rápido)
 *   npm run lint:ratchet   -> PROVAR   (config normal, é o que o CI cobra)
 *
 * Nada que saia daqui vale como evidência em PR, relatório ou "está pronto".
 */
import base from "./eslint.config.js";

export default [
  ...base,
  {
    rules: {
      // A única diferença para a config normal. Ver o cabeçalho.
      "tailwindcss/no-custom-classname": "off",
    },
  },
];
