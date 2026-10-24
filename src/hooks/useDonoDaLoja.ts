// Descobre se quem está olhando o painel é o "dono da loja" — a única pessoa
// que o banco deixa mudar o cargo de alguém (`definir_cargo`).
//
// A fonte é a tabela `dono_da_loja` (no máximo UMA linha por banco). O banco só
// deixa ler essa linha ao dono e aos administradores atuais; para qualquer
// outra pessoa a leitura volta vazia. Por isso a regra aqui é simples e segura:
// qualquer dúvida (erro, tabela ausente, linha vazia, rede) = "não sou o dono"
// = a opção simplesmente não aparece. Sem lançar e sem toast. Esconder o botão
// é conforto: quem barra de verdade é o banco.
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export interface EstadoDoDono {
  /** O usuário logado é o dono da loja. */
  readonly souODono: boolean;
  /** A leitura ainda está em andamento (a opção não aparece enquanto isso). */
  readonly carregando: boolean;
  /** Id do dono, quando se sabe. */
  readonly donoId: string | null;
}

// A tabela ainda não está em src/types/database.types.ts (gerado e
// compartilhado): tipo mínimo local do que esta leitura usa.
interface ClienteComDono {
  from(tabela: "dono_da_loja"): {
    select(colunas: "user_id"): {
      maybeSingle(): PromiseLike<{
        data: { user_id?: string } | null;
        error: { code?: string; status?: number } | null;
      }>;
    };
  };
}

// Recusas que não mudam sozinhas: tabela ausente nesta loja (PGRST205, 42P01,
// 404) ou leitura negada (42501). Essas valem para a sessão inteira; falha de
// rede NÃO é gravada, para a próxima abertura tentar de novo.
const CODIGOS_DEFINITIVOS = new Set(["PGRST205", "42P01", "42501"]);

interface Leitura {
  readonly uid: string;
  readonly donoId: string | null;
}

// Cache de módulo, guardado COM o id de quem leu: outra conta que entra na
// mesma aba nunca herda a resposta da anterior, e o logout apaga tudo.
let leituraFeita: Leitura | null = null;
let leituraEmVoo: { uid: string; promessa: Promise<string | null> } | null =
  null;

/** Esquece o que foi lido (logout / troca de conta / testes). */
export function limparDonoDaLoja(): void {
  leituraFeita = null;
  leituraEmVoo = null;
}

async function lerDono(uid: string): Promise<string | null> {
  let donoId: string | null = null;
  let definitivo = false;
  try {
    const { data, error } = await (supabase as unknown as ClienteComDono)
      .from("dono_da_loja")
      .select("user_id")
      .maybeSingle();
    if (error) {
      definitivo =
        (error.code !== undefined && CODIGOS_DEFINITIVOS.has(error.code)) ||
        error.status === 404;
    } else {
      donoId = typeof data?.user_id === "string" ? data.user_id : null;
      definitivo = true;
    }
  } catch {
    // Rede caiu, ou cliente sem a consulta: sem dono, e nada gravado.
  }
  if (definitivo && leituraEmVoo?.uid === uid) {
    leituraFeita = { uid, donoId };
  }
  return donoId;
}

function carregarDono(uid: string): Promise<string | null> {
  if (leituraFeita?.uid === uid) return Promise.resolve(leituraFeita.donoId);
  if (leituraEmVoo?.uid === uid) return leituraEmVoo.promessa;
  const promessa = lerDono(uid).finally(() => {
    if (leituraEmVoo?.promessa === promessa) leituraEmVoo = null;
  });
  leituraEmVoo = { uid, promessa };
  return promessa;
}

function estadoDe(donoId: string | null, uid: string | null): EstadoDoDono {
  return {
    souODono: donoId !== null && donoId === uid,
    carregando: false,
    donoId,
  };
}

const SEM_USUARIO: EstadoDoDono = {
  souODono: false,
  carregando: false,
  donoId: null,
};

function estadoInicial(uid: string | null): EstadoDoDono {
  if (!uid) return SEM_USUARIO;
  if (leituraFeita?.uid === uid) return estadoDe(leituraFeita.donoId, uid);
  return { souODono: false, carregando: true, donoId: null };
}

export function useDonoDaLoja(): EstadoDoDono {
  const uid = useAuth()?.user?.id ?? null;
  const [estado, setEstado] = useState<EstadoDoDono>(() => estadoInicial(uid));

  useEffect(() => {
    if (!uid) {
      // Saiu da conta: apaga o que a sessão anterior leu.
      limparDonoDaLoja();
      setEstado(SEM_USUARIO);
      return;
    }
    if (leituraFeita?.uid === uid) {
      setEstado(estadoDe(leituraFeita.donoId, uid));
      return;
    }
    let vivo = true;
    setEstado({ souODono: false, carregando: true, donoId: null });
    carregarDono(uid).then((donoId) => {
      if (vivo) setEstado(estadoDe(donoId, uid));
    });
    return () => {
      vivo = false;
    };
  }, [uid]);

  return estado;
}
