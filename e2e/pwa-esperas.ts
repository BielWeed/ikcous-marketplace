/** Só as capacidades usadas pelas esperas; sem importar o runner E2E. */
interface PaginaComLeitura {
  evaluate(predicado: () => Promise<boolean>): Promise<boolean>;
}

interface VerificadorComPolling {
  poll(
    ler: () => Promise<boolean>,
    opcoes: { timeout: number },
  ): { toBe(valor: boolean): Promise<unknown> };
}

/** Cache aberto no install não comprova ativação nem controle desta aba. */
export async function esperarServiceWorkerControlando(
  page: PaginaComLeitura,
  verificar: VerificadorComPolling,
): Promise<void> {
  // Page.waitForFunction testa a Promise truthy, não o booleano assíncrono.
  // O poll aguarda cada evaluate e só libera quando o valor lido é true.
  await verificar
    .poll(
      () =>
        page.evaluate(async () => {
          const registro = await navigator.serviceWorker.getRegistration();
          return (
            registro?.active?.state === "activated" &&
            navigator.serviceWorker.controller === registro.active
          );
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Ausência de registro ou de waiting nunca significa atualização pronta. */
export async function esperarServiceWorkerEmEspera(
  page: PaginaComLeitura,
  verificar: VerificadorComPolling,
): Promise<void> {
  await verificar
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.waiting
              ?.state === "installed",
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
