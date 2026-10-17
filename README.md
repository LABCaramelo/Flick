# Claquete — cinema com IA

Recriação funcional da ferramenta do flick.art: idealize, gere e edite filmes num único canvas.
A estrutura foi levantada por engenharia reversa do bundle público do site (REA + leitura do
código) e pela observação da interface logada; marca e textos são próprios.

## Funcionalidades

- **Tela (canvas infinito)** — nós de imagem, vídeo, áudio, notas em markdown e seções (cenas);
  conexões arrastáveis entre nós; seleção por retângulo; desfazer/refazer; copiar/colar; arrastar
  arquivos; organizar automaticamente; atalhos (`T` nota, `S` seção, `H` mão, `Ctrl+D`, `Del`,
  `Ctrl+Z`, `Ctrl+roda` zoom).
- **20 ações de geração** (as mesmas do original): Imagem, Texto→Imagem, Editar/Combinar,
  Transferir estilo, Remover fundo, Inpaint, Mudar ângulo, Referência de personagem, Upscale,
  Quadro→Vídeo, Omni Reference, Elementos, Movimento, Estender, Editar vídeo, Upscale de vídeo,
  Efeitos sonoros, Diálogo de personagem, Voz e Música — com versões, menções `@` e estilos.
- **Agente** (OpenAI, function calling) — lê o canvas, cria seções/notas, gera imagens e vídeos,
  escreve na História, monta a linha do tempo; modo de aprovação Auto/Perguntar; histórico de
  conversas; sugestões de próximos passos; ditado por voz.
- **História** — roteiro/decupagem (TipTap) com sumário e memória do projeto (trava de
  consistência visual).
- **Set 3D** — foto vira cenário; posicione pessoas/objetos/luzes, defina planos e movimentos de
  câmera (dolly, grua, pan, órbita, dolly zoom…), ensaie e **grave**: os quadros viram frames
  cinematográficos e o vídeo do plano é gerado.
- **Editor de vídeo** — recursos por seção, trilhas (principal, sobreposição, áudio), cortar,
  aparar, ímã, velocidade, volume, fades, transições, textos; exporta MP4 via ffmpeg.

## Configuração

Requisitos: Node 20+ e `ffmpeg`/`ffprobe` no PATH.

```bash
npm install
```

Crie `.env.local` (já ignorado pelo Git) com:

```
HF_CREDENTIALS=<key-id>:<key-secret>   # API do Higgsfield (geração)
OPENAI_API_KEY=<sua chave>              # agente
# OPENAI_MODEL=gpt-5
```

Outras variáveis em `.env.example` (porta da API, MCP do Higgsfield, URL pública).

```bash
npm run dev
```

Abra http://localhost:5173.

## Provedores de geração (Configurações → Geração de mídia)

| Provedor | Uso |
| --- | --- |
| **Higgsfield API** (padrão com `HF_CREDENTIALS`) | SDK oficial `@higgsfield/client`; 83 endpoints catalogados de docs.higgsfield.ai com JSON Schema (`server/providers/higgsfield-catalog.json`). A interface lista os modelos do flick.art que existem na Higgsfield (`shared/actions.ts`), cada um mapeado para seus endpoints. O painel mostra o custo estimado antes de gerar (endpoint `/estimate` da Higgsfield ou tabela publicada, já com o desconto da conta). Áudio nativo vem desligado e pedidos pagos não são reenviados automaticamente. Mídias locais vão por upload pré-assinado. |
| **Higgsfield MCP** | `https://mcp.higgsfield.ai/mcp` com OAuth; mapeia ações → ferramentas automaticamente (ajustável). Cobre o que a API não tem: voz, música, upscale, remoção de fundo. |
| **Offline (simulado)** | Sem custo: gera imagens, vídeos e áudios de demonstração para testar fluxos. |

Exemplo mínimo do SDK (Seedance 2.5, gera um vídeo cobrado): `npm run higgsfield:example`.

## Estrutura

```
shared/     tipos, catálogo de ações e modelos, estilos (cliente + servidor)
server/     Express: projetos, mídia, jobs (SSE), provedores, agente, exportação ffmpeg
src/        React: Home, Tela, História, Set 3D (three.js), Editor, painel do agente
index.ts    exemplo do SDK do Higgsfield
```

Dados ficam em `data/` (projetos, mídias, conversas, credenciais OAuth do MCP).

## Identidade visual (Um Cara Caramelo)

A interface segue o Design System Caramelo (material Lumen, tema escuro). Os arquivos vêm do pacote `@caramelo/design-system` e ficam copiados no repo, para o build não depender da pasta local do Design System:

- `src/styles/caramelo/`: `caramelo.css` (tokens `--cm-*`, fontes Montserrat/Inter/Covered By Your Grace auto-hospedadas, barras de rolagem, glitch e rastro). Não edite esse arquivo; os ajustes do Claquete ficam em `src/styles/global.css`, que mapeia as variáveis do app para os papéis Caramelo.
- `public/caramelo/`: isotipo (`brand/`, também usado como favicon) e as 28 figurinhas do rastro (`stickers/`).
- `src/components/ui/caramelo/`: `Isotype` e `PointerTrail`, portados do pacote. O rastro aparece no topo da Home.

Para atualizar, copie de novo `dist/styles.css`, `dist/fonts/` e `src/assets/` do Design System.
