/**
 * Laudo 0109 (C5): guarda de rede lenta para downloads em segundo plano.
 *
 * O warmer de cache mandava o service worker baixar TODAS as imagens dos
 * banners + 15 produtos nas URLs originais no idle do boot, sem olhar a
 * rede — no 3G do celular do cliente isso é gasto de dados e banda
 * competindo com a vitrine. O `usePrefetchOnHover` já tinha a guarda; este
 * util a torna pura e testável para os demais chamadores.
 *
 * Sem a Network Information API (iOS Safari, por exemplo) devolve `false`:
 * sem informação, não há como acusar lentidão — comporta-se como hoje.
 */
interface InfoDaConexao {
  effectiveType?: string;
  saveData?: boolean;
}

export function redeLenta(conexao: InfoDaConexao | undefined): boolean {
  if (!conexao) return false;
  if (conexao.saveData) return true;
  return conexao.effectiveType === "slow-2g" || conexao.effectiveType === "2g";
}

export function conexaoDoNavegador(): InfoDaConexao | undefined {
  return (navigator as Navigator & { connection?: InfoDaConexao }).connection;
}
