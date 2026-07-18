"use client";

import { CdManager, Parametros } from "./CdManager";
import { rotuloMes } from "@/lib/format";

/**
 * Editor único dos parâmetros de negócio (CDs + alíquotas + fator de segurança
 * + limite de cobertura + horizonte). Compartilhado entre a aba "Parâmetros"
 * (onde é salvo e vira versão oficial) e o "Simulador" (onde é usado como
 * cenário what-if). Evita a duplicação dos mesmos campos em duas telas.
 */
export function ParametrosEditor({
  params,
  disponiveis,
  onChange,
}: {
  params: Parametros;
  disponiveis: number[];
  onChange: (p: Parametros) => void;
}) {
  const setP = (patch: Partial<Parametros>) => onChange({ ...params, ...patch });

  return (
    <div>
      <CdManager params={params} disponiveis={disponiveis} onChange={onChange} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-sm">
          <span className="label">Fator segurança imediata</span>
          <input
            type="number" step="0.1" min="0" className="input mt-1 w-full"
            value={params.fatorSegurancaImediata}
            onChange={(e) => setP({ fatorSegurancaImediata: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          <span className="label">Limite cobertura (dias)</span>
          <input
            type="number" min="1" className="input mt-1 w-full"
            value={params.limiteCoberturaDias}
            onChange={(e) => setP({ limiteCoberturaDias: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="label">Horizonte (meses AAAA_MM)</span>
        <input
          className="input mt-1 w-full"
          value={params.horizonteMeses.join(", ")}
          onChange={(e) => setP({ horizonteMeses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
        <div className="mt-1 text-xs text-slate-400">{params.horizonteMeses.map(rotuloMes).join(" · ")}</div>
      </label>
    </div>
  );
}
