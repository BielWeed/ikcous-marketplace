import {
  type NotaDaVersao,
  ehNotaDaVersao,
  notasEntre,
} from "@/lib/novidades/notas";
import { nucleoSemver, partesDoNucleoSemver } from "@/lib/versao-do-servidor";
import { useSyncExternalStore } from "react";

export interface Novidade extends NotaDaVersao {
  versao: string;
  registradaEm: string;
  lida: boolean;
}

// O prefixo preserva as notas quando o app limpa os dados de uma versão antiga.
const CHAVE = "notificacoes-novidades-do-app-v1";
const CHAVE_ULTIMA_VISTA = "notificacoes-ultima-versao-vista-do-app-v1";
const LIMITE = 20;
const VAZIAS: Novidade[] = [];
const ouvintes = new Set<() => void>();
let retrato: Novidade[] = VAZIAS;
let textoLido: string | null | undefined;
let somenteMemoria = false;

function lerNovidade(valor: unknown): Novidade | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const campos = valor as Record<string, unknown>;
  if (
    !ehNotaDaVersao(campos) ||
    typeof campos.versao !== "string" ||
    typeof campos.registradaEm !== "string" ||
    !Number.isFinite(Date.parse(campos.registradaEm)) ||
    typeof campos.lida !== "boolean"
  ) {
    return null;
  }
  const versao = nucleoSemver(campos.versao);
  if (!versao) return null;
  return {
    versao,
    titulo: campos.titulo,
    novidades: [...campos.novidades],
    correcoes: [...campos.correcoes],
    melhorias: [...campos.melhorias],
    registradaEm: new Date(campos.registradaEm).toISOString(),
    lida: campos.lida,
  };
}

function limitarEOrdenar(entradas: Novidade[]): Novidade[] {
  const unicas = new Map<string, Novidade>();
  for (const entrada of entradas) {
    const anterior = unicas.get(entrada.versao);
    unicas.set(
      entrada.versao,
      anterior ? { ...anterior, lida: anterior.lida || entrada.lida } : entrada,
    );
  }
  return [...unicas.values()]
    .sort((a, b) => {
      const primeira = partesDoNucleoSemver(a.versao);
      const segunda = partesDoNucleoSemver(b.versao);
      if (!primeira || !segunda) return 0;
      // A data pode ser igual em várias notas instaladas de uma só vez.
      return (
        segunda[0] - primeira[0] ||
        segunda[1] - primeira[1] ||
        segunda[2] - primeira[2]
      );
    })
    .slice(0, LIMITE);
}

function lerTexto(texto: string | null): Novidade[] {
  if (texto === null) return VAZIAS;
  try {
    const valor: unknown = JSON.parse(texto);
    if (!Array.isArray(valor)) return VAZIAS;
    const entradas = valor
      .map((item: unknown) => lerNovidade(item))
      .filter((item): item is Novidade => item !== null);
    return limitarEOrdenar(entradas);
  } catch {
    // Uma escrita interrompida não pode impedir a abertura das notificações.
    return VAZIAS;
  }
}

function obterRetrato(): Novidade[] {
  if (somenteMemoria || typeof window === "undefined") return retrato;
  try {
    const texto = window.localStorage.getItem(CHAVE);
    // O React exige a mesma referência enquanto o conteúdo não muda.
    if (texto !== textoLido) {
      retrato = lerTexto(texto);
      textoLido = texto;
    }
  } catch {
    // Preserva o último estado conhecido, inclusive as notas já lidas.
    somenteMemoria = true;
  }
  return retrato;
}

function avisar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

function salvar(entradas: Novidade[]): void {
  retrato = entradas;
  if (!somenteMemoria) {
    try {
      const texto = JSON.stringify(entradas);
      window.localStorage.setItem(CHAVE, texto);
      textoLido = texto;
    } catch {
      // Fica na memória até recarregar para preservar o estado de leitura.
      somenteMemoria = true;
    }
  }
  avisar();
}

export function registrarNovidadesDaAtualizacao({
  de,
  para,
  agora = new Date(),
}: {
  de: string | null;
  para: string;
  agora?: Date;
}): number {
  const atuais = obterRetrato();
  const conhecidas = new Set(atuais.map((entrada) => entrada.versao));
  const data = Number.isFinite(agora.getTime()) ? agora : new Date();
  const novas = notasEntre(de, para)
    .filter(({ versao }) => !conhecidas.has(versao))
    .map(
      ({ versao, nota }): Novidade => ({
        versao,
        titulo: nota.titulo,
        novidades: [...nota.novidades],
        correcoes: [...nota.correcoes],
        melhorias: [...nota.melhorias],
        registradaEm: data.toISOString(),
        lida: false,
      }),
    );
  if (novas.length === 0) return 0;
  const entradas = limitarEOrdenar([...atuais, ...novas]);
  const gravadas = entradas.filter(
    (entrada) => !conhecidas.has(entrada.versao),
  ).length;
  // Não ressuscita versões já descartadas pelo teto ao repetir uma faixa.
  if (gravadas > 0) salvar(entradas);
  return gravadas;
}

/** A versão vista sobrevive ao fechamento do app e à purga da atualização. */
export function registrarNovidadesAoIniciar(versaoAtual: string): void {
  const para = nucleoSemver(versaoAtual);
  if (!para || typeof window === "undefined") return;
  try {
    const de = nucleoSemver(window.localStorage.getItem(CHAVE_ULTIMA_VISTA));
    // Primeiro acesso (ou origem ilegível) só estabelece a referência.
    if (de && de !== para) registrarNovidadesDaAtualizacao({ de, para });
    window.localStorage.setItem(CHAVE_ULTIMA_VISTA, para);
  } catch {
    // Armazenamento indisponível nunca impede o boot.
  }
}

export function listarNovidades(): Novidade[] {
  return obterRetrato();
}

export function marcarNovidadeComoLida(versao: string): void {
  const nucleo = nucleoSemver(versao);
  const atuais = obterRetrato();
  if (!atuais.some((entrada) => entrada.versao === nucleo && !entrada.lida)) {
    return;
  }
  salvar(
    atuais.map((entrada) =>
      entrada.versao === nucleo ? { ...entrada, lida: true } : entrada,
    ),
  );
}

export function marcarTodasComoLidas(): void {
  const atuais = obterRetrato();
  if (!atuais.some((entrada) => !entrada.lida)) return;
  salvar(atuais.map((entrada) => ({ ...entrada, lida: true })));
}

function aoMudarStorage(evento: StorageEvent): void {
  if (evento.key !== null && evento.key !== CHAVE) return;
  // Uma consulta fora do React pode ter lido a mudança antes deste evento.
  avisar();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", aoMudarStorage);
  }
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", aoMudarStorage);
    }
  };
}

function obterRetratoDoServidor(): Novidade[] {
  return VAZIAS;
}

export function useNovidadesDoAparelho(): {
  novidades: Novidade[];
  naoLidas: number;
} {
  const novidades = useSyncExternalStore(
    assinar,
    obterRetrato,
    obterRetratoDoServidor,
  );
  return {
    novidades,
    naoLidas: novidades.filter((entrada) => !entrada.lida).length,
  };
}
