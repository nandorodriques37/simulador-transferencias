"use client";

import { fmtInt, fmtRsCompacto } from "@/lib/format";
import { Icone } from "@/components/icones";

export interface CdInfo {
  cd: number;
  skus: number;
  excessoQtd: number;
  excessoRs: number;
  faltaQtd: number;
  faltaRs: number;
  pedidosQtd: number;
  comprometidoSaida: number;
  emTransito: number;
}

/**
 * Seletor ORDENADO de CDs. A ordem é o coração do modelo:
 *  - nas origens, define quem escoa o excesso primeiro;
 *  - nos destinos, define quem é atendido primeiro.
 */
export function SequenciaCds({
  papel,
  selecionados,
  disponiveis,
  info,
  onChange,
  excluir = [],
}: {
  papel: "origem" | "destino";
  selecionados: number[];
  disponiveis: number[];
  info: Record<number, CdInfo>;
  onChange: (cds: number[]) => void;
  excluir?: number[];
}) {
  const origem = papel === "origem";
  const naoSelecionados = disponiveis.filter((c) => !selecionados.includes(c));

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= selecionados.length) return;
    const copia = [...selecionados];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    onChange(copia);
  };
  const remover = (cd: number) => onChange(selecionados.filter((c) => c !== cd));
  const adicionar = (cd: number) => onChange([...selecionados, cd]);

  const metrica = (cd: number) => {
    const i = info[cd];
    if (!i) return null;
    return origem
      ? { qtd: i.excessoQtd, rs: i.excessoRs, rotulo: "Excesso disponível", extra: i.comprometidoSaida, extraRotulo: "comprometido" }
      : { qtd: i.faltaQtd, rs: i.faltaRs, rotulo: "Falta para o objetivo", extra: i.emTransito, extraRotulo: "em trânsito" };
  };

  return (
    <div className="flex flex-col gap-4">
      <ol className="seq" aria-label={origem ? "Sequência das origens" : "Ordem dos destinos"}>
        {selecionados.map((cd, i) => {
          const m = metrica(cd);
          const conflito = excluir.includes(cd);
          return (
            <li key={cd} className="seq__item" data-conflito={conflito ? "true" : undefined}>
              <span className="seq__n">{i + 1}</span>
              <div className="seq__info">
                <b>CD {cd}</b>
                {m && (
                  <span>
                    {m.rotulo}: {fmtInt(m.qtd)} un · {fmtRsCompacto(m.rs)}
                    {m.extra > 0 && <> · <em>{m.extraRotulo}: {fmtInt(m.extra)} un</em></>}
                    {conflito && <> · <em>também é origem</em></>}
                  </span>
                )}
              </div>
              <div className="seq__acoes">
                <button type="button" className="btn-icone" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir CD ${cd}`}>
                  <Icone nome="cima" tamanho={18} espessura={2.4} />
                </button>
                <button type="button" className="btn-icone" onClick={() => mover(i, 1)} disabled={i === selecionados.length - 1} aria-label={`Descer CD ${cd}`}>
                  <Icone nome="baixo" tamanho={18} espessura={2.4} />
                </button>
                <button type="button" className="btn-icone btn-icone--perigo" onClick={() => remover(cd)} aria-label={`Remover CD ${cd}`}>
                  <Icone nome="fechar" tamanho={18} espessura={2.4} />
                </button>
              </div>
            </li>
          );
        })}
        {selecionados.length === 0 && (
          <li className="upload" style={{ justifyContent: "center", color: "var(--ink-2)", fontSize: 14 }}>
            Nenhum CD escolhido como {origem ? "origem" : "destino"}. Adicione abaixo.
          </li>
        )}
      </ol>

      {naoSelecionados.length > 0 && (
        <div>
          <p className="pgm-campo__rotulo" style={{ margin: "0 0 8px" }}>Adicionar</p>
          <div className="seq-add">
            {naoSelecionados.map((cd) => {
              const m = metrica(cd);
              return (
                <button key={cd} type="button" onClick={() => adicionar(cd)} title={m ? `${m.rotulo}: ${fmtInt(m.qtd)} un` : undefined}>
                  + CD {cd}
                  {m && <small>{m.qtd > 0 ? fmtRsCompacto(m.rs) : origem ? "sem excesso" : "sem falta"}</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
