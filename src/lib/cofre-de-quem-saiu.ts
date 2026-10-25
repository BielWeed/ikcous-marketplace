import { DataVault, type StoreName } from "@/lib/dataVault";

/**
 * O que o "Sair" (e a troca direta de conta) esquece no cofre local — o
 * IndexedDB `ikcous-datavault` (caça 4, A1, 24/10/2026).
 *
 * Tablet de balcão compartilhado: o cofre sobrevive ao logout e é legível no
 * DevTools. Dele saem:
 *  - `coupons`: sempre. Nada lê essa gaveta (o motor de sincronização nem a
 *    grava mais); só pode sobrar o resíduo de versões antigas.
 *  - `products` e `product_variants`: quando quem saiu era LOJISTA — o
 *    catálogo de admin vem com custo e com produto pausado. Cliente comum
 *    guarda só o catálogo PÚBLICO, que o app oferece offline: esse FICA.
 *    Contrapartida conhecida: lojista que sai e recarrega o app SEM rede vê a
 *    vitrine vazia (com "Tentar de novo") até a rede voltar; o catálogo
 *    público volta inteiro na primeira consulta com rede.
 *
 * Dispara-e-esquece: NUNCA lança e quem chama não espera — o Sair não pode
 * travar por causa de IndexedDB negado, bloqueado ou lento.
 */
export function esquecerCofreDeQuemSaiu(eraLojista: boolean): void {
  const gavetas: StoreName[] = ["coupons"];
  if (eraLojista) gavetas.push("products", "product_variants");
  void (async () => {
    try {
      const vault = await DataVault.init();
      await Promise.all(
        gavetas.map((gaveta) =>
          vault.clear(gaveta).catch((err) => {
            console.warn(
              `[Auth] gaveta '${gaveta}' do cofre local não foi esvaziada:`,
              err,
            );
          }),
        ),
      );
    } catch (err) {
      console.warn("[Auth] cofre local indisponível para limpeza:", err);
    }
  })();
}

/**
 * O veredito do servidor sobre `userId` ficou guardado como "é lojista" neste
 * aparelho? (`ikcous_is_admin_<uid>`, gravado só por um veredito real da RPC
 * `is_admin`.) Lido ANTES de `clearLocalUserData` apagar essas chaves.
 */
export function ehLojistaPelaMarcaDoAparelho(
  userId: string | null | undefined,
): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`ikcous_is_admin_${userId}`) === "true";
  } catch {
    return false;
  }
}

/**
 * Qualquer marca de lojista no aparelho? Serve ao "Sair", onde o id de quem
 * saiu já foi zerado pelo listener. Varre todas as marcas porque um aparelho
 * compartilhado acumula marcas de várias contas — e errar para o lado de
 * limpar a mais custa só o cache offline do catálogo público.
 */
export function haMarcaDeLojistaNoAparelho(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (
        chave?.startsWith("ikcous_is_admin_") &&
        localStorage.getItem(chave) === "true"
      ) {
        return true;
      }
    }
    return localStorage.getItem("ikcous_is_admin") === "true";
  } catch {
    return false;
  }
}
