/**
 * REDE VERIFICADA PARA A PURGA DE VERSÃO OBRIGATÓRIA (minAppVersion) —
 * atualização única e obrigatória, 16/10/2026.
 *
 * A purga de versão obrigatória apaga o service worker, os caches do app e o
 * IndexedDB. Rodá-la sem rede deixa o aparelho SEM app: nada para recarregar,
 * nada offline. Então ela só roda com rede PROVADA: o navegador não declara
 * offline E o próprio hook leu `/version.json` com sucesso há pouco (a mesma
 * leitura por conteúdo do módulo único de versão — portal cativo que responde
 * 200 com HTML não conta). Sem isso, aguarda.
 *
 * Função pura: o hook lê o relógio, o `navigator.onLine` e o registro da última
 * leitura, e passa os fatos.
 */

/** Por quanto tempo uma leitura bem-sucedida de /version.json ainda prova a rede. */
export const VALIDADE_DA_LEITURA_DE_VERSAO_MS = 5 * 60 * 1000;

export interface FatosDaRede {
  /** Instante da última leitura BEM-SUCEDIDA de /version.json (nulo = nunca). */
  readonly ultimaLeituraBemSucedidaEm: number | null;
  readonly agora: number;
  /** `navigator.onLine` (indefinido = o ambiente não informa). */
  readonly online: boolean | undefined;
}

export function redeVerificadaParaPurga(fatos: FatosDaRede): boolean {
  if (fatos.online === false) return false;
  if (fatos.ultimaLeituraBemSucedidaEm === null) return false;
  const idade = fatos.agora - fatos.ultimaLeituraBemSucedidaEm;
  // Relógio que andou para trás (idade negativa) não prova nada.
  return idade >= 0 && idade <= VALIDADE_DA_LEITURA_DE_VERSAO_MS;
}
