import { fileURLToPath } from "node:url";
import { type UserConfigFnPromise, defineConfig } from "vite";
import baseConfig from "../../vite.config";

// Reutiliza CSS, React e a identidade sintética reais; substitui só fontes de dados.
// Não carrega conta, banco, autenticação nem credenciais.
export default defineConfig(async (env) => {
  if (process.env.IKCOUS_IDENTITY_MODE !== "fixture")
    throw new Error("Use IKCOUS_IDENTITY_MODE=fixture");
  const config = await (baseConfig as UserConfigFnPromise)(env);
  const stub = fileURLToPath(new URL("./fontes-ficticias.ts", import.meta.url));
  const modulos = [
    "@/contexts/StoreContext",
    "@/contexts/CartContext",
    "@/hooks/useCategories",
    "@/hooks/useBanners",
    "@/hooks/usePrefetchOnHover",
  ];
  config.resolve = {
    ...config.resolve,
    alias: [
      ...modulos.map((find) => ({ find, replacement: stub })),
      ...(config.resolve?.alias as { find: string; replacement: string }[]),
    ],
  };
  config.server = {
    ...config.server,
    host: "127.0.0.1",
    port: 5197,
    strictPort: true,
    open: false,
    hmr: { clientPort: 5197 },
  };
  return config;
});
