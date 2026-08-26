import { supabase } from "@/lib/supabase";
import React from "react";
import { toast } from "sonner";

/**
 * Portão do painel — confirma com o servidor antes de carregar o pacote do
 * admin.
 *
 * ── Por que isto saiu de dentro do `React.lazy` (achado 1 da auditoria de
 *    26/08/2026) ────────────────────────────────────────────────────────────
 *
 * Antes, a chamada `is_admin` morava dentro do carregador do `React.lazy` em
 * `App.tsx`, e o teste era `if (error || !data)`. Isso juntava duas coisas que
 * não são a mesma:
 *
 *   - o servidor RESPONDEU que a pessoa não é admin  → veredito, expulsa
 *   - o servidor NÃO RESPONDEU                        → não se sabe de nada
 *
 * Os dois caminhos faziam `window.location.href = "/"`. Um engasgo de rede de
 * um segundo despejava o lojista na loja com a página recarregando do zero, e
 * o aviso nem chegava a aparecer — o `import("sonner")` era assíncrono e a
 * navegação, síncrona logo abaixo, corria na frente.
 *
 * E havia um beco sem saída: `React.lazy` MEMORIZA o que o carregador resolve.
 * Uma vez resolvido como "não autorizado", ficava assim para sempre naquela
 * instância. Se a navegação fosse cancelada — o `beforeunload` de `App.tsx`
 * pergunta "quer mesmo sair?" quando há alteração não salva, e a pessoa pode
 * clicar em ficar — todo o painel virava um "Verificando permissões..." eterno,
 * sem saída a não ser F5 na mão.
 *
 * A lição já estava aplicada no vizinho `AdminAccessDenied` (`App.tsx`), que o
 * #123 consertou justamente para não tratar `adminStatus === "unknown"` como
 * "não é admin". Uma porta foi trancada e a outra ficou escancarada; aqui a
 * segunda fecha.
 *
 * O portão continua sendo portão: quem não é admin não monta o pacote do
 * painel, e o veredito continua vindo do servidor a cada montagem.
 */

const AdminAreaBundle = React.lazy(() =>
  import("@/components/layouts/AdminArea").then((m) => ({
    default: m.AdminArea,
  })),
);

type PropsDaArea = React.ComponentProps<typeof AdminAreaBundle>;

export interface AdminAreaGateProps extends PropsDaArea {
  /**
   * O que mostrar enquanto o portão verifica. Vem de `App.tsx` de propósito,
   * para o visual de carregamento continuar sendo o mesmo `AdminRouteLoading`
   * do resto das rotas do admin em vez de uma cópia divergente aqui dentro.
   */
  readonly fallback: React.ReactNode;
}

type EstadoDoPortao = "verificando" | "liberado" | "negado" | "falhou";

function TelaDeVerificacaoFalhou({
  onTentarDeNovo,
  onVoltar,
}: {
  readonly onTentarDeNovo: () => void;
  readonly onVoltar: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
        <svg
          className="size-8 text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p className="mt-6 text-[11px] font-black uppercase tracking-[0.2em] text-amber-400">
        Não foi possível confirmar seu acesso
      </p>
      {/* A frase evita acusar: o servidor não respondeu, e isso não diz nada
          sobre a permissão de quem está na tela. */}
      <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-zinc-500">
        O servidor não respondeu a tempo. Isso costuma ser a conexão — sua
        permissão não mudou.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onTentarDeNovo}
          className="rounded-lg border border-amber-500/30 bg-amber-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-amber-400"
        >
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={onVoltar}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-white/20"
        >
          Voltar à loja
        </button>
      </div>
    </div>
  );
}

export function AdminAreaGate({ fallback, ...props }: AdminAreaGateProps) {
  const { onNavigate } = props;
  const [estado, setEstado] = React.useState<EstadoDoPortao>("verificando");
  const [tentativa, setTentativa] = React.useState(0);

  React.useEffect(() => {
    let vivo = true;
    setEstado("verificando");

    (async () => {
      try {
        const { data, error } = await supabase.rpc("is_admin");
        if (!vivo) return;
        if (error) {
          // NÃO é veredito. O servidor não respondeu — quem decide aqui é o
          // ramo "falhou", que oferece saída em vez de expulsar.
          console.error("[AdminAreaGate] is_admin não respondeu:", error);
          setEstado("falhou");
          return;
        }
        setEstado(data ? "liberado" : "negado");
      } catch (err) {
        if (!vivo) return;
        console.error("[AdminAreaGate] Admin verification error:", err);
        setEstado("falhou");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [tentativa]);

  React.useEffect(() => {
    if (estado !== "negado") return;
    // Navegação do próprio app, não `window.location.href`: sem recarregar a
    // página, o aviso tem tempo de aparecer e nada em andamento é perdido.
    toast.error("Acesso restrito a administradores.");
    onNavigate("home");
  }, [estado, onNavigate]);

  if (estado === "liberado") {
    return (
      <React.Suspense fallback={fallback}>
        <AdminAreaBundle {...props} />
      </React.Suspense>
    );
  }

  if (estado === "falhou") {
    return (
      <TelaDeVerificacaoFalhou
        onTentarDeNovo={() => setTentativa((t) => t + 1)}
        onVoltar={() => onNavigate("home")}
      />
    );
  }

  // "verificando" e "negado" (enquanto a navegação acontece) mostram o mesmo
  // carregamento — em nenhum dos dois o pacote do painel é montado.
  return <>{fallback}</>;
}
