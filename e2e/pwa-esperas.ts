/** Só a capacidade usada pelas esperas; não depende dos tipos do runner E2E. */
interface PaginaComEspera {
  waitForFunction(
    predicado: () => Promise<boolean>,
    argumento: undefined,
    opcoes: { timeout: number },
  ): Promise<unknown>;
}

/** Cache aberto no install não comprova ativação nem controle desta aba. */
export async function esperarServiceWorkerControlando(
  page: PaginaComEspera,
): Promise<void> {
  await page.waitForFunction(
    async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      return (
        registro?.active?.state === "activated" &&
        navigator.serviceWorker.controller === registro.active
      );
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Ausência de registro ou de waiting nunca significa atualização pronta. */
export async function esperarServiceWorkerEmEspera(
  page: PaginaComEspera,
): Promise<void> {
  await page.waitForFunction(
    async () =>
      (await navigator.serviceWorker.getRegistration())?.waiting?.state ===
      "installed",
    undefined,
    { timeout: 30_000 },
  );
}
