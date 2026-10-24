# Como o Mirage funciona

Este documento explica a arquitetura do site, como cada paisagem é desenhada, o que
fazer para ter som, como personalizar o que já existe e como criar uma paisagem nova.

- [1. Visão geral](#1-visão-geral)
- [2. O lápis](#2-o-lápis)
- [3. Camadas e "boil"](#3-camadas-e-boil)
- [4. As cenas](#4-as-cenas)
- [5. O viajante](#5-o-viajante)
- [6. O motor](#6-o-motor)
- [7. Som](#som)
- [8. Personalizar](#8-personalizar)
- [9. Estender: criar a 11ª paisagem](#9-estender-criar-a-11ª-paisagem)
- [10. Desempenho, acessibilidade e segurança](#10-desempenho-acessibilidade-e-segurança)

---

## 1. Visão geral

```
┌──────────────────────── index.html ────────────────────────┐
│  <canvas id="scene">   ← paisagem (tudo o que é pesado)    │
│  <svg id="traveler">   ← o viajante, por cima do canvas    │
│  <div class="paper">   ← grão do papel + vinheta           │
│  título · etiqueta da paisagem · controles                 │
└────────────────────────────────────────────────────────────┘
```

São três arquivos, sem dependências:

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | estrutura, CSP, a figura do viajante em SVG (só as partes fixas; pernas e braços são preenchidos pelo script) |
| `style.css` | paleta em variáveis CSS, tipografia, estilos do viajante, etiqueta com "fita adesiva", controles e layout de celular |
| `script.js` | tudo o que se move, dividido em seções numeradas |

Mapa do `script.js`:

| Seção | Conteúdo |
|---|---|
| 0 | paleta `PAL`, gerador aleatório com semente (`rng`), ruído (`noise1`, `fbm`, `ridged`), `makeLayer` |
| 1 | `Pencil`: o lápis |
| 2 | peças de desenho: `drawRange` (cordilheira), `cloudSprite`, `mistSprite`, `spruce`, `rock`, `boatSprite`… |
| 2b | peças comuns: `drawBank` (margem com trilha), `reflect`, ondulações, aves, nuvens, névoa, capim animado, partículas, `withVariants` |
| 3 | as 10 cenas (cada uma com suas peças exclusivas logo acima dela) e a lista `SCENES` |
| 4 | `Traveler`: o viajante |
| 5 | motor: medidas, laço de animação, transições, controles, teclado, link por `#` |

Todo o desenho é **procedural**: não há nenhuma imagem. As formas vêm de funções
matemáticas mais ruído com semente fixa. Por isso a mesma paisagem sai igual em
qualquer tela, só que recomposta para o tamanho dela.

---

## 2. O lápis

`Pencil` é o que dá a cara de desenho feito à mão. Cada lápis tem dois sorteios
independentes:

- **`S` (estrutura):** decide onde vai cada traço. É igual em todas as variantes
  de uma camada, então o desenho não "muda de lugar".
- **`J` (tremor):** decide como a mão treme. Muda de variante para variante, e é
  isso que dá o efeito de animação feita à mão (veja *boil* abaixo).

Métodos:

| Método | Para quê |
|---|---|
| `pen.lines(lista, { w, col, a, wob })` | muitos traços curtos de uma vez (hachura, capim, chuva estática). Cada traço ganha uma leve barriga. Tudo num único `stroke()`, por isso é rápido. |
| `pen.path(pontos, { w, col, a, passes, gap, jit, close })` | contorno à mão: duas passadas (a segunda mais fina e clara), tremor suave por ruído e pequenas falhas no traço (`gap`). |

O sombreado segue sempre a mesma regra visual: **a luz vem da esquerda**. As faces
voltadas para a direita recebem hachura e, nas sombras mais fundas, hachura cruzada.

### A peça principal: `drawRange`

Quase todo relevo (montanhas, colinas, dunas, morenas, matas) passa por
`drawRange(pen, opções)`:

1. Preenche o polígono com uma cor de papel (cobre o que está atrás).
2. Recorta o desenho dentro do polígono e traça, nesta ordem: **traços de queda**
   (ravinas, que seguem a inclinação), **hachura de sombra**, **hachura cruzada**,
   **faixa escura na base**, **estratos de rocha** e **risquinhos de floresta**.
3. Desenha o contorno com `pen.path`.

A intensidade da sombra em cada ponto vem de `shade(x, y, inclinação)`, uma função
que cada cena define. Algumas opções úteis:

| Opção | Efeito |
|---|---|
| `hatchFrom` / `crossFrom` | a partir de que sombra (0–1) entra a hachura e a hachura cruzada |
| `fallDensity`, `maxFall` | quantidade e comprimento máximo dos traços de queda |
| `maxHatch` | comprimento máximo da hachura (evita que vire "chuva" em encostas longas) |
| `snowY` | acima desta altura quase não há traço: fica a neve |
| `bandH` | altura da faixa escura na base |
| `strata` | quantas linhas de estrato de rocha |
| `forest` | fração da altura coberta de risquinhos de árvores |

---

## 3. Camadas e "boil"

Desenhar milhares de traços a cada quadro seria lento demais. Por isso cada cena,
ao começar, **desenha suas camadas uma vez** em canvases fora da tela:

- **Céu** (uma variante só): papel, riscos de céu, sol, riscos da água.
- **Terra** (montanhas e o que estiver longe) e **primeiro plano** (margem,
  árvores grandes): **3 variantes** cada.

As três variantes têm os mesmos traços (mesmo `S`) com tremor diferente (outro
`J`). O motor troca de variante a cada **0,2 s**, e o desenho "ferve" de leve, como
numa animação desenhada quadro a quadro. Esse efeito é o *boil*. A primeira variante
fica pronta na hora; as outras duas são desenhadas com `requestIdleCallback`, quando
o navegador está folgado, para a troca de cena não engasgar.

A cada quadro, `draw()` só **copia** essas camadas e desenha por cima o que se move
(água, nuvens, chuva, animais, balões). Isso custa pouco e mantém os 60 fps.

O **reflexo** (`reflect`) também é barato: copia faixas de 2 px da camada de terra,
de baixo para cima, achatadas e deslocadas por duas ondas senoidais. Cada faixa é
um único `drawImage`.

---

## 4. As cenas

Cada cena é um objeto com este contrato:

```js
const MinhaCena = {
  id: 'minha-cena',          // usado no link: …/#minha-cena
  numeral: 'XI',             // aparece na etiqueta
  place: 'Nome do lugar',
  meta: 'País · 00°00′N 00°00′E',
  mood: 'como deve parecer',  // documentação
  duration: 28,              // segundos
  stopAt: 0.4,               // onde o viajante para (0–1 da largura), na horizontal
  stopAtPortrait: 0.5,       // idem, com a tela em pé (opcional)

  build(env) {               // env = { W, H, res, k, ctx }
    // desenha as camadas estáticas e devolve o estado:
    return {
      draw(ctx, t, variante) {},  // desenha um quadro; t = segundos de cena
      ground(x) {},               // altura do chão onde o viajante pisa
      wind: 1,                    // vento no cachecol do viajante (0,5 a 2)
      // count e addVariant() vêm de withVariants()
    };
  },
};
```

`env`:

| Campo | Significado |
|---|---|
| `W`, `H` | tamanho da tela em pixels CSS |
| `res` | densidade de pixels usada nas camadas (até 2) |
| `k` | escala do traço, proporcional à altura (`H / 850`, entre 0,65 e 1,4). Espessuras, velocidades e tamanhos de detalhe são multiplicados por `k` |
| `ctx` | contexto 2D principal (para criar padrões de hachura) |

As cenas se adaptam à orientação: quase todas verificam `H > W * 1.1` (retrato) e
então baixam as montanhas, alargam os picos para não virarem agulhas e mudam o ponto
de parada do viajante.

### O roteiro

| # | id | Lugar | Sensação | Movimento principal | Vento |
|---|---|---|---|---|---|
| I | `fiordes` | Geirangerfjord, Noruega | calma, contemplativa | cachoeiras, reflexo, névoa, barco | 0,8 |
| II | `fuji` | Monte Fuji, Japão | delicada, serena | pétalas caindo, névoa no monte | 0,7 |
| III | `saara` | Erg Chebbi, Marrocos | vasta, silenciosa | miragem no horizonte, areia nas cristas, caravana | 1,5 |
| IV | `patagonia` | Torres del Paine, Chile | selvagem, ventosa | nuvens lenticulares rápidas, lago agitado, capim, condor | 2 |
| V | `amazonia` | Rio Negro, Brasil | úmida, viva | chuva, anéis na água, canoa, araras | 0,6 |
| VI | `himalaia` | Ama Dablam, Nepal | rarefeita, espiritual | bandeiras de oração, mar de nuvens, neve | 1,3 |
| VII | `savana` | Amboseli, Quênia | quente, ampla | manada de elefantes, abutres, capim alto | 0,9 |
| VIII | `capadocia` | Göreme, Turquia | onírica, leve | balões subindo em várias profundidades | 0,5 |
| IX | `highlands` | Eilean Donan, Escócia | melancólica, chuvosa | chuva oblíqua, nuvens baixas, lago picado | 1,6 |
| X | `lencois` | Lençóis Maranhenses, Brasil | luminosa, aberta | sombras de nuvem nas dunas, brilhos nas lagoas | 1 |

A ordem segue um ritmo: alternar cenas cheias e vazias, calmas e agitadas, para que
a sensação mude de uma para a outra. A ordem é a da lista no fim da seção 3:

```js
const SCENES = [Fjord, Fuji, Sahara, Patagonia, Amazon, Himalaya, Savanna, Cappadocia, Highlands, Lencois];
```

---

## 5. O viajante

A figura fica em `index.html`, dentro de `<svg id="traveler">`, e é estilizada em
`style.css` (seção "O viajante").

**Proporções:** a unidade é 1 cabeça = 10. A figura tem 75 de altura (7,5
cabeças), mais o chapéu, e os pés ficam em `y = 0`. Na tela, ela ocupa cerca de
**1/8 da altura** (`clamp(H × 0,125, 64 px, 170 px)`).

| Parte | Medida (unidades) |
|---|---|
| quadril | `y = −37` |
| coxa / canela / pé | 18 / 17,5 / 5,4 |
| ombro | `(0,6; −59,6)` |
| braço / antebraço | 12,6 / 11,8 |

**Ciclo de caminhada.** A cada quadro o script calcula, para cada perna, o ângulo da
coxa, a dobra do joelho (maior na fase de balanço) e a inclinação do pé, e reescreve
o atributo `d` dos caminhos SVG. O quadril sobe e desce conforme a perna de apoio,
os braços balançam opostos às pernas e o tronco inclina 4° para a frente ao andar.
Um ciclo completo leva 1,1 s e avança 60 unidades.

**Plano da travessia.** No começo de cada cena, `Traveler.reset()` calcula um
plano que cabe na duração dela: espera 1,6 s, caminha até `stopAt`, freia
suavemente, **para e contempla** (cabeça levemente erguida, respiração) e depois
sai pela direita. Se a cena for curta demais, ele anda um pouco mais rápido em vez de
cortar a pausa.

**Tremor e vento.** Um filtro `feTurbulence` + `feDisplacementMap` dá ao contorno o
tremor de lápis; a semente do filtro muda a cada 0,2 s, no mesmo ritmo do *boil* das
paisagens. O cachecol tremula com o `wind` de cada cena.

---

## 6. O motor

O laço (`frame`) roda com `requestAnimationFrame`:

1. Avança o relógio da cena (`sceneT`) e o relógio do mundo (`animT`, que anda a
   20% com movimento reduzido).
2. Quando `sceneT` passa da `duration`, chama `goTo(idx + 1)`. Ao passar da última
   cena, o índice volta a 0.
3. Desenha a cena com a variante de *boil* atual.
4. Se houver transição, desenha por cima a **foto da cena anterior** recortada por
   uma borda ondulada de lápis que varre a tela da esquerda para a direita (2,2 s),
   revelando a nova cena "desenhada" por baixo.
5. Atualiza o viajante.

Pausado, o laço não redesenha nada (economiza bateria).

**Redimensionar** a janela, ou girar o celular, refaz as medidas e redesenha a cena
atual para o novo tamanho, mantendo o viajante na mesma posição relativa.

**Link por `#`.** `goTo` atualiza o endereço com `history.replaceState`; ao abrir
`…/#savana`, o site começa nessa cena. Nada é guardado.

---

<a id="som"></a>
## 7. Som

O Mirage foi feito **sem música**: o "andamento" de cada cena é o vento, a água e a
luz. Se você quiser acrescentar uma trilha, este é o caminho.

### 7.1 Tocar um arquivo

1. Coloque o arquivo no repositório (por exemplo `audio/trilha.mp3`). Use apenas
   músicas que você tenha direito de publicar.
2. Em `index.html`, antes de `</main>`:
   ```html
   <audio id="trilha" src="audio/trilha.mp3" loop preload="none"></audio>
   ```
3. Na CSP, acrescente `media-src 'self';`.
4. Acrescente um botão de som aos controles e ligue-o no `script.js`
   (seção 5, junto dos outros controles):
   ```js
   const audio = document.getElementById('trilha');
   ui.sound.addEventListener('click', () => {
     if (audio.paused) audio.play(); else audio.pause();
     ui.sound.setAttribute('aria-pressed', audio.paused ? 'false' : 'true');
   });
   ```
   Os navegadores só tocam som depois de uma interação, por isso o botão é
   obrigatório. Não use `autoplay`.

**Para trocar a música** depois, basta substituir o arquivo `audio/trilha.mp3` por
outro com o mesmo nome, ou mudar o `src` do `<audio>`.

### 7.2 Fazer as cenas acompanharem a música

Todo movimento do mundo vem de `animT`, e o vento do viajante vem de `state.wind`.
Com um `AnalyserNode` da Web Audio API dá para medir a energia da música e usar
esse valor como acelerador:

```js
// depois do primeiro clique em "som":
const ac = new AudioContext();
const src = ac.createMediaElementSource(audio);
const an = ac.createAnalyser();
an.fftSize = 256;
src.connect(an);
an.connect(ac.destination);
const bins = new Uint8Array(an.frequencyBinCount);
let energy = 0;
function readEnergy() {
  an.getByteFrequencyData(bins);
  let s = 0;
  for (let i = 0; i < 16; i++) s += bins[i];  // graves
  energy += ((s / (16 * 255)) - energy) * 0.1; // suavizado, 0–1
}
```

E no `frame()`:

```js
readEnergy();
const rate = 0.7 + energy * 0.8;            // de 0,7× a 1,5×
animT += dt * (reduced ? 0.2 : rate);
```

O mesmo valor pode alimentar o vento do viajante (`state.wind * (0.6 + energy)`)
ou a densidade da chuva. Mantenha o respeito a `prefers-reduced-motion`.

> **Arquivo do visitante:** se quiser deixar o visitante tocar uma música do próprio
> computador, use `<input type="file" accept="audio/*">` e
> `URL.createObjectURL(arquivo)` (e acrescente `blob:` ao `media-src` da CSP).
> Antes de tocar, confira se `arquivo.type` começa com `audio/` e se o tamanho é
> razoável (por exemplo, até 50 MB). O arquivo nunca sai do navegador.

---

## 8. Personalizar

### Paleta

A paleta está em dois lugares, que precisam bater:

- `style.css`, em `:root` (`--paper`, `--ink`, `--g1`, `--g2`, `--g3`): interface e
  viajante;
- `script.js`, em `PAL`: as paisagens.

Os padrões de hachura do casaco e da mochila (`#tv-hatch`, `#tv-hatch-dark` em
`index.html`) também usam essas cores. Para um caderno em sépia, por exemplo,
troque `ink` por `#3B2A1E` e `paper` por `#F4E9D8` nos três lugares.

### Tipografia

Em `index.html`, troque o link do Google Fonts; em `style.css`, as variáveis
`--serif` (título) e `--hand` (texto). Mantenha o título com peso médio e o texto
leve.

### Tempo e ordem

- Duração de cada paisagem: `duration` em cada cena.
- Velocidade de troca do *boil*: `0.2` em `frame()` (no cálculo de `v`) e em
  `Traveler.update` (filtro do viajante).
- Duração da transição: `trans = { p: 0, dur: … }` em `goTo`.
- Ordem ou retirada de cenas: a lista `SCENES`.

### O viajante

- Tamanho: `clamp(H * 0.125, 64, 170)` em `Traveler.setup`.
- Ritmo do passo: `CYCLE` (segundos por ciclo) e `STRIDE` (avanço por ciclo).
- Roupa e acessórios: os caminhos dentro de `<g id="tv-upper">` em `index.html`
  (coordenadas na unidade de cabeça = 10, pés em `y = 0`). Para trocar o chapéu,
  edite `.tv-hat` e `.tv-brim`.
- Onde ele para: `stopAt` / `stopAtPortrait` de cada cena.

---

## 9. Estender: criar a 11ª paisagem

1. **Copie o esqueleto** abaixo para a seção 3 do `script.js`, logo antes de
   `/** Ordem do roteiro`.
2. **Desenhe o relevo** com `sample()` + `drawRange()`, combinando funções simples:
   `bell()` para picos, `ridged()` para rocha, `fbm()` para irregularidade.
3. **Monte o primeiro plano** com `drawBank()`: ele já devolve trilha, pedras e capim.
4. **Anime** no `draw()`: reaproveite `drawClouds`, `drawMist`, `reflect`,
   `drawRipples`, `drawBirds`, `drawGrass` e `makeParticles`.
5. **Inclua na lista** `SCENES` e escolha um `id` único para o link.
6. **Teste** em tela larga e em pé (`…/#seu-id`) e com "reduzir movimento" ligado.

```js
/* ---------- Cena XI · Exemplo ---------- */
const Exemplo = {
  id: 'exemplo',
  numeral: 'XI',
  place: 'Lugar',
  meta: 'País · 00°00′N 00°00′E',
  mood: 'tranquila',
  duration: 28,
  stopAt: 0.45,

  build(env) {
    const { W, H, res, k } = env;
    const hY = H * 0.6;
    const n = noise1(rng(11101));
    const serra = (x) => hY - H * (0.1 + 0.15 * bell(x / W, 0.5, 0.2) + 0.02 * ridged(n, x / W * 15));
    const chao = (x) => H * 0.84 + H * 0.01 * Math.sin(x / W * 3);
    const trilha = (x) => chao(x) + H * 0.035;
    const pontos = sample(-6, W + 6, 3, serra);

    const ceu = makeLayer(W, H, res);
    ceu.c.fillStyle = PAL.paper;
    ceu.c.fillRect(0, 0, W, H);
    skyStrokes(new Pencil(ceu.c, 11150, 11151, k), W, 0, H * 0.3);
    const nuvens = makeClouds(11160, 3, W, H, k, res);

    const st = { W, H, terra: [], frente: [], wind: 1 };
    withVariants(st, (seedJ) => {
      const t = makeLayer(W, H, res);
      drawRange(new Pencil(t.c, 11200, seedJ, k), {
        pts: pontos, base: hY + 1, fill: '#ECE5D7', hatchCol: PAL.g1, hatchA: 0.5, fallA: 0.4,
        fallEvery: 2, fallDensity: 0.6, hatchEvery: 1, hatchFrom: 0.45, crossFrom: 0.8,
        lineW: 1.1, lineCol: PAL.ink, lineA: 0.95,
        shade: (x, y, inclinacao) => 0.3 + 0.5 * Math.tanh(inclinacao * 2),
      });
      st.terra.push(t);
      const f = makeLayer(W, H, res);
      drawBank(new Pencil(f.c, 11300, seedJ + 5, k), W, H, chao, trilha);
      st.frente.push(f);
    });

    st.ground = trilha;
    st.draw = (ctx, t, v) => {
      ctx.drawImage(ceu.cv, 0, 0, W, H);
      drawClouds(ctx, nuvens, t, W);
      ctx.drawImage((st.terra[v] || st.terra[0]).cv, 0, 0, W, H);
      ctx.drawImage((st.frente[v] || st.frente[0]).cv, 0, 0, W, H);
    };
    return st;
  },
};
```

**Dicas de direção de arte**

- Sementes (`rng(…)`, `new Pencil(c, S, J, k)`) diferentes em cada camada, sempre
  fixas: mesma paisagem a cada visita.
- Sombra sempre do lado direito; quanto mais perto, mais escuro o traço (`PAL.ink`)
  e mais grosso; quanto mais longe, mais claro (`PAL.g2`, `PAL.g3`) e mais fino.
- Deixe papel em branco: o branco é o "ar" da cena.
- Multiplique tamanhos e velocidades por `k` para a cena funcionar do celular à TV.
- Um elemento que se mova a cada quadro (`draw`) deve ser barato: monte um
  `Path2D`/`beginPath` com muitos traços e faça um único `stroke()`.

---

## 10. Desempenho, acessibilidade e segurança

**Desempenho**

- Camadas pré-desenhadas e um teto de 3,6 milhões de pixels por camada (a
  densidade de pixels cai em telas enormes).
- Variantes de *boil* desenhadas quando o navegador está ocioso.
- Pausado, nada é redesenhado.
- Medido no Chromium: 57 a 61 fps em todas as cenas, em 1280 × 800.

**Acessibilidade**

- `prefers-reduced-motion`: sem *boil*, transição por esmaecer, viajante parado,
  mundo a 20% da velocidade e sem animação da etiqueta.
- Botões com `aria-label`, estado de pausa em `aria-pressed`, pontos com
  `aria-current`, etiqueta da paisagem com `aria-live="polite"` (o leitor de tela
  anuncia a paisagem nova).
- Teclado: setas trocam de cena; espaço pausa; foco visível em tracejado.
- Alvos de toque com 44 px.

**Segurança (GitHub Pages)**

- CSP em `<meta>`: `default-src 'none'`; scripts e estilos só de `'self'` (mais o
  CSS do Google Fonts); fontes só de `fonts.gstatic.com`; imagens de `'self'` e
  `data:` (grão do papel gerado no navegador); `connect-src 'none'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
- `referrer` desligado.
- Nenhum `innerHTML`, `eval`, `new Function`, cookie, `localStorage` ou requisição
  de rede feita pelo script.
- O site não aceita upload. Se você acrescentar a opção de música do visitante,
  siga a validação descrita em [Som](#som).
