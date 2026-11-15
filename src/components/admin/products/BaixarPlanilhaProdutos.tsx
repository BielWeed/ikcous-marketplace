import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** A permissão vem do mesmo isAdmin que escolhe a leitura administrativa com custos. */
export function BaixarPlanilhaProdutos({
  permitido = false,
  nomeLoja = "loja",
  idDaContaViva,
}: {
  readonly permitido?: boolean;
  readonly nomeLoja?: string;
  readonly idDaContaViva?: () => string | undefined;
}) {
  const [gerando, setGerando] = useState(false);
  const emVoo = useRef<AbortController | null>(null);
  const permissao = useRef(permitido);
  permissao.current = permitido;
  useEffect(() => {
    if (!permitido) emVoo.current?.abort();
    return () => {
      emVoo.current?.abort();
    };
  }, [permitido]);

  async function baixar() {
    if (emVoo.current || !permitido) return;
    const conta = idDaContaViva?.();
    if (!conta) return;
    const controle = new AbortController();
    emVoo.current = controle;
    const podeContinuar = () =>
      !controle.signal.aborted &&
      permissao.current &&
      idDaContaViva?.() === conta;
    setGerando(true);
    try {
      const { exportarProdutosPlanilha } = await import(
        "@/lib/exportar-produtos-planilha"
      );
      if (!podeContinuar()) return;
      const formato = await exportarProdutosPlanilha({
        conta,
        nomeLoja,
        comCustos: permitido,
        sinal: controle.signal,
        podeContinuar,
      });
      if (podeContinuar()) {
        if (formato === "csv")
          toast.warning(
            "Não foi possível gerar o XLSX. Baixamos o catálogo completo em CSV, sem a formatação.",
          );
        else
          toast.success(
            "Planilha do catálogo completo baixada, sem os filtros da tela.",
          );
      }
    } catch {
      if (podeContinuar())
        toast.error("Não foi possível baixar a planilha. Tente novamente.");
    } finally {
      emVoo.current = null;
      setGerando(false);
    }
  }

  if (!permitido) return null;
  const Icone = gerando ? LoaderCircle : Download;
  return (
    <div className="produtos-cupons">
      <button
        type="button"
        aria-label={gerando ? "Gerando planilha" : "Baixar planilha"}
        aria-busy={gerando}
        title="Baixar planilha do catálogo completo, sem os filtros da tela"
        disabled={gerando}
        onClick={() => void baixar()}
        className="flex min-h-11 items-center gap-3 rounded-2xl border border-admin-border bg-admin-raised px-3.5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold"
      >
        <span aria-hidden="true">
          <Icone className={gerando ? "size-5 animate-spin" : "size-5"} />
        </span>
        <span className="hidden sm:inline">
          {gerando ? "Gerando…" : "Baixar planilha"}
        </span>
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
