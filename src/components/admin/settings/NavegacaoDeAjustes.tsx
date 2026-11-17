import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  type ChaveDoGrupoDeAjustes,
  GRUPOS_DE_AJUSTES,
} from "./grupos-de-ajustes";
import { IconeDeAjustes, type MatizDeAjustes } from "./visual-ajustes";

const CONSULTA_DESKTOP = "(min-width: 1280px)";
const retratoDoServidor = () => false;
const retratoDesktop = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(CONSULTA_DESKTOP).matches
    : false;
function acompanharDesktop(avisar: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};
  const consulta = window.matchMedia(CONSULTA_DESKTOP);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

/** Uma assinatura por tela; a largura não desmonta os formulários. */
export function useAjustesDesktop() {
  return useSyncExternalStore(
    acompanharDesktop,
    retratoDesktop,
    retratoDoServidor,
  );
}

const DESCRICOES = new Map<ChaveDoGrupoDeAjustes, string>([
  ["minha-loja", "Marca, endereço e atendimento"],
  ["aparencia", "Banners, vitrines e cores"],
  ["entrega", "Frete local e transportadoras"],
  ["pagamentos", "Formas de receber"],
  ["devolucao", "Prazos e política da loja"],
  ["ferramentas", "Conexão e diagnóstico"],
]);

export function NavegacaoDeAjustes({
  selecionado,
  onSelecionar,
  subtitulos,
  visuais,
  pendencias,
}: {
  readonly selecionado: ChaveDoGrupoDeAjustes;
  readonly onSelecionar: (chave: ChaveDoGrupoDeAjustes) => void;
  readonly subtitulos: ReadonlyMap<ChaveDoGrupoDeAjustes, string>;
  readonly visuais: ReadonlyMap<
    ChaveDoGrupoDeAjustes,
    { icone: LucideIcon; matiz: MatizDeAjustes }
  >;
  readonly pendencias: ReadonlyMap<ChaveDoGrupoDeAjustes, boolean>;
}) {
  return (
    <nav aria-label="Grupos de ajustes" className="ajustes-indice">
      {GRUPOS_DE_AJUSTES.map((grupo) => {
        const visual = visuais.get(grupo.chave);
        return (
          <button
            key={grupo.chave}
            type="button"
            aria-current={selecionado === grupo.chave ? "true" : undefined}
            aria-controls={
              grupo.chave === "entrega"
                ? undefined
                : `grupo-de-ajustes-${grupo.chave}`
            }
            onClick={() => onSelecionar(grupo.chave)}
          >
            {visual && (
              <IconeDeAjustes icone={visual.icone} matiz={visual.matiz} />
            )}
            <span className="min-w-0 flex-1">
              <span className="ajustes-indice-titulo">{grupo.titulo}</span>
              <span className="ajustes-indice-descricao">
                {subtitulos.get(grupo.chave) ?? DESCRICOES.get(grupo.chave)}
              </span>
              {pendencias.get(grupo.chave) && (
                <span className="ajustes-indice-pendente">
                  Alterações não salvas
                </span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
