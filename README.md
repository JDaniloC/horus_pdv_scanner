# Horus PDV Scanner — Coletor Mobile ao Vivo & Unificador de Planilhas

Sistema web mobile-first criado para operar com a **câmera do celular sempre aberta**, capturando através de screenshots/frames ao vivo o **código de barras (EAN/GTIN/UPC)**, buscando automaticamente os **dados do produto em catálogos públicos** (Open Food/Beauty/Products/PetFood Facts, Cosmos Bluesoft e catálogo de mercadinho brasileiro) e extraindo o **preço de venda (R$ XX,XX)** diretamente da etiqueta da gôndola via **OCR local (Tesseract.js)**.

Todas as capturas alimentam em tempo real planilhas colaborativas sincronizadas via **WebSocket**, permitindo que **diversos celulares escaneiem produtos ao mesmo tempo** (na mesma planilha ou em planilhas separadas por corredor/operador) e **juntem tudo em uma planilha única `.xlsx` ou `.csv`** no formato oficial de importação do **[Horus PDV](https://github.com/JDaniloC/horus_pdv)**.

---

## Principais Funcionalidades

1. **Câmera Sempre Aberta com Análise de Screenshots ao Vivo (Dual-Zone HUD)**:
   - **Zona 1 — Código de Barras**: Leitura contínua (~5 frames/seg) de `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E`, `Code 128`, `Code 39`, `ITF` e etiquetas de balança (`EAN-13` prefixo `2`).
   - **Zona 2 — OCR de Preço da Etiqueta**: Recorte inteligente de alto contraste da etiqueta de gôndola para identificar preços em Reais (`R$ XX,XX`, `POR XX,XX`, `OFERTA XX,XX`) sem custos de API externa.
   - **Enriquecimento Automático via Código de Barras**: Ao detectar o EAN, busca automaticamente `Nome do Produto`, `Marca`, `Categoria`, `Descrição` e `Imagem` em bases públicas e estima o `PrecoCusto` caso apenas o `PrecoVenda` esteja na gôndola.

2. **Contabilização Inteligente**:
   - **Soma Automática (`+1`)**: Ao passar novamente por um código já lido, soma a quantidade automaticamente e atualiza o preço caso um novo valor seja detectado na etiqueta (com bipe sonoro de supermercado e vibração).
   - **Modos Configuráveis**: Alternância rápida entre *Somar quantidade (+1)*, *Ignorar códigos repetidos* ou *Criar nova linha*.

3. **Multi-Celulares Simultâneos & Unificação de Planilhas**:
   - **Sincronização em Tempo Real (WebSocket)**: Vários celulares podem entrar na mesma planilha via **QR Code** ou código curto (ex.: `MERC-101`).
   - **Fusão / Unificação de Diferentes Planilhas**: Caso cada celular trabalhe em uma planilha separada (ex.: *Corredor 1 - Mercearia*, *Corredor 2 - Bebidas*, ou upload de `.xlsx`/`.csv` externo), o painel **"Juntar Celulares"** consolida todos os itens pelo código de barras, somando as quantidades e resolvendo divergências de preço (*Mais recente*, *Maior preço*, *Menor preço* ou *Manter primeiro*).

4. **Exportação 100% Compatível com o Horus PDV**:
   - Gera arquivos `.xlsx` e `.csv` com as exatas 7 colunas esperadas pelo `ProductImportDrawer` do Horus PDV:
     `Codigo` | `Nome` | `Fornecedor` | `Descricao` | `Quantidade` | `PrecoCusto` | `PrecoVenda`

---

## Como Executar

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor backend (Express + WebSocket) e frontend (Vite) simultaneamente
npm run dev
```

- **Frontend (Vite Dev Server)**: `http://localhost:5175`
- **Backend API + WebSocket**: `http://localhost:4175`

### Build de Produção

```bash
npm run build
npm start
```

### Executar Testes Automatizados

```bash
npm test
```
