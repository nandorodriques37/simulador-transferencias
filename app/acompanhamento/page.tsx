"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Barra, Cd, ErroCarga, Estado, Fonte, Kpi, Kpis, PageHeader, Revalidando, Rolagem, Rota, Secao, Seg, Spinner } from "@/components/ui";
import { fmtInt, fmtPct, fmtRsCompacto } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { Acompanhamento, FaixaVolume, LinhaGrupo } from "@/lib/query/acompanhamento";

interface Resp extends Acompanhamento {
  dias: number;
  desde: string | null;
  durable: boolean;
}

type Periodo = "30" | "90" | "180" | "0";
type Visao = "rota" | "origem" | "destino";
type Medida = "rs" | "un";

const ROTULO_PERIODO: Record<Periodo, string> = {
  "30": "nos últimos 30 dias",
  "90": "nos últimos 90 dias",
  "180": "nos últimos 180 dias",
  "0": "desde o início",
};

/** Dias com uma casa só quando ajuda (média); mediana e P90 são inteiros. */
const fmtDias = (d: number | null, casas = 0) =>
  d == null ? "—" : `${d.toLocaleString("pt-BR", { maximumFractionDigits: casas })} ${d === 1 ? "dia" : "dias"}`;

/** Atendimento: verde quando quase tudo virou NF, âmbar quando menos da metade. */
const tomAtendimento = (p: number) => (p >= 0.9 ? "good" : p >= 0.5 ? "brand" : "atencao");

function TabelaFaixas({ faixas, rotuloQtd }: { faixas: FaixaVolume[]; rotuloQtd: string }) {
  return (
    <Rolagem>
      <table className="pgm-tabela">
        <thead>
          <tr><th>Faixa</th><th className="pgm-num">{rotuloQtd}</th><th>Participação</th></tr>
        </thead>
        <tbody>
          {faixas.map((f) => (
            <tr key={f.rotulo}>
              <td>{f.rotulo}</td>
              <td className="pgm-num">{fmtInt(f.qtd)}</td>
              <td><Barra pct={f.pct} tom={f.ate == null && f.qtd > 0 ? "atencao" : "azul"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Rolagem>
  );
}

export default function AcompanhamentoPage() {
  const [periodo, setPeriodo] = useState<Periodo>("90");
  const [visao, setVisao] = useState<Visao>("rota");
  const [medida, setMedida] = useState<Medida>("rs");
  const api = useApi<Resp>(`/api/acompanhamento?dias=${periodo}`);
  const data = api.data;

  if (api.carregando) return <Spinner label="Consolidando a carteira…" />;
  if (api.erro && !data) return <ErroCarga erro={api.erro} onTentar={api.recarregar} />;
  if (!data) return null;

  const { total, prazo } = data;
  const seletorPeriodo = (
    <Seg
      label="Período de aprovação"
      valor={periodo}
      onChange={setPeriodo}
      opcoes={[{ valor: "30", rotulo: "30 dias" }, { valor: "90", rotulo: "90 dias" }, { valor: "180", rotulo: "180 dias" }, { valor: "0", rotulo: "Tudo" }]}
    />
  );

  if (total.sugestoes === 0) {
    return (
      <>
        <PageHeader
          title="Nada aprovado no período"
          subtitle={`Nenhuma sugestão aprovada ${ROTULO_PERIODO[periodo]}.`}
          right={<><Revalidando ativo={api.revalidando} />{seletorPeriodo}</>}
        />
        <Estado
          icone="carteira"
          rotulo="Acompanhamento"
          titulo="Aprove linhas do plano para acompanhar o faturamento"
          texto="Cada sugestão aprovada entra aqui. Quando a planilha de notas fiscais é importada na Carteira, o faturado e o tempo até a NF aparecem por rota, por origem e por destino."
          acoes={<><Link href="/plano" className="pgm-botao">Abrir o plano</Link>{periodo !== "0" && <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => setPeriodo("0")}>Ver todo o histórico</button>}</>}
        />
      </>
    );
  }

  const linhas: LinhaGrupo[] = visao === "rota" ? data.porRota : visao === "origem" ? data.porOrigem : data.porDestino;
  const nome = (l: LinhaGrupo) =>
    visao === "rota" ? <Rota origem={l.cdOrigem!} destino={l.cdDestino!} /> : <Cd n={(visao === "origem" ? l.cdOrigem : l.cdDestino)!} />;
  const temCancelado = total.canceladoQtd > 0;
  // Uma medida por vez: em R$ e em unidades juntas, a tabela empurrava
  // atendimento e prazo para fora da tela.
  const v = (l: { aprovadoQtd: number; aprovadoValor: number; faturadoQtd: number; faturadoValor: number; abertoQtd: number; abertoValor: number; canceladoQtd: number; canceladoValor: number }) =>
    medida === "rs"
      ? { aprovado: fmtRsCompacto(l.aprovadoValor), faturado: fmtRsCompacto(l.faturadoValor), aberto: fmtRsCompacto(l.abertoValor), cancelado: fmtRsCompacto(l.canceladoValor) }
      : { aprovado: fmtInt(l.aprovadoQtd), faturado: fmtInt(l.faturadoQtd), aberto: fmtInt(l.abertoQtd), cancelado: fmtInt(l.canceladoQtd) };
  const sufixo = medida === "rs" ? "(R$)" : "(un)";
  const paradoMais30 = data.faixasAberto[data.faixasAberto.length - 1];
  const semNf = prazo.qtd === 0;

  return (
    <>
      <PageHeader
        title={
          semNf ? (
            <>Nenhuma NF importada para o que foi aprovado {ROTULO_PERIODO[periodo]}</>
          ) : (
            <>
              {fmtPct(total.atendimento, 0)} do aprovado já virou NF · metade do volume faturou em até {fmtDias(prazo.medianaDias)}
            </>
          )
        }
        subtitle={<>Sugestões aprovadas {ROTULO_PERIODO[periodo]} · valores a preço da origem · o prazo conta da aprovação até a data da NF</>}
        right={
          <>
            <Revalidando ativo={api.revalidando} />
            {seletorPeriodo}
            <Link href="/carteira" className="pgm-botao pgm-botao--secundario">Importar NFs</Link>
          </>
        }
      />

      {(api.erro || !data.durable || paradoMais30.qtd > 0) && (
        <div className="flex flex-col gap-3">
          {api.erro && (
            <Alert tom="erro" titulo="Falha ao atualizar" acao={<button onClick={api.recarregar} className="pgm-botao pgm-botao--secundario" type="button">Tentar de novo</button>}>
              {api.erro}. Os números abaixo são da última carga bem-sucedida.
            </Alert>
          )}
          {!data.durable && (
            <Alert tom="warn" titulo="Sem banco · modo demonstração">
              A carteira está na memória do servidor: o histórico some em um novo deploy.
            </Alert>
          )}
          {paradoMais30.qtd > 0 && (
            <Alert tom="warn" titulo="Saldo parado" acao={<Link href="/carteira" className="pgm-botao pgm-botao--secundario">Revisar na carteira</Link>}>
              {fmtInt(paradoMais30.qtd)} un ({fmtPct(paradoMais30.pct, 0)} do saldo em aberto) foram aprovadas há mais de 30 dias e seguem sem NF —
              continuam reservando estoque na origem.
            </Alert>
          )}
        </div>
      )}

      <Kpis label="Resumo do período">
        <Kpi titulo="Aprovado" valor={fmtRsCompacto(total.aprovadoValor)} sub={`${fmtInt(total.aprovadoQtd)} un · ${fmtInt(total.sugestoes)} sugestões`} />
        <Kpi
          titulo="Faturado"
          valor={fmtRsCompacto(total.faturadoValor)}
          sub={`${fmtPct(total.atendimento, 0)} de atendimento · ${fmtInt(total.faturadoQtd)} un`}
          tom={total.atendimento >= 0.9 ? "good" : "default"}
        />
        <Kpi
          titulo="Em aberto"
          valor={fmtRsCompacto(total.abertoValor)}
          sub={`${fmtInt(total.abertoQtd)} un aguardando NF${total.canceladoQtd > 0 ? ` · ${fmtRsCompacto(total.canceladoValor)} cancelados` : ""}`}
          tom={total.abertoQtd > 0 ? "warn" : "default"}
        />
        <Kpi
          titulo="Prazo até a NF (mediana)"
          valor={fmtDias(prazo.medianaDias)}
          sub={semNf ? "sem NF importada no período" : `média ${fmtDias(prazo.mediaDias, 1)} · 90% em até ${fmtDias(prazo.p90Dias)}`}
        />
      </Kpis>

      {/* ---------------------- Aprovado × faturado ---------------------- */}
      <Secao
        flush
        titulo="Aprovado × faturado"
        desc="Aprovado = faturado + em aberto + cancelado · o atendimento desconsidera o cancelado · prazo mediano: metade do volume faturou em até N dias"
        right={
          <>
            <Seg
              label="Agrupar por"
              valor={visao}
              onChange={setVisao}
              opcoes={[{ valor: "rota", rotulo: "Rota" }, { valor: "origem", rotulo: "Origem" }, { valor: "destino", rotulo: "Destino" }]}
            />
            <Seg label="Medida" valor={medida} onChange={setMedida} opcoes={[{ valor: "rs", rotulo: "R$" }, { valor: "un", rotulo: "Unidades" }]} />
          </>
        }
      >
        <Rolagem>
          <table className="pgm-tabela">
            <thead>
              <tr>
                <th>{visao === "rota" ? "Rota" : visao === "origem" ? "Origem" : "Destino"}</th>
                <th className="pgm-num">Sugestões</th>
                <th className="pgm-num">Aprovado {sufixo}</th>
                <th className="pgm-num">Faturado {sufixo}</th>
                <th className="pgm-num">Em aberto {sufixo}</th>
                {temCancelado && <th className="pgm-num">Cancelado {sufixo}</th>}
                <th>Atendimento</th>
                <th className="pgm-num">Prazo mediano</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const x = v(l);
                return (
                  <tr key={l.chave}>
                    <td>{nome(l)}</td>
                    <td className="pgm-num">{fmtInt(l.sugestoes)}</td>
                    <td className="pgm-num">{x.aprovado}</td>
                    <td className="pgm-num">{x.faturado}</td>
                    <td className="pgm-num">{x.aberto}</td>
                    {temCancelado && <td className="pgm-num">{x.cancelado}</td>}
                    <td><Barra pct={l.atendimento} tom={tomAtendimento(l.atendimento)} /></td>
                    <td className="pgm-num">{fmtDias(l.prazo.medianaDias)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Rede</td>
                <td className="pgm-num">{fmtInt(total.sugestoes)}</td>
                <td className="pgm-num">{v(total).aprovado}</td>
                <td className="pgm-num">{v(total).faturado}</td>
                <td className="pgm-num">{v(total).aberto}</td>
                {temCancelado && <td className="pgm-num">{v(total).cancelado}</td>}
                <td><Barra pct={total.atendimento} tom={tomAtendimento(total.atendimento)} /></td>
                <td className="pgm-num">{fmtDias(prazo.medianaDias)}</td>
              </tr>
            </tfoot>
          </table>
        </Rolagem>
      </Secao>

      {/* ------------------------- Prazos ------------------------- */}
      <div className="app-grade">
        <Secao
          flush
          titulo="Tempo da aprovação até a NF"
          desc={semNf ? "Aparece quando a planilha de notas fiscais for importada na Carteira" : `Unidades faturadas pelos dias entre a aprovação e a data da NF · ${fmtInt(prazo.baixas)} baixa(s)`}
        >
          <TabelaFaixas faixas={data.faixasPrazo} rotuloQtd="Faturado (un)" />
        </Secao>
        <Secao flush titulo="Saldo em aberto por idade" desc="O que ainda espera NF, pelos dias desde a aprovação">
          <TabelaFaixas faixas={data.faixasAberto} rotuloQtd="Em aberto (un)" />
        </Secao>
      </div>

      <Fonte>
        Fonte: carteira de sugestões aprovadas e baixas da planilha de notas fiscais. O período filtra pela data de aprovação — uma sugestão
        aprovada no período conta com todo o faturamento que já recebeu. O prazo de cada NF pesa pela quantidade faturada; NF com data anterior à
        aprovação conta como zero dia. Sem a data na planilha, vale a data em que a NF foi importada.
      </Fonte>
    </>
  );
}
