"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface EstadoApi<T> {
  /** Último dado bem-sucedido. Continua visível durante a revalidação. */
  data: T | null;
  /** Mensagem de falha — rede fora, resposta inválida, servidor com erro. */
  erro: string | null;
  /** Primeira carga: ainda não há nada para mostrar. */
  carregando: boolean;
  /** Recarga com dado antigo em tela (troca de filtro, refresh manual). */
  revalidando: boolean;
  recarregar: () => void;
}

/**
 * Carrega JSON de uma rota da API mantendo três coisas que o `fetch` cru não dá:
 *
 * 1. **Falha nunca some.** Uma rede fora do ar deixava a tela em branco ou o
 *    spinner girando para sempre; aqui vira `erro`, que a tela mostra.
 * 2. **Primeira carga ≠ recarga.** Trocar um filtro não pode apagar a tabela:
 *    o dado anterior fica na tela com `revalidando` ligado.
 * 3. **Resposta atrasada não vence.** Filtros trocados em sequência disparam
 *    requisições concorrentes — o `AbortController` descarta as antigas para
 *    que a tela não pisque com um resultado que já não vale.
 *
 * `url` nula suspende a busca (útil enquanto um parâmetro ainda não existe).
 */
export function useApi<T>(url: string | null): EstadoApi<T> {
  const [data, setData] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(!!url);
  const [tick, setTick] = useState(0);
  // `data` só entra aqui para decidir entre "carregando" e "revalidando" —
  // como ref, não recria o efeito a cada resposta e evita o loop de busca.
  const temDado = useRef(false);

  useEffect(() => {
    if (!url) {
      setBuscando(false);
      return;
    }
    const ctrl = new AbortController();
    setBuscando(true);
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        const corpo = await r.json().catch(() => null);
        // A API responde 404/400 com um corpo próprio (`semAnalise`, `erro`) que
        // as telas sabem interpretar — isso não é falha de carga.
        if (!r.ok && !corpo) throw new Error(`servidor respondeu ${r.status}`);
        if (!corpo) throw new Error("resposta vazia do servidor");
        return corpo as T;
      })
      .then((d) => {
        temDado.current = true;
        setData(d);
        setErro(null);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setErro(e.message || "falha ao carregar");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBuscando(false);
      });
    return () => ctrl.abort();
  }, [url, tick]);

  const recarregar = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    erro,
    carregando: buscando && !temDado.current,
    revalidando: buscando && temDado.current,
    recarregar,
  };
}

/**
 * Atrasa a propagação de um valor que muda a cada tecla.
 *
 * A busca do plano e a da carteira alimentam a query da API: sem isso, digitar
 * "dipirona" dispara oito requisições e paga oito varreduras do plano no
 * servidor — só a última interessa.
 */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return atrasado;
}
