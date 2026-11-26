import type { Plugin } from "vite";
import { marcarDeployNoHtml } from "../src/hospedagem/marcaDoDeploy";

// O build grava o `VERCEL_DEPLOYMENT_ID` no index.html para o porteiro só
// guardar em memória o HTML do PRÓPRIO deploy (o porquê e a falha segura estão
// em `src/hospedagem/marcaDoDeploy.ts`). Fora da Vercel a variável não existe e
// o HTML sai byte a byte igual. `order: "post"`: depois da identidade da loja
// (`identityBuildConfig`, "pre"), que reescreve o <head>.
export function marcaDoDeployNoHtml(env: {
  readonly VERCEL_DEPLOYMENT_ID?: string;
}): Plugin {
  return {
    name: "ikcous-marca-do-deploy",
    transformIndexHtml: {
      order: "post",
      handler: (html) => marcarDeployNoHtml(html, env.VERCEL_DEPLOYMENT_ID),
    },
  };
}
