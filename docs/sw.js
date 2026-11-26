// Rede primeiro; sem internet, mostra a última versão guardada.
self.addEventListener("fetch", evento => {
  if (evento.request.method !== "GET") return;
  evento.respondWith((async () => {
    const cache = await caches.open("voo-v1");
    try {
      const resposta = await fetch(evento.request);
      if (resposta.ok) await cache.put(evento.request, resposta.clone());
      return resposta;
    } catch (erro) {
      const guardada = await cache.match(evento.request);
      if (guardada) return guardada;
      throw erro;
    }
  })());
});
