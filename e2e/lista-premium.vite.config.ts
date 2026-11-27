// Servidor SÓ da bancada da lista premium (tarefas 0.16 e Z.4): `npx vite
// --config e2e/lista-premium.vite.config.ts` e abrir /e2e/lista-premium.html.
// Fora do build e do tsconfig do app. Não usa o vite.config.ts da raiz porque
// ele monta a identidade da loja (banco de verdade ou fixture), e a bancada não
// precisa de loja: só das telas do painel e da lista.
//
// SEM banco, SEM rede, SEM chave: `@/lib/supabase` e `@/lib/env` viram os
// dublês de `e2e/`, e nenhum arquivo `.env` é lido (o `envDir` aponta para
// uma pasta que não existe). Os hooks de loja e de login que a tela de
// Banners lê trocam SÓ o nome dublado; o resto do módulo é o de verdade. A
// identidade da loja (`__STORE_IDENTITY__`) é a mesma ficha de mentira dos
// testes do front.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { buildIdentityFixture } from "../tests/front/fixtures/build-identity";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const daBancada = (arquivo: string) =>
  fileURLToPath(new URL(`./${arquivo}`, import.meta.url)).replaceAll("\\", "/");

// módulo do app → o nome que o dublê substitui
const DUBLADOS = new Map([
  ["hooks/useAuth", "useAuth"],
  ["hooks/useBanners", "useBanners"],
  ["hooks/useProducts", "useProducts"],
  ["hooks/useCategories", "useCategories"],
  ["hooks/useCoupons", "useCoupons"],
  ["hooks/useOnlineStatus", "useOnlineStatus"],
  ["contexts/StoreContext", "useStore"],
]);
const PREFIXO = "virtual:bancada-dublado/";

function arquivoDoApp(modulo: string): string {
  const base = `${raiz}src/${modulo}`.replaceAll("\\", "/");
  const achado = [".ts", ".tsx"]
    .map((e) => base + e)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- só os 7 módulos fixos de DUBLADOS, dentro de src/.
    .find((a) => existsSync(a));
  if (!achado) throw new Error(`a bancada não achou ${modulo}`);
  return achado;
}

// O módulo dublado reexporta TUDO do de verdade e troca só o nome dublado (a
// exportação com nome vence a `export *`).
function dublesDaBancada(): Plugin {
  return {
    name: "dubles-da-bancada",
    enforce: "pre",
    resolveId(id) {
      return id.startsWith(PREFIXO) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIXO}`)) return null;
      const modulo = id.slice(PREFIXO.length + 1);
      return [
        `export * from "${arquivoDoApp(modulo)}";`,
        `export { ${DUBLADOS.get(modulo)} } from "${daBancada("lista-premium-dubles.ts")}";`,
      ].join("\n");
    },
  };
}

export default defineConfig({
  root: raiz,
  envDir: daBancada("sem-env-de-proposito"),
  define: { __STORE_IDENTITY__: JSON.stringify(buildIdentityFixture) },
  plugins: [dublesDaBancada(), react()],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/supabase$/,
        replacement: daBancada("lista-premium-supabase.ts"),
      },
      {
        find: /^@\/lib\/env$/,
        replacement: daBancada("lista-premium-dubles.ts"),
      },
      // `find` em texto casa o nome exato (ou `nome/…`, que não existe aqui).
      ...[...DUBLADOS.keys()].map((modulo) => ({
        find: `@/${modulo}`,
        replacement: `${PREFIXO}${modulo}`,
      })),
      {
        find: "@",
        replacement: fileURLToPath(new URL("../src", import.meta.url)),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
