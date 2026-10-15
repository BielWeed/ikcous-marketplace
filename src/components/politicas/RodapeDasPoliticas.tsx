import {
  TIPOS_DE_POLITICA,
  nomeDaPolitica,
  viewDaPolitica,
} from "@/lib/nomes-das-politicas";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";

// Só o TIPO da identidade (apagado na compilação): o rodapé não importa a regra
// nem o texto jurídico — quem decide o que mostrar é a Home, que já tem o
// config. Importar o texto das políticas aqui engordaria a vitrine
// (`politicas-peso-do-rodape`).
import type { IdentidadeLegalDaLoja } from "@/lib/identidade-legal-da-loja";

/**
 * Os três links no fim da vitrine. Aqui é navegação mesmo (a cliente não
 * está no meio de nada): leva à página, e o voltar do app traz de volta.
 * Arquivo próprio e leve (só botões): a Home não carrega a folha de leitura.
 *
 * `identidade` (opcional): quando a lojista declarou razão social, CNPJ ou CPF
 * e e-mail de atendimento, uma linha curta embaixo dos links diz quem é a loja.
 * Sem ela (ou vazia) o rodapé é só os três links, como sempre foi.
 */
export function RodapeDasPoliticas({
  onNavigate,
  identidade,
}: {
  readonly onNavigate: (view: View) => void;
  readonly identidade?: IdentidadeLegalDaLoja | null;
}) {
  const quem = [
    identidade?.razaoSocial,
    identidade?.documento && identidade.tipoDoDocumento
      ? `${identidade.tipoDoDocumento === "cnpj" ? "CNPJ" : "CPF"} ${identidade.documento}`
      : null,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
  const email = identidade?.email ?? null;

  return (
    <>
      <nav
        aria-label="Políticas da loja"
        data-testid="rodape-das-politicas"
        className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-x-1 border-t border-border pt-2"
      >
        {TIPOS_DE_POLITICA.map((tipo) => (
          <button
            key={tipo}
            type="button"
            onClick={() => {
              haptic.light();
              onNavigate(viewDaPolitica(tipo));
            }}
            className="flex min-h-11 items-center px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2"
          >
            {nomeDaPolitica(tipo)}
          </button>
        ))}
      </nav>
      {(quem || email) && (
        <div
          data-testid="rodape-identidade-legal"
          className="relative z-10 flex flex-col items-center px-4 pb-2 text-center text-xs text-muted-foreground"
        >
          {quem && <p className="break-words">{quem}</p>}
          {email && (
            <a
              href={`mailto:${email}`}
              className="flex min-h-11 items-center break-all font-semibold underline underline-offset-2"
            >
              {email}
            </a>
          )}
        </div>
      )}
    </>
  );
}
