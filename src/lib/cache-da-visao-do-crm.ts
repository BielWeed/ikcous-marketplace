import type { VisaoDoCrm } from "@/types/crm";

// Compartilhado com useAnalytics sem importar hooks em círculo.
export const cacheDaVisao = new Map<
  string,
  { readonly visao: VisaoDoCrm; readonly lidoEm: number }
>();
let geracao = 0;

export function lerGeracaoDaVisaoDoCrm() {
  return geracao;
}

export function invalidarVisaoDoCrm() {
  geracao += 1;
  cacheDaVisao.clear();
}
