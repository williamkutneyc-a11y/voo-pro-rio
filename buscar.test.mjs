import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MIN_AMOSTRAS, avaliar, deveAvisar, executar, extrairOfertas, processar } from "./buscar.mjs";

const AGORA = new Date("2026-11-26T12:00:00Z");
const horas = (n) => new Date(AGORA.getTime() + n * 3600 * 1000);

function resposta(preco, nivel = "typical") {
  const flights = [{
    airline: "Azul",
    departure_airport: { id: "CWB", time: "2027-02-05 08:00" },
    arrival_airport: { id: "SDU", time: "2027-02-05 09:25" },
  }];
  return { best_flights: [{ price: preco, total_duration: 85, flights }], other_flights: [{ flights }], price_insights: { price_level: nivel } };
}

test("ignora voo sem preço", () => {
  assert.deepEqual(extrairOfertas(resposta(700)).map((o) => o.preco), [700]);
});

test("busca vazia é erro", () => {
  assert.throws(() => processar({}, {}, null, AGORA));
});

test("só avisa quando o preço é bom", () => {
  assert.equal(processar({}, resposta(900), null, AGORA).avisar, false);
  assert.equal(processar({}, resposta(500), 600, AGORA).avisar, true);
  assert.equal(processar({}, resposta(900, "low"), null, AGORA).avisar, true);
});

test("compara com o histórico só com amostras suficientes", () => {
  const poucas = Array(MIN_AMOSTRAS - 1).fill({ preco: 1000 });
  assert.deepEqual(avaliar(800, poucas), []);
  assert.equal(avaliar(800, [...poucas, { preco: 1000 }]).length, 1);
});

test("não repete o mesmo aviso antes de 24 h", () => {
  const ultimo = { preco: 500, quando: AGORA.toISOString() };
  assert.equal(deveAvisar(500, ["x"], ultimo, horas(3)), false);
  assert.equal(deveAvisar(480, ["x"], ultimo, horas(3)), true);
  assert.equal(deveAvisar(500, ["x"], ultimo, horas(25)), true);
});

test("fim da promoção zera o último aviso", () => {
  const anterior = { ultimo_aviso: { preco: 500, quando: AGORA.toISOString() } };
  assert.equal(processar(anterior, resposta(900), null, AGORA).estado.ultimo_aviso, null);
});

test("fluxo completo com rede simulada: grava, avisa uma vez e não vaza a chave", async (t) => {
  const arquivo = join(await mkdtemp(join(tmpdir(), "voo-")), "data.json");
  const avisos = [];
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url, opcoes) => {
    if (String(url).startsWith("https://ntfy.sh")) {
      avisos.push(JSON.parse(opcoes.body));
      return new Response("{}");
    }
    return new Response(JSON.stringify(resposta(500)), { status });
  });
  const env = { SERPAPI_KEY: "chave-secreta", NTFY_TOPIC: "canal", PRECO_ALVO: "600" };

  assert.equal(await executar(env, arquivo, AGORA), 0);
  assert.equal(await executar(env, arquivo, horas(3)), 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].topic, "canal");
  const salvo = await readFile(arquivo, "utf8");
  assert.equal(JSON.parse(salvo).historico.length, 2);
  assert.ok(!salvo.includes("chave-secreta") && !salvo.includes("canal"));

  status = 429;
  await assert.rejects(executar(env, arquivo, horas(6)), (e) => !e.message.includes("chave-secreta"));
});

test("para de buscar depois da data de ida", async () => {
  assert.equal(await executar({}, "inexistente", new Date("2027-02-06T12:00:00Z")), 0);
});
