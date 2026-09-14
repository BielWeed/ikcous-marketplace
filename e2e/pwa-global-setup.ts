import { escreverFichaNoTemp } from "./pwa-kit";

// Global setup do CI-PWA: grava a ficha da loja fixture no arquivo ÚNICO que
// o servidor de teste (e2e/pwa-servidor.mjs) lê — roda antes do webServer
// subir, uma vez por execução.
export default async function globalSetup(): Promise<void> {
  await escreverFichaNoTemp();
}
