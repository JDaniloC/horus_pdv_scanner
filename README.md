# Horus PDV Scanner — Coletor Mobile ao Vivo & Unificador de Planilhas

Sistema web mobile-first criado para operar com a **câmera do celular sempre aberta**, capturando através de screenshots/frames ao vivo o **código de barras (EAN/GTIN/UPC)**, buscando automaticamente os **dados do produto em catálogos públicos** (Open Food/Beauty/Products/PetFood Facts, Cosmos Bluesoft e catálogo de mercadinho brasileiro) e extraindo o **preço de venda (R$ XX,XX)** diretamente da etiqueta da gôndola via **OCR local (Tesseract.js)**.

Todas as capturas alimentam em tempo real planilhas colaborativas sincronizadas via **WebSocket**, permitindo que **diversos celulares escaneiem produtos ao mesmo tempo** (na mesma planilha ou em planilhas separadas por corredor/operador) e **juntem tudo em uma planilha única `.xlsx` ou `.csv`** no formato oficial de importação do **[Horus PDV](https://github.com/JDaniloC/horus_pdv)**.

---

## Principais Funcionalidades

1. **Câmera Sempre Aberta com Análise de Screenshots ao Vivo (Dual-Zone HUD)**:
   - **Zona 1 — Código de Barras**: Leitura contínua (~5 frames/seg) de `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E`, `Code 128`, `Code 39`, `ITF` e etiquetas de balança (`EAN-13` prefixo `2`).
   - **Zona 2 — OCR de Preço da Etiqueta**: Recorte inteligente de alto contraste da etiqueta de gôndola para identificar preços em Reais (`R$ XX,XX`, `POR XX,XX`, `OFERTA XX,XX`) sem custos de API externa.
   - **Enriquecimento Automático via Código de Barras**: Ao detectar o EAN, busca automaticamente `Nome do Produto`, `Marca`, `Categoria`, `Descrição` e `Imagem` em bases públicas e estima o `PrecoCusto` caso apenas o `PrecoVenda` esteja na gôndola.

2. **Preenchimento Rápido, Calculadora de Fardo e Categoria na Hora**:
   - **Quantidade & Preço Unitário no Leitor**: Logo abaixo da câmera ficam os campos diretos de `Quantidade` (com botões `-`/`+` e atalhos `1x`, `6x`, `12x`, `24x`), `Custo Unitário` e `Preço Unitário de Venda`.
   - **Calculadora de Fardo / Caixa**: Informe o **preço pago no fardo** e a **quantidade que vem no fardo** para deduzir automaticamente o `PrecoCusto` unitário e sugerir o `PrecoVenda` com base na margem desejada (`+25%`, `+30%`, `+40%`, `+50%` ou personalizada).
   - **Categoria na Hora**: Selecione ou crie uma nova categoria diretamente no painel do leitor (ou ao editar um item), sincronizada em tempo real com todos os celulares conectados.
   - **Data de Vencimento (Nulo, +30 dias ou Data Específica)**: Defina com 1 toque se o item não possui vencimento (`Nulo`), se vence em `+30 dias`, ou informe uma data exata.

3. **Contabilização Inteligente**:
   - **Soma Automática**: Ao passar novamente por um código já lido, soma a quantidade informada e atualiza o preço caso um novo valor seja detectado na etiqueta (com bipe sonoro de supermercado e vibração).
   - **Modos Configuráveis**: Alternância rápida entre *Somar quantidade*, *Ignorar códigos repetidos* ou *Criar nova linha*.

4. **Multi-Celulares Simultâneos & Unificação de Planilhas**:
   - **Sincronização em Tempo Real (WebSocket)**: Vários celulares podem entrar na mesma planilha via **QR Code** ou código curto (ex.: `MERC-101`).
   - **Fusão / Unificação de Diferentes Planilhas**: Caso cada celular trabalhe em uma planilha separada (ex.: *Corredor 1 - Mercearia*, *Corredor 2 - Bebidas*, ou upload de `.xlsx`/`.csv` externo), o painel **"Juntar Celulares"** consolida todos os itens pelo código de barras, somando as quantidades e resolvendo divergências de preço (*Mais recente*, *Maior preço*, *Menor preço* ou *Manter primeiro*).

5. **Exportação 100% Compatível com o Horus PDV**:
   - Gera arquivos `.xlsx` e `.csv` com as colunas esperadas pelo `ProductImportDrawer` do Horus PDV:
     `Codigo` | `Nome` | `Fornecedor` | `Descricao` | `Quantidade` | `PrecoCusto` | `PrecoVenda` | `Categoria` | `Vencimento`

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
