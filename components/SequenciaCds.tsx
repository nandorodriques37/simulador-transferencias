"use client";

import { fmtInt, fmtRsCompacto } from "@/lib/format";

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
      ? { qtd: i.excessoQtd, rs: i.excessoRs, rotulo: "excesso disponível", extra: i.comprometidoSaida }
      : { qtd: i.faltaQtd, rs: i.faltaRs, rotulo: "falta p/ objetivo", extra: i.emTransito };
  };

  return (
    <div>
      <ol className="flex flex-col gap-1.5">
        {selecionados.map((cd, i) => {
          const m = metrica(cd);
          const conflito = excluir.includes(cd);
          return (
            <li
              key={cd}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                conflito ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${origem ? "bg-azul-600 text-white" : "bg-brand-500 text-white"}`}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">CD {cd}</div>
                {m && (
                  <div className="text-[11px] text-slate-500">
                    {m.rotulo}: {fmtInt(m.qtd)} un · {fmtRsCompacto(m.rs)}
                    {m.extra > 0 && (
                      <span className="ml-1 text-amber-600">
                        · {origem ? "comprometido" : "em trânsito"}: {fmtInt(m.extra)} un
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Subir">
                  ▲
                </button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === selecionados.length - 1} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Descer">
                  ▼
                </button>
                <button type="button" onClick={() => remover(cd)} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remover">
                  ✕
                </button>
              </div>
            </li>
          );
        })}
        {selecionados.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-400">
            Nenhum CD selecionado como {origem ? "origem" : "destino"}.
          </li>
        )}
      </ol>

      {naoSelecionados.length > 0 && (
        <div className="mt-2.5">
          <div className="label mb-1">Adicionar</div>
          <div className="flex flex-wrap gap-1.5">
            {naoSelecionados.map((cd) => {
              const m = metrica(cd);
              return (
                <button
                  key={cd}
                  type="button"
                  onClick={() => adicionar(cd)}
                  title={m ? `${m.rotulo}: ${fmtInt(m.qtd)} un` : undefined}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                >
                  + CD {cd}
                  {m && m.qtd > 0 && <span className="ml-1 text-slate-400">{fmtRsCompacto(m.rs)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
