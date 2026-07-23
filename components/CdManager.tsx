"use client";

import { useState } from "react";
import { corCd } from "@/lib/format";

export type ModeloTransferencia = "drp" | "estoque_objetivo";

export interface Parametros {
  modelo: ModeloTransferencia;
  cdOrigem: number;
  prioridadeCds: number[];
  horizonteMeses: string[];
  aliquotaFiscal: Record<number, number>;
  fatorSegurancaImediata: number;
  limiteCoberturaDias: number;
}

/**
 * Gestão de CDs: escolhe o CD de origem e adiciona/remove/reordena os CDs de
 * destino, com alíquota por rota. Suporta qualquer quantidade de CDs (a rede
 * hoje tem 11) — nada é fixo em código.
 */
export function CdManager({
  params,
  disponiveis,
  onChange,
}: {
  params: Parametros;
  disponiveis: number[];
  onChange: (p: Parametros) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [novoCd, setNovoCd] = useState("");

  const set = (patch: Partial<Parametros>) => onChange({ ...params, ...patch });

  const mover = (from: number, to: number) => {
    if (to < 0 || to >= params.prioridadeCds.length) return;
    const arr = [...params.prioridadeCds];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    set({ prioridadeCds: arr });
  };
  const remover = (cd: number) => set({ prioridadeCds: params.prioridadeCds.filter((c) => c !== cd) });
  const adicionar = (cd: number) => {
    if (!cd || params.prioridadeCds.includes(cd) || cd === params.cdOrigem) return;
    set({ prioridadeCds: [...params.prioridadeCds, cd] });
    setNovoCd("");
  };
  const setAliquota = (cd: number, v: string) => {
    const aliq = { ...params.aliquotaFiscal };
    if (v === "") delete aliq[cd];
    else aliq[cd] = Number(v) / 100;
    set({ aliquotaFiscal: aliq });
  };

  // Universo de CDs para os seletores (garante que origem/destinos atuais apareçam).
  const universo = Array.from(new Set([...disponiveis, ...params.prioridadeCds, params.cdOrigem]))
    .filter((c) => Number.isFinite(c))
    .sort((a, b) => a - b);
  const paraAdicionar = universo.filter((c) => c !== params.cdOrigem && !params.prioridadeCds.includes(c));

  return (
    <div>
      <div className="mb-3">
        <span className="label">CD de origem (excesso)</span>
        <select
          className="input mt-1 w-full"
          value={params.cdOrigem}
          onChange={(e) => {
            const novo = Number(e.target.value);
            // remove origem dos destinos, se estiver
            set({ cdOrigem: novo, prioridadeCds: params.prioridadeCds.filter((c) => c !== novo) });
          }}
        >
          {universo.map((c) => <option key={c} value={c}>CD {c}</option>)}
        </select>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="label">CDs destino (ordem de prioridade)</span>
        <span className="text-xs text-slate-400">{params.prioridadeCds.length} destino(s)</span>
      </div>
      <ul className="mb-2 space-y-1">
        {params.prioridadeCds.map((cd, i) => (
          <li
            key={cd}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx !== null) mover(dragIdx, i); setDragIdx(null); }}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="cursor-grab text-slate-400">⋮⋮</span>
              <span className="badge" style={{ background: corCd(cd) + "22", color: corCd(cd) }}>CD {cd}</span>
              <span className="text-xs text-slate-400">#{i + 1}</span>
            </span>
            <span className="flex items-center gap-1">
              <label className="flex items-center gap-1 text-xs text-slate-500">
                ICMS
                <input
                  type="number" step="0.1" placeholder="—"
                  className="input w-16 px-2 py-1 text-right"
                  value={params.aliquotaFiscal[cd] != null ? (params.aliquotaFiscal[cd] * 100).toString() : ""}
                  onChange={(e) => setAliquota(cd, e.target.value)}
                />%
              </label>
              <button className="btn-ghost px-2 py-1" title="Subir" onClick={() => mover(i, i - 1)}>↑</button>
              <button className="btn-ghost px-2 py-1" title="Descer" onClick={() => mover(i, i + 1)}>↓</button>
              <button className="btn-ghost px-2 py-1 text-rose-600" title="Remover" onClick={() => remover(cd)}>✕</button>
            </span>
          </li>
        ))}
        {params.prioridadeCds.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">Nenhum CD destino — adicione ao menos um.</li>}
      </ul>

      <div className="flex items-center gap-2">
        <select className="input flex-1" value={novoCd} onChange={(e) => setNovoCd(e.target.value)}>
          <option value="">+ Adicionar CD destino…</option>
          {paraAdicionar.map((c) => <option key={c} value={c}>CD {c}</option>)}
        </select>
        <button className="btn-ghost" disabled={!novoCd} onClick={() => adicionar(Number(novoCd))}>Adicionar</button>
      </div>
    </div>
  );
}
