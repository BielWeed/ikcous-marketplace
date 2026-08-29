import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import tailwindcss from "eslint-plugin-tailwindcss";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist",
    ".unlighthouse",
    ".agents",
    "node_modules",
    "temp_db",
    // Sem estas quatro linhas o eslint entra em .claude/worktrees/, que é uma
    // CÓPIA do próprio repositório, e reporta cada problema duas vezes: na
    // máquina do Gabriel dava 14 erros e 1106 warnings, contra os 7 e 553
    // reais que o CI mede (onde essas pastas não existem). Contagem local
    // que não bate com a do CI torna impossível ter catraca de lint.
    ".claude",
    ".serena",
    ".playwright-mcp",
    "scratch",
  ]),
  ...tailwindcss.configs["flat/recommended"],
  security.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    settings: {
      tailwindcss: {
        whitelist: [
          "custom-scrollbar",
          "custom-scrollbar-hidden",
          "active-scroll-container",
          "bg-rose-650",
          "text-zinc-350",
          "border-zinc-955",
          "bg-purple-550",
          "scale-98",
          "scrollbar-thin",
          "scrollbar-thumb-zinc-800",
          "scrollbar-track-transparent",
          "bg-radial-gradient",
          "animate-duration-3000",
          "text-emerald-450",
          "bg-red-650",
          "bg-red-550",
          "text-zinc-505",
          "text-red-655",
          "text-emerald-750",
          "text-zinc-905",
          "border-zinc-150/80",
          "border-zinc-150/50",
          "border-3",
          "shadow-3xl",
          "text-zinc-455",
          "scale-102",
          "bg-zinc-955",
          "bg-zinc-950/98",
          "scrollbar-none",
          "pl-5.5",
          "scale-115",
          "luxury-bell-active",
          "animate-luxury-shimmer",
          "size-\\(--cell-size\\)",
          "size-(--cell-size)",
          "animate-all",
          "py-0.25",
          "-gap-1",
          "w-\\(--sidebar-width\\)",
          "w-(--sidebar-width)",
          "size-8\\!",
          "size-8!",
          "p-2\\!",
          "p-2!",
          "p-0\\!",
          "p-0!",
          "max-w-\\(--skeleton-width\\)",
          "max-w-(--skeleton-width)",
          "toaster",
          "text-red-450",
          "text-red-650",
        ],
        // 🔴 Sem estas linhas a catraca local levava HORAS. Medido em 28/08/2026.
        //
        // O default do plugin e'
        //   ['**/*.css', '!**/node_modules', '!**/.*', '!**/dist', '!**/build']
        // e `!**/node_modules` nega a ENTRADA do diretorio, nao o CONTEUDO dele:
        // `node_modules/**/*.css` continua casando com `**/*.css`. Resultado, a
        // regra `no-custom-classname` varre `node_modules` inteiro para achar os
        // 3 arquivos de CSS do projeto -- e repete isso A CADA ARQUIVO LINTADO,
        // porque o cache dela e' TTL de 5 s (`lib/util/cssFiles.js`) enquanto a
        // varredura leva 22 s. A memoria dele nasce vencida, sempre.
        //
        //   !**/node_modules      21.959 ms  ->  97 classes
        //   !**/node_modules/**      160 ms  ->  97 classes, lista IDENTICA
        //
        // 137x, e nao e' afrouxamento: a LISTA de classes e' a mesma, item a
        // item. Vezes 529 arquivos, os 22 s sao as 2h31min que uma rodada
        // chegou a consumir em 27/08 antes de ser morta.
        //
        // Se um dia isto voltar a demorar, o sinal e' grosseiro (alguem vai
        // esperar horas de novo) e o primeiro suspeito e' esta lista ter sido
        // perdida numa atualizacao do plugin.
        cssFiles: [
          "**/*.css",
          "!**/node_modules/**",
          "!**/.*/**",
          "!**/dist/**",
          "!**/build/**",
        ],
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      "react-refresh/only-export-components": "off",
      "no-case-declarations": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
