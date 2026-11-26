// Busca passagens Curitiba -> Rio (ida e volta), guarda o histórico e avisa promoções.
//
// Variáveis de ambiente:
//   SERPAPI_KEY  (obrigatória) chave da SerpApi, usada para ler o Google Flights
//   NTFY_TOPIC   (recomendada) nome secreto do canal no app ntfy
//   PRECO_ALVO   (opcional)    avisar sempre que o total ficar igual ou abaixo disso (R$)
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const ROTA = { origem: "CWB", destinos: "GIG,SDU", ida: "2027-02-05", volta: "2027-02-10" };
export const MIN_AMOSTRAS = 8; // leituras necessárias antes de comparar com o histórico
const ARQUIVO = new URL("./docs/data.json", import.meta.url);
const MAX_HISTORICO = 1000;
const QUEDA_BOA = 0.10; // 10% abaixo da mediana recente
const NOVA_QUEDA = 0.03; // repete o aviso se cair mais 3%
const REPETIR_APOS_MS = 24 * 3600 * 1000;

async function consultar(chave) {
  const parametros = new URLSearchParams({
    engine: "google_flights",
    departure_id: ROTA.origem,
    arrival_id: ROTA.destinos,
    outbound_date: ROTA.ida,
    return_date: ROTA.volta,
    type: "1",
    adults: "1",
    currency: "BRL",
    hl: "pt-br",
    gl: "br",
    api_key: chave,
  });
  // As mensagens de erro nunca incluem a URL, porque ela contém a chave.
  const resposta = await fetch(`https://serpapi.com/search.json?${parametros}`, { signal: AbortSignal.timeout(90_000) });
  if (!resposta.ok) throw new Error(`SerpApi respondeu HTTP ${resposta.status} (chave inválida ou cota esgotada?)`);
  const dados = await resposta.json();
  if (dados.error) throw new Error(`SerpApi: ${dados.error}`);
  return dados;
}

export function extrairOfertas(dados) {
  return [...(dados.best_flights ?? []), ...(dados.other_flights ?? [])]
    .filter((item) => item.price && item.flights?.length)
    .map(({ price, flights, total_duration }) => {
      const saida = flights[0].departure_airport;
      const chegada = flights.at(-1).arrival_airport;
      return {
        preco: price,
        companhias: [...new Set(flights.map((t) => t.airline ?? "?"))].join(" + "),
        origem: saida.id ?? ROTA.origem,
        destino: chegada.id ?? "",
        partida: saida.time ?? "",
        chegada: chegada.time ?? "",
        duracao_min: total_duration ?? null,
        paradas: flights.length - 1,
      };
    })
    .sort((a, b) => a.preco - b.preco || a.paradas - b.paradas || a.duracao_min - b.duracao_min)
    .slice(0, 8);
}

function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

// Devolve os motivos pelos quais o preço é bom (lista vazia = não é promoção).
export function avaliar(preco, historico, nivelGoogle, precoAlvo) {
  const motivos = [];
  if (precoAlvo && preco <= precoAlvo) motivos.push(`abaixo do seu preço-alvo de R$ ${precoAlvo}`);
  if (nivelGoogle === "low") motivos.push("o Google Flights classifica como preço baixo");
  const anteriores = historico.slice(-56).map((h) => h.preco); // últimos 7 dias
  if (anteriores.length >= MIN_AMOSTRAS) {
    const m = mediana(anteriores);
    if (preco <= m * (1 - QUEDA_BOA)) motivos.push(`${Math.round((1 - preco / m) * 100)}% abaixo da média recente`);
  }
  return motivos;
}

export function deveAvisar(preco, motivos, ultimoAviso, agora) {
  if (!motivos.length) return false;
  if (!ultimoAviso) return true;
  if (preco <= ultimoAviso.preco * (1 - NOVA_QUEDA)) return true;
  return agora - new Date(ultimoAviso.quando) >= REPETIR_APOS_MS;
}

// Atualiza o estado com uma nova leitura.
export function processar(estado, dados, precoAlvo, agora) {
  const ofertas = extrairOfertas(dados);
  if (!ofertas.length) throw new Error("A busca não trouxe nenhum voo com preço.");
  const insights = dados.price_insights ?? {};
  const historico = estado.historico ?? [];
  const preco = ofertas[0].preco;
  const motivos = avaliar(preco, historico, insights.price_level, precoAlvo);
  const quando = agora.toISOString();
  return {
    avisar: deveAvisar(preco, motivos, estado.ultimo_aviso, agora),
    estado: {
      rota: ROTA,
      atualizado_em: quando,
      link: dados.search_metadata?.google_flights_url ?? "",
      preco_alvo: precoAlvo,
      nivel_google: insights.price_level ?? null,
      faixa_tipica: insights.typical_price_range ?? null,
      motivos,
      ofertas,
      historico: [...historico, { quando, preco }].slice(-MAX_HISTORICO),
      // Se deixou de ser promoção, a próxima promoção volta a avisar na hora.
      ultimo_aviso: motivos.length ? (estado.ultimo_aviso ?? null) : null,
    },
  };
}

export async function notificar(topico, titulo, mensagem, link) {
  const resposta = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topico, title: titulo, message: mensagem, priority: 4, tags: ["airplane"],
      ...(link ? { click: link } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resposta.ok) throw new Error(`ntfy respondeu HTTP ${resposta.status}`);
}

export async function executar(env, arquivo = ARQUIVO, agora = new Date()) {
  // O dia vale no fuso de Curitiba (UTC-3).
  if (new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10) > ROTA.ida) {
    console.log("A data da ida já passou; nada a buscar.");
    return 0;
  }
  const chave = env.SERPAPI_KEY?.trim();
  if (!chave) {
    console.error("Defina SERPAPI_KEY (veja o README).");
    return 1;
  }
  const alvo = env.PRECO_ALVO?.trim().replace(",", ".");
  const precoAlvo = alvo ? Number(alvo) : null;
  if (Number.isNaN(precoAlvo)) {
    console.error("PRECO_ALVO deve ser um número, por exemplo 700.");
    return 1;
  }
  const anterior = JSON.parse(await readFile(arquivo, "utf8").catch(() => "{}"));
  const { estado, avisar } = processar(anterior, await consultar(chave), precoAlvo, agora);

  const melhor = estado.ofertas[0];
  console.log(`Menor preço: R$ ${melhor.preco} (${melhor.companhias})`);

  let codigo = 0;
  const topico = env.NTFY_TOPIC?.trim();
  if (avisar && !topico) {
    console.log("Promoção encontrada, mas NTFY_TOPIC não está definido.");
  } else if (avisar) {
    const mensagem = `${melhor.companhias} · ${melhor.origem} → ${melhor.destino} · ida 05/02, volta 10/02\n${estado.motivos.join("; ")}`;
    try {
      await notificar(topico, `Passagem para o Rio por R$ ${melhor.preco}`, mensagem, estado.link);
      estado.ultimo_aviso = { preco: melhor.preco, quando: agora.toISOString() };
      console.log("Aviso enviado.");
    } catch (erro) {
      console.error(`Não consegui enviar o aviso: ${erro.message}`);
      codigo = 1;
    }
  }
  await writeFile(arquivo, JSON.stringify(estado, null, 1));
  return codigo;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await executar(process.env);
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
