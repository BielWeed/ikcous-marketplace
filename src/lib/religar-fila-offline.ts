import { sessaoAindaEhDoDono } from "@/lib/sessao-ainda-e-do-dono";
import { supabase } from "@/lib/supabase";

/**
 * Filas offline de pedidos e de produtos: a passada que parou porque o
 * supabase-js não conseguiu RENOVAR o token por falta de internet.
 *
 * Com o token vencido, a rede volta e o evento `online` dispara a passada 1 s
 * depois -- mas a renovação ainda está falhando (o supabase-js guarda a falha
 * por 60 s) e `getSession()` devolve `session: null` com um erro de rede. A
 * passada encerra sem enviar nada (é a trava de troca de conta, e está certa),
 * mas ninguém a refazia: os efeitos só dependem de `user?.id`, `isAdmin` e do
 * `online`. O cancelamento aparecia como feito na tela e o servidor não o
 * recebia.
 *
 * `paradasPelaRede` registra, por fila de um dono (a chave do armazenamento),
 * que a ÚLTIMA passada parou assim. A passada faz `delete` no começo e `add`
 * só dentro do `aoFalharPorRede` de `sessaoAindaEhDoDono`: sessão encerrada,
 * conta trocada e token recusado pelo servidor NÃO são rede e não entram. O
 * efeito do hook lê com `has` ao fim da passada.
 */
export const paradasPelaRede = new Set<string>();

/**
 * Espera a sessão do dono voltar (`TOKEN_REFRESHED`/`SIGNED_IN` do MESMO
 * usuário) e chama `retomar` UMA vez -- sem timer e sem polling. Vive no
 * efeito do hook: `encerrar()` no desmonte desfaz tudo.
 *
 * `retomar` só pode agendar a passada (nunca chamar o supabase aqui dentro: o
 * supabase-js entrega o evento segurando a própria trava de sessão).
 * A passada refeita confere a sessão antes de CADA envio, como a primeira: o
 * aviso só diz QUANDO tentar de novo, nunca que o envio é seguro.
 */
export function criarReligadorDaFila(userId: string, retomar: () => void) {
  let espera: { unsubscribe: () => void } | null = null;
  let fechado = false;
  const desarmar = () => {
    espera?.unsubscribe();
    espera = null;
  };
  const religar = () => {
    if (!espera) return;
    desarmar();
    retomar();
  };
  return {
    /** Fim de cada passada: só continua à espera se ela parou pela rede. */
    aoFimDaPassada(parouPelaRede: boolean) {
      desarmar();
      if (!parouPelaRede || fechado) return;
      espera = supabase.auth.onAuthStateChange((evento, sessao) => {
        if (
          (evento === "TOKEN_REFRESHED" || evento === "SIGNED_IN") &&
          sessao?.user?.id === userId
        ) {
          religar();
        }
      }).data.subscription;
      // A renovação pode ter saído entre a leitura da sessão e esta
      // assinatura: aquele aviso já passou e não volta.
      sessaoAindaEhDoDono(userId).then((ehDoDono) => ehDoDono && religar());
    },
    /** Desmonte da tela ou troca de usuário. */
    encerrar() {
      fechado = true;
      desarmar();
    },
  };
}
