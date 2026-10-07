"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Campo, ErroCarga, Estado, Fonte, Modal, PageHeader, Pill, Ressalvas, Revalidando, Rolagem, Rota, Spinner, Status } from "@/components/ui";
import { fmtInt, fmtPct, fmtRs, fmtRsCompacto, rotuloMes } from "@/lib/format";
import { useApi, useDebounce } from "@/lib/useApi";

interface LinhaPlano {
  cdOrigem: number; cdDestino: number; rota: string; codigoProduto: number; produto: string;
  fornecedor: string; comprador: string; analista: string; categoriaN1: string;
  precoUnitario: number; embCompra: number;
  demandaMes: number[]; transfMes: number[]; demandaSaldo: number; transfSaldo: number;
  transfTotal: number; valorTotal: number; caixas: number;
  qtdImediata: number; imediataCaixas: number; qtdImediataArredondada: number; valorImediata: number;
  coberturaDias: number; statusCobertura: string; aliquota: number; impactoFiscal: number;
  naCarteira: boolean;
}
interface Facets {
  origens: number[]; destinos: number[]; rotas: string[]; categorias: string[];
  fornecedores: string[]; compradores: string[]; analistas: string[]; status: string[];
}
interface PlanoResp {
  analiseId: string; modoDemanda: "saldo_ideal" | "pedidos"; meses: string[];
  facets: Facets; totaisFiltro: { qtd: number; valor: number; imediata: number; fiscal: number };
  total: number; page: number; pageSize: number; totalPaginas: number; itens: LinhaPlano[];
  erro?: string; semAnalise?: boolean;
  precisaRecalcular?: boolean; parametros?: unknown; label?: string; criadoEm?: string;
}

const FILTROS_INICIAIS: Record<string, string> = {
  cobertura: "total", origem: "", destino: "", categoria: "", fornecedor: "",
  comprador: "", analista: "", status: "", q: "", soImediata: "false",
};

/** Valores que não precisam aparecer na URL — são o padrão da tela. */
const PADROES: Record<string, string> = { ...FILTROS_INICIAIS, sort: "valorTotal", dir: "desc", page: "1" };

export default function PlanoPage() {
  // `useSearchParams` exige Suspense no Next 14 (a página é renderizada no cliente).
  return (
    <Suspense fallback={<Spinner label="Abrindo o plano…" />}>
      <Plano />
    </Suspense>
  );
}

function Plano() {
  const router = useRouter();
  const url = useSearchParams();

  // A URL é a fonte da verdade dos filtros: recarregar a página preserva a
  // visão, e o link filtrado pode ser mandado para outra pessoa.
  const filtros = useMemo(() => {
    const f = { ...FILTROS_INICIAIS };
    for (const k of Object.keys(FILTROS_INICIAIS)) {
      const v = url.get(k);
      if (v !== null) f[k] = v;
    }
    return f;
  }, [url]);
  const page = Math.max(1, Number(url.get("page") ?? 1));
  const sort = {
    campo: url.get("sort") ?? "valorTotal",
    dir: (url.get("dir") as "asc" | "desc") ?? "desc",
  };

  const [busca, setBusca] = useState(filtros.q);
  const buscaDebounced = useDebounce(busca, 300);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "good" | "erro"; texto: string } | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  // Confirmação antes de mandar linhas para a carteira: "filtro" (todas) ou "selecao".
  const [confirma, setConfirma] = useState<"filtro" | "selecao" | null>(null);

  const aplicar = (patch: Record<string, string>, resetPagina = true) => {
    const p = new URLSearchParams(url.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === PADROES[k]) p.delete(k);
      else p.set(k, v);
    }
    if (resetPagina) p.delete("page");
    router.replace(`/plano${p.toString() ? `?${p}` : ""}`, { scroll: false });
    setSel(new Set());
  };

  // A busca só entra na URL depois da pausa — uma requisição por termo, não por tecla.
  useEffect(() => {
    if (buscaDebounced !== filtros.q) aplicar({ q: buscaDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v && v !== "false") p.set(k, v);
    p.set("page", String(page));
    p.set("pageSize", "100");
    p.set("sort", sort.campo);
    p.set("dir", sort.dir);
    return p.toString();
  }, [filtros, page, sort.campo, sort.dir]);

  const api = useApi<PlanoResp>(`/api/plano?${qs}`);
  const data = api.data;
  const carregar = api.recarregar;

  const recalcular = async () => {
    if (!data?.parametros) return;
    setRecalculando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/analise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parametros: data.parametros, label: data.label, analiseId: data.analiseId }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ tom: "erro", texto: `Não foi possível recalcular: ${d.erro}` });
        return;
      }
      carregar();
    } catch (e) {
      setMsg({ tom: "erro", texto: `Não foi possível recalcular: ${(e as Error).message}` });
    } finally {
      setRecalculando(false);
    }
  };

  if (api.carregando) return <Spinner label="Abrindo o plano…" />;
  if (api.erro && !data) return <ErroCarga erro={api.erro} onTentar={api.recarregar} />;
  if (!data) return null;

  // O detalhe por SKU não é persistido: quando a instância está fria, o
  // resultado salvo sobrevive e o plano é reconstruído em um clique.
  if (data.precisaRecalcular) {
    return (
      <>
        <PageHeader title="As linhas do plano precisam ser recalculadas" subtitle={`Análise ${data.analiseId}${data.label ? ` · ${data.label}` : ""}`} />
        {msg && <Alert tom={msg.tom} titulo={msg.tom === "erro" ? "Falha" : "Pronto"}>{msg.texto}</Alert>}
        <Estado
          tom="atencao"
          icone="recarregar"
          rotulo="Plano"
          titulo="O resultado foi guardado, mas as linhas por rota × SKU não"
          texto="Recalcular usa a mesma base e os mesmos parâmetros: leva alguns segundos e devolve o plano completo para filtrar e aprovar."
          acoes={
            <>
              <button onClick={recalcular} disabled={recalculando} className="pgm-botao" type="button">{recalculando ? "Recalculando…" : "Recalcular o plano"}</button>
              <Link href="/" className="pgm-botao pgm-botao--secundario">Ver o dashboard</Link>
            </>
          }
        />
      </>
    );
  }

  if (data.semAnalise || data.erro) {
    return (
      <>
        <PageHeader title="Nenhuma análise rodada ainda" subtitle="O plano lista uma linha por rota (origem → destino) × SKU da última análise." />
        <Estado
          icone="analise"
          rotulo="Plano"
          titulo="Rode uma análise para gerar o plano"
          texto="Defina origens, destinos e parâmetros em Nova análise. O plano aparece aqui assim que a análise terminar."
          acoes={<Link href="/analise" className="pgm-botao">Nova análise</Link>}
        />
      </>
    );
  }

  const { itens, facets, meses, totaisFiltro } = data;
  const modoPedidos = data.modoDemanda === "pedidos";
  const chave = (l: LinhaPlano) => `${l.rota}|${l.codigoProduto}`;
  const setF = (k: string, v: string) => aplicar({ [k]: v });
  const ordenar = (campo: string) =>
    aplicar({ sort: campo, dir: sort.campo === campo && sort.dir === "desc" ? "asc" : "desc" });
  const irPara = (p: number) => aplicar({ page: String(Math.max(1, p)) }, false);

  const alternar = (k: string) => {
    const novo = new Set(sel);
    if (novo.has(k)) novo.delete(k); else novo.add(k);
    setSel(novo);
  };
  const alternarTodas = () => {
    if (itens.every((l) => sel.has(chave(l)))) setSel(new Set());
    else setSel(new Set(itens.map(chave)));
  };

  const aprovar = async (tudoDoFiltro: boolean) => {
    setAprovando(true);
    setMsg(null);
    try {
      const body = tudoDoFiltro
        ? { analiseId: data.analiseId, filtros }
        : { analiseId: data.analiseId, chaves: Array.from(sel) };
      const r = await fetch("/api/carteira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setMsg({ tom: "erro", texto: `Erro: ${d.erro}` }); return; }
      const extra = (d.avisos ?? []).length ? ` ${(d.avisos as string[]).join(" · ")}` : "";
      setMsg({
        tom: (d.ignoradas ?? 0) > 0 || (d.conciliadas ?? 0) > 0 ? "erro" : "good",
        texto: `${fmtInt(d.gravadas)} linha(s) na carteira. Elas já descontam origem e destino na próxima análise.${extra}`,
      });
      setSel(new Set());
      carregar();
    } catch (e) {
      setMsg({ tom: "erro", texto: `Falha ao aprovar: ${(e as Error).message}. Nenhuma linha foi para a carteira.` });
    } finally {
      setAprovando(false);
    }
  };

  // Cabeçalho ordenável como <button>: alcançável por teclado e anunciado pelo
  // leitor de tela — o <th onClick> anterior não era nem uma coisa nem outra.
  const th = (campo: string, rotulo: string, numerico = false) => {
    const ativo = sort.campo === campo;
    return (
      <th scope="col" className={numerico ? "pgm-num" : undefined} aria-sort={ativo ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button type="button" onClick={() => ordenar(campo)} className="ordem" aria-sort={ativo ? (sort.dir === "desc" ? "descending" : "ascending") : undefined} title={`Ordenar por ${rotulo}`}>
          {rotulo}
        </button>
      </th>
    );
  };

  const pctImediata = totaisFiltro.valor > 0 ? totaisFiltro.imediata / totaisFiltro.valor : 0;
  const filtrosAtivos = Object.entries(filtros).filter(([k, v]) => v && v !== FILTROS_INICIAIS[k]).length;
  const nColunas = 13 + (modoPedidos ? meses.length - 1 : 0);
  const confirmarAprovacao = (tudo: boolean) => setConfirma(tudo ? "filtro" : "selecao");

  return (
    <>
      <PageHeader
        title={<>{fmtInt(data.total)} linhas somam {fmtRsCompacto(totaisFiltro.valor)}; <em>{fmtPct(pctImediata, 0)} saem hoje</em></>}
        subtitle={<>Análise {data.analiseId} · uma linha por rota (origem → destino) × SKU · {modoPedidos ? "abatendo pedidos" : "atendendo o saldo ideal"}{filtrosAtivos > 0 && ` · ${filtrosAtivos} filtro(s) ativo(s)`}</>}
        right={
          <>
            <Revalidando ativo={api.revalidando} />
            <a href={`/api/plano/export?${qs}&format=csv`} className="pgm-botao pgm-botao--secundario">Exportar CSV</a>
            <a href={`/api/plano/export?${qs}&format=xlsx`} className="pgm-botao pgm-botao--secundario">Exportar Excel</a>
          </>
        }
      />

      {msg && <Alert tom={msg.tom} titulo={msg.tom === "erro" ? "Atenção" : "Pronto"}>{msg.texto}</Alert>}

      {/* ------------------------------ Filtros ------------------------------ */}
      <section className="app-card filtros-card" aria-label="Filtros do plano">
        <div className="pgm-filtros">
          <Campo rotulo="Buscar" htmlFor="f-busca" style={{ minWidth: 220 }}>
            <input id="f-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou código" className="pgm-campo__controle" />
          </Campo>
          <Campo rotulo="Origem" htmlFor="f-origem">
            <select id="f-origem" value={filtros.origem} onChange={(e) => setF("origem", e.target.value)} className="pgm-campo__controle">
              <option value="">Todas</option>
              {facets.origens.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Destino" htmlFor="f-destino">
            <select id="f-destino" value={filtros.destino} onChange={(e) => setF("destino", e.target.value)} className="pgm-campo__controle">
              <option value="">Todos</option>
              {facets.destinos.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Categoria" htmlFor="f-cat">
            <select id="f-cat" value={filtros.categoria} onChange={(e) => setF("categoria", e.target.value)} className="pgm-campo__controle">
              <option value="">Todas</option>
              {facets.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Comprador" htmlFor="f-comp">
            <select id="f-comp" value={filtros.comprador} onChange={(e) => setF("comprador", e.target.value)} className="pgm-campo__controle">
              <option value="">Todos</option>
              {facets.compradores.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Cobertura na origem" htmlFor="f-cob">
            <select id="f-cob" value={filtros.cobertura} onChange={(e) => setF("cobertura", e.target.value)} className="pgm-campo__controle">
              <option value="total">Total</option>
              <option value="acima_limite">Só estoque parado</option>
            </select>
          </Campo>
          <label className="marca" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={filtros.soImediata === "true"} onChange={(e) => setF("soImediata", String(e.target.checked))} />
            Só com saída imediata
          </label>
          <button
            type="button"
            onClick={() => { setBusca(""); router.replace("/plano", { scroll: false }); setSel(new Set()); }}
            className="pgm-botao pgm-botao--secundario"
            disabled={filtrosAtivos === 0 && !busca}
          >
            Limpar filtros
          </button>
        </div>

        <div className="filtros-acao">
          <div className="grupo" aria-label="Totais do filtro atual">
            <Badge tom="azul">{fmtInt(data.total)} linha(s) no filtro</Badge>
            <Badge>{fmtRsCompacto(totaisFiltro.valor)}</Badge>
            <Badge tom="good">Imediata {fmtRsCompacto(totaisFiltro.imediata)}</Badge>
            <Badge tom="warn">Fiscal {fmtRsCompacto(totaisFiltro.fiscal)}</Badge>
          </div>
          <div className="grupo">
            <button type="button" onClick={() => confirmarAprovacao(false)} disabled={sel.size === 0 || aprovando} className="pgm-botao pgm-botao--secundario">
              Aprovar selecionadas ({sel.size})
            </button>
            <button type="button" onClick={() => confirmarAprovacao(true)} disabled={aprovando || data.total === 0} className="pgm-botao">
              Aprovar todas do filtro ({fmtInt(data.total)})
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------- Tabela ------------------------------ */}
      <section className="app-card app-card--flush" aria-label="Linhas do plano">
        <Rolagem>
          <table className="pgm-tabela tabela-fixa">
            <caption className="sr-only">
              Plano de transferência: uma linha por rota e SKU, {fmtInt(data.total)} linhas no filtro atual.
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 44 }}>
                  <input type="checkbox" checked={itens.length > 0 && itens.every((l) => sel.has(chave(l)))} onChange={alternarTodas} aria-label="Selecionar todas as linhas da página" />
                </th>
                {th("rota", "Rota")}
                {th("codigoProduto", "Código")}
                {th("produto", "Produto")}
                <th scope="col">Categoria</th>
                {modoPedidos
                  ? meses.map((m) => <th key={m} scope="col" className="pgm-num">Transf. {rotuloMes(m)}</th>)
                  : <th scope="col" className="pgm-num">Necessidade</th>}
                {th("transfTotal", "Qtd total", true)}
                <th scope="col" className="pgm-num">Cx</th>
                {th("qtdImediataArredondada", "Imediata (un)", true)}
                {th("valorTotal", "Valor", true)}
                {th("impactoFiscal", "Fiscal", true)}
                {th("coberturaDias", "Cob. origem (d)", true)}
                <th scope="col">Carteira</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((l) => {
                const k = chave(l);
                return (
                  <tr key={k} className={sel.has(k) ? "sel" : undefined}>
                    <td><input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} aria-label={`Selecionar ${l.produto}`} /></td>
                    <td><Rota origem={l.cdOrigem} destino={l.cdDestino} /></td>
                    <td>{l.codigoProduto}</td>
                    <td className="prod" title={l.produto}>{l.produto}</td>
                    <td className="cat prod" style={{ maxWidth: 160 }} title={l.categoriaN1}>{l.categoriaN1}</td>
                    {modoPedidos
                      ? l.transfMes.map((t, i) => <td key={i} className="pgm-num">{fmtInt(t)}</td>)
                      : <td className="pgm-num">{fmtInt(l.demandaSaldo)}</td>}
                    <td className="pgm-num"><b>{fmtInt(l.transfTotal)}</b></td>
                    <td className="pgm-num">{fmtInt(l.caixas)}</td>
                    <td className="pgm-num">{fmtInt(l.qtdImediataArredondada)}</td>
                    <td className="pgm-num">{fmtRs(l.valorTotal)}</td>
                    <td className="pgm-num">{l.aliquota > 0 ? fmtRs(l.impactoFiscal) : <Pill tom="ambar" pequena>sem alíquota</Pill>}</td>
                    <td className="pgm-num">{l.coberturaDias >= 9999 ? "s/ giro" : fmtInt(l.coberturaDias)}</td>
                    <td>{l.naCarteira ? <Status tom="aberta">Aprovada</Status> : <span style={{ color: "var(--ink-3)" }}>sem sugestão</span>}</td>
                  </tr>
                );
              })}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={nColunas} style={{ padding: 0, background: "var(--papel)" }}>
                    <Estado
                      icone="busca"
                      rotulo="Filtro sem resultado"
                      titulo="Nenhuma linha com esses filtros"
                      texto={`${busca ? `"${busca}"` : "A combinação atual"} não encontra nada entre as linhas do plano.`}
                      acoes={<button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => { setBusca(""); router.replace("/plano", { scroll: false }); }}>Limpar filtros</button>}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Rolagem>
        <div className="tabela-rodape">
          <span>Página {data.page} de {data.totalPaginas} · {fmtInt(data.total)} linhas · a saída imediata cobre {fmtPct(pctImediata, 0)} do valor do filtro</span>
          <div className="pag">
            <button type="button" onClick={() => irPara(page - 1)} disabled={data.page <= 1} className="pgm-botao pgm-botao--secundario">Anterior</button>
            <button type="button" onClick={() => irPara(page + 1)} disabled={data.page >= data.totalPaginas} className="pgm-botao pgm-botao--secundario">Próxima</button>
          </div>
        </div>
      </section>

      <div>
        <Ressalvas
          itens={[
            '"s/ giro": SKU sem venda média no destino, ignora teto e piso',
            "Valor e fiscal são recalculados na leitura",
            filtros.cobertura === "acima_limite" && "Visão filtrada: só SKUs com estoque parado na origem",
          ]}
        />
        <Fonte>Fonte: plano da análise {data.analiseId}{data.criadoEm && ` · rodada em ${new Date(data.criadoEm).toLocaleDateString("pt-BR")}`} · estoque objetivo, venda média de 3 meses e pendente da própria base.</Fonte>
      </div>

      {/* ------------------------ Confirmação de aprovação ----------------------- */}
      <Modal
        aberto={confirma !== null}
        titulo={confirma === "filtro" ? `Aprovar ${fmtInt(data.total)} linha(s) do filtro?` : `Aprovar ${sel.size} linha(s) selecionada(s)?`}
        sub="Elas viram sugestões em carteira e passam a descontar o excesso da origem e a entrar como trânsito no destino na próxima análise."
        onFechar={() => setConfirma(null)}
        largura={520}
        rodape={
          <>
            <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => setConfirma(null)}>Voltar</button>
            <button
              type="button"
              className="pgm-botao"
              disabled={aprovando}
              onClick={async () => {
                const tudo = confirma === "filtro";
                setConfirma(null);
                await aprovar(tudo);
              }}
            >
              {aprovando ? "Aprovando…" : confirma === "filtro" ? `Aprovar ${fmtInt(data.total)} linhas` : `Aprovar ${sel.size} linhas`}
            </button>
          </>
        }
      >
        {confirma === "filtro" ? (
          <div className="resumo-previa">
            <div><b>{fmtRsCompacto(totaisFiltro.valor)}</b><span>valor aprovado</span></div>
            <div><b>{fmtRsCompacto(totaisFiltro.imediata)}</b><span>com saída imediata</span></div>
            <div><b>{fmtInt(totaisFiltro.qtd)}</b><span>unidades</span></div>
          </div>
        ) : (
          <div className="resumo-previa" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div><b>{fmtRsCompacto(itens.filter((l) => sel.has(chave(l))).reduce((a, l) => a + l.valorTotal, 0))}</b><span>valor aprovado</span></div>
            <div><b>{fmtInt(itens.filter((l) => sel.has(chave(l))).reduce((a, l) => a + l.transfTotal, 0))}</b><span>unidades</span></div>
          </div>
        )}
        {itens.some((l) => l.naCarteira && (confirma === "filtro" || sel.has(chave(l)))) && (
          <Alert tom="info" titulo="Linhas já aprovadas">
            Parte destas linhas já está na carteira. O app grava só a diferença, ou ignora a linha, e avisa o que fez.
          </Alert>
        )}
      </Modal>
    </>
  );
}
