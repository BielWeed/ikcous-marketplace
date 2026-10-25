/**
 * Geração do cofre local (IndexedDB `ikcous-datavault`) — caça 4, ressalva K1.
 *
 * Quem grava no cofre depois de uma ESPERA (resposta de rede, leitura do
 * IndexedDB) pode estar gravando para uma sessão que já acabou: o "Sair"
 * esvazia as gavetas de lojista, mas uma rodada de sincronização que estava
 * a caminho terminava depois e regravava o catálogo com custo.
 *
 * O contador é o aviso: quem vai esperar anota a geração antes e, ao voltar,
 * ANTES de escrever, compara — se mudou, descarta o que trouxe. Sobe quando o
 * motor de sincronização para (`stop()`) e quando o "Sair" esquece o cofre de
 * um lojista. Fica fora do motor de propósito: o `AuthContext` precisa
 * avisar sem puxar o motor inteiro para o pacote de entrada.
 */
let geracao = 0;

export function geracaoDoCofre(): number {
  return geracao;
}

/** Tudo que está em voo e anotou a geração anterior passa a ser descartável. */
export function invalidarGravacoesEmVoo(): void {
  geracao += 1;
}
