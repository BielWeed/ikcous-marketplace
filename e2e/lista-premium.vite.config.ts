// Servidor SÓ da bancada da lista premium (tarefa 0.16): `npx vite --config
// e2e/lista-premium.vite.config.ts` e abrir /e2e/lista-premium.html. Fora do
// build e do tsconfig do app. Não usa o vite.config.ts da raiz porque ele
// monta a identidade da loja (banco de verdade ou fixture), e a bancada não
// precisa de loja: só das duas folhas do painel e da lista.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const raiz = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: raiz,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@\/hooks\/useFinanceiro$/,
        replacement: fileURLToPath(
          new URL("./lista-premium-useFinanceiro.ts", import.meta.url),
        ),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("../src", import.meta.url)),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
