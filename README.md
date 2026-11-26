# Voo pro Rio

App de celular que acompanha passagens **Curitiba → Rio (GIG e SDU)**, ida 05/02/2027 e volta 10/02/2027.

- Um robô no GitHub busca os preços no Google Flights (via SerpApi) a cada 3 horas, com o celular desligado ou não.
- Quando há promoção, chega uma notificação pelo app **ntfy**.
- A tela do app é um site que você instala na tela inicial do celular.

## Instalação (uma vez só, cerca de 20 minutos)

### 1. Chave de busca
Crie uma conta gratuita em <https://serpapi.com> e copie sua **API Key**.

### 2. Notificações
Instale o app **ntfy** (Play Store ou App Store), toque em **+** e assine um canal com um nome longo e difícil de adivinhar, por exemplo `voo-rio-` seguido de letras e números aleatórios. Quem souber o nome consegue ler os avisos.

### 3. GitHub
1. Crie um repositório **público** em <https://github.com/new> (o GitHub Pages gratuito exige isso). Nada secreto fica nos arquivos.
2. Envie esta pasta. No PowerShell, dentro dela, troque `SEU_USUARIO` e o nome do repositório:

```powershell
git init -b main
```
```powershell
git add .
```
```powershell
git commit -m "App de passagens"
```
```powershell
git remote add origin https://github.com/SEU_USUARIO/voo-pro-rio.git
```
```powershell
git push -u origin main
```

3. Em **Settings → Pages → Source**, escolha **GitHub Actions**.
4. Em **Settings → Secrets and variables → Actions → Secrets**, crie:
   - `SERPAPI_KEY`: a chave do passo 1
   - `NTFY_TOPIC`: o nome do canal do passo 2
5. Opcional, na aba **Variables**: `PRECO_ALVO` (ex.: `700`) para ser avisado sempre que o preço chegar a esse valor.
6. Em **Actions → Buscar passagens → Run workflow**, faça a primeira busca.

### 4. No celular
Abra `https://SEU_USUARIO.github.io/voo-pro-rio/` e:
- **Android (Chrome):** menu ⋮ → **Adicionar à tela inicial**
- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**

## Quando você recebe aviso
Basta um destes:
- preço igual ou abaixo do `PRECO_ALVO`;
- o Google Flights classifica o preço como baixo;
- preço 10% ou mais abaixo da mediana recente (a partir da 9ª leitura, cerca de 1 dia).

A mesma promoção não é repetida por 24 horas, a não ser que o preço caia mais 3%.

## Outros sites
Decolar, Skyscanner e Booking.com aparecem como botões que abrem a busca já com rota e datas. O robô **não** lê os preços deles, então os avisos consideram só o Google Flights.

## Limites
- O plano gratuito da SerpApi tinha 250 buscas por mês na consulta de 26/11/2026. A cada 3 horas são até 248, então use o **Run workflow** com moderação (confira o limite atual no site).
- O GitHub pode atrasar o horário agendado em alguns minutos.
- Os preços são para 1 adulto. A lista mostra os voos de ida com o preço total; o voo de volta você escolhe no Google Flights.
- Confira bagagem e preço final antes de comprar.
- Depois de 05/02/2027 o robô para de buscar. Aí é só desativar o workflow.

## Para mudar rota ou datas
Edite `ROTA` no começo de `buscar.mjs`, os textos das datas em `docs/index.html` e a mensagem do aviso em `buscar.mjs`.

## Testes
```powershell
node --test
```
