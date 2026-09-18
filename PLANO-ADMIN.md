# Plano de evolucao do painel administrativo - Teodora

## 1. Objetivo

Transformar o painel atual em uma central de operacao que controle o que aparece na loja, o ciclo dos pedidos e as configuracoes comerciais, sem depender de editar HTML, JavaScript ou variaveis no servidor para tarefas rotineiras.

O trabalho deve preservar a identidade visual elegante da loja, mas priorizar clareza, velocidade e seguranca para quem administra.

### Status da implementacao (17/09/2026)

Entregue nesta etapa: redesign responsivo do painel; editor completo de produtos e fotos; variantes com SKU/preco/estoque; categorias dinamicas na loja; configuracao de hero, contatos, redes, rodape e parcelamento; cupons validados no servidor; detalhe, historico e rastreio de pedidos; clientes; baixa/restauracao idempotente de estoque; movimentos de inventario; auditoria; endurecimento de autenticacao, CORS e upload; migracao SQLite/Supabase; CSS Tailwind compilado para producao; e teste automatizado do fluxo comercial principal.

Permanecem como evolucoes futuras, fora desta entrega: marcas e atributos totalmente administraveis, SEO/preview/agendamento, reserva temporaria de estoque, papeis administrativos granulares, exportacoes/backup, analytics por periodo e uma migracao operacional completa do SQLite para Postgres/Supabase.

## 2. Diagnostico do estado atual

### Arquitetura encontrada

- Loja em HTML + JavaScript, com grande parte do conteudo fixo em `index.html` e `js/data.js`.
- API em FastAPI, com SQLite como banco operacional.
- Existe schema para Supabase, mas a aplicacao ainda nao usa o Supabase como banco operacional; as variaveis Supabase servem principalmente para validacao de JWT/configuracao futura.
- Admin em HTML + CSS + JavaScript proprio, consumindo rotas `/api/admin/*`.
- Mercado Pago e CepCerto integrados pelo backend.

### O que o admin controla hoje

- Produtos: criar, editar, excluir, ativar/desativar, preco, estoque, dimensoes de frete e alguns atributos.
- Categorias: criar e excluir; a API permite editar, mas a interface nao oferece edicao.
- Pedidos: listar e alterar manualmente o status.
- Dashboard: quatro contadores e ultimos pedidos.
- Imagens: a API aceita upload, define capa e exclui; a interface deveria fazer isso, mas esta quebrada pelo ID incorreto do container da galeria.

### O que realmente alimenta a tela de produtos

| Area da loja | Dados consumidos | Situacao no admin |
|---|---|---|
| Card do catalogo | titulo, marca, imagem, preco, preco antigo, selo, avaliacao | Parcial; avaliacao e quantidade de reviews nao sao gerenciaveis |
| Filtros | categoria, familia, concentracao, ocasiao, sensacao | Produto tem os campos, mas opcoes e categorias da interface estao fixas em `js/data.js` |
| Pagina do produto | galeria, volume/variantes, descricao, piramide olfativa, ritual, ingredientes, similares | O backend possui quase todos os campos, mas o formulario nao expoe ritual, ingredientes, piramide ou similares; variante e sintetizada como uma unica opcao |
| Carrinho/frete | id, titulo, preco, peso e dimensoes | Editavel, mas sem validacao amigavel ou simulacao de frete no admin |
| Disponibilidade | ativo e estoque | O catalogo respeita `active`; o checkout nao bloqueia quantidade acima do estoque e nao baixa estoque apos pagamento |
| Categorias da home/menu/rodape | nome, imagem, ordem, ativo | Nao usam a API; estao duplicadas e fixas no HTML/JavaScript |
| Hero, beneficios, redes e textos institucionais | textos, imagens, links | Totalmente fixos em `index.html` |
| Cupom e condicoes comerciais | `TEODORA10`, parcelamento e mensagens | Fixos no frontend/backend, sem administracao |

### Problemas prioritarios encontrados

1. A galeria do produto usa um ID divergente (`image thr` em vez de `imageGallery`), fazendo a edicao/upload de fotos falhar em tempo de execucao.
2. Categorias cadastradas no admin nao atualizam menu, cards da home, rodape nem configuracao de filtros.
3. A API aceita campos importantes que o formulario descarta ao salvar. Editar um produto pode zerar ritual, ingredientes, piramide olfativa e produtos similares.
4. O estoque e apenas informativo: nao e validado contra a quantidade comprada nem movimentado quando o pagamento e aprovado.
5. Excluir produto/categoria e uma acao destrutiva imediata; nao ha arquivamento, lixeira, verificacao de vinculos ou confirmacao contextual.
6. Tabelas nao possuem busca, filtros, paginacao, selecao em massa, ordenacao ou estados de carregamento/erro.
7. O painel injeta valores da API diretamente em `innerHTML`, inclusive em atributos, criando risco de XSS e de quebra do formulario por caracteres especiais.
8. Upload valida apenas extensao; faltam limite de tamanho, validacao real do arquivo, otimizacao e texto alternativo.
9. Credenciais e segredo de desenvolvimento possuem valores padrao, o seed redefine a senha do admin a cada inicializacao e o CORS esta aberto para qualquer origem.
10. Status manual de pedido pode divergir do Mercado Pago; faltam historico, rastreio, reembolso, observacoes e detalhe do pedido.
11. O dashboard nao mostra faturamento, ticket medio, vendas por periodo, produtos com estoque baixo ou falhas de pagamento.
12. Nao ha trilha de auditoria, permissoes por funcao, recuperacao de senha nem gestao de outros administradores.
13. Nao existem testes automatizados; o servidor nem inicia em um ambiente sem instalar previamente todas as dependencias.

## 3. Experiencia proposta para o novo admin

### Navegacao principal

1. **Visao geral** - vendas, pedidos, ticket medio, conversao disponivel, estoque baixo e alertas.
2. **Catalogo**
   - Produtos
   - Categorias
   - Marcas
   - Atributos e filtros
   - Estoque
3. **Loja**
   - Home e banners
   - Menu e rodape
   - Beneficios e textos
   - SEO e redes sociais
4. **Vendas**
   - Pedidos
   - Cupons e promocoes
   - Frete
   - Pagamentos
5. **Clientes** - cadastro, enderecos, pedidos e observacoes, respeitando LGPD.
6. **Configuracoes** - dados da empresa, usuarios, permissoes, integracoes e auditoria.

### Padrao visual

- Sidebar recolhivel, cabecalho com busca global e area de alertas.
- Fundo neutro, cards brancos, tipografia da marca apenas em titulos e uma fonte de alta legibilidade no restante.
- Verde para sucesso, amarelo para atencao, vermelho somente para erro/acao destrutiva e dourado como destaque da marca.
- Tabelas responsivas com barra de ferramentas, filtros salvos e colunas configuraveis.
- Formularios divididos em secoes curtas, com barra de salvar fixa, validacao no campo, autosave de rascunho e aviso de alteracoes nao salvas.
- Skeleton de carregamento, estados vazios instrutivos, mensagens de sucesso/erro e opcao de tentar novamente.
- Acessibilidade: navegacao por teclado, foco visivel, labels reais, contraste AA e alvos de toque adequados.

### Tela de produtos

- Cabecalho com busca por nome/SKU, filtros por status, categoria, marca e estoque, alem de botao `Novo produto`.
- Cards de resumo: publicados, rascunhos, sem estoque e estoque baixo.
- Lista com foto, produto/SKU, categoria, variantes, preco, estoque, status, ultima alteracao e menu de acoes.
- Acoes em massa: publicar, pausar, alterar categoria, ajustar preco/estoque, exportar e arquivar.
- Duplicar produto para acelerar cadastros semelhantes.

### Editor de produto

- **Basico:** titulo, slug, SKU, marca, categoria, status e selo.
- **Venda:** variantes (volume/tamanho), preco, preco promocional, custo opcional, estoque e limite de estoque baixo.
- **Conteudo:** descricao, notas, familia, concentracao, ocasiao, sensacao, piramide, ritual e ingredientes.
- **Midia:** upload multiplo, arrastar para ordenar, escolher capa, recortar/otimizar e preencher texto alternativo.
- **Relacionados:** busca multisselecao de produtos similares.
- **Entrega:** peso e dimensoes, com simulador de frete.
- **SEO:** titulo, descricao, slug e preview do resultado de busca/compartilhamento.
- **Preview:** visualizar o card e a pagina do produto antes de publicar.
- Estados `rascunho`, `publicado` e `arquivado`; exclusao fisica apenas para usuario autorizado.

## 4. Modelo de dados necessario

### Ajustes nas tabelas atuais

- `products`: adicionar `slug`, `sku`, `status`, `seo_title`, `seo_description`, `low_stock_threshold`, `published_at`, `archived_at` e controle de versao/ultima edicao.
- `categories`: adicionar descricao, icone, imagem mobile/desktop, SEO e flags de exibicao no menu/home/rodape.
- `product_images`: adicionar `alt_text`, largura/altura, tamanho, tipo MIME e manter `sort_order` editavel.
- Remover a duplicacao conceitual perigosa entre `category_id` e `category_slug`; o relacionamento deve usar `category_id`, com slug resolvido pela categoria.

### Novas tabelas

- `product_variants`: SKU, nome/volume, preco, preco antigo, estoque, peso/dimensoes, ativo e ordem.
- `brands`: nome, slug, logo e status.
- `filter_definitions` e `filter_options` ou uma estrutura JSON validada por categoria, para a loja renderizar filtros dinamicos.
- `site_settings`: identidade, contatos, redes, pagamento, SEO e configuracoes gerais.
- `content_sections`: hero, banners, beneficios e blocos da home, com ordem, agendamento e status.
- `coupons`: codigo, tipo/valor, minimo, limite, periodo, categorias/produtos elegiveis e uso acumulado.
- `inventory_movements`: entrada, saida, reserva, cancelamento, ajuste, pedido e saldo resultante.
- `order_status_history`: status anterior/novo, origem (Mercado Pago/admin), usuario e data.
- `order_notes` e campos de rastreio.
- `admin_audit_log`: quem fez, entidade, antes/depois, IP e data.
- `admin_roles`/`permissions` se houver mais de um perfil administrativo.

## 5. API e integracao com a loja

### Contrato unico de catalogo

- Criar uma resposta versionada para produto e categoria; frontend e admin usam o mesmo contrato.
- A loja deve carregar `/api/catalog/categories`, `/api/catalog/filters` e `/api/storefront/config`, eliminando listas duplicadas no HTML e em `js/data.js`.
- Menu, cards de categoria, rodape e filtros passam a ser renderizados a partir dos dados ativos e ordenados do admin.
- A home deve consumir secoes publicadas em `/api/storefront/home`.
- Cache com invalidacao ao publicar alteracoes; preview usa endpoint autenticado sem cache.

### Endpoints administrativos

- Listagens com `q`, filtros, ordenacao, pagina e limite; nunca devolver o catalogo inteiro para editar um unico item.
- `GET /api/admin/products/{id}` para o editor.
- Operacoes de arquivar/publicar/duplicar e acoes em massa.
- Upload com tamanho/tipo real, processamento de imagem e metadados.
- Reordenacao de imagens, categorias e secoes.
- Dashboard com intervalo de datas.
- Detalhe completo do pedido e transicoes de status controladas.
- Endpoint de auditoria e saude das integracoes, sem expor segredos.

### Regras de negocio criticas

- Validar estoque no servidor, reservar durante pagamento e baixar de modo idempotente somente quando aprovado; devolver reserva ao cancelar/expirar.
- Nao permitir preco negativo, promocao maior/igual ao preco normal, estoque negativo ou dimensoes invalidas.
- Status financeiro deve vir do Mercado Pago. Status logistico deve ser separado (`aguardando envio`, `enviado`, `entregue`).
- Cupom e frete devem ser recalculados no servidor; nao confiar em valores enviados pelo navegador.
- Webhooks precisam de verificacao de autenticidade e processamento idempotente.

## 6. Plano de execucao

### Fase 0 - Estabilizacao e seguranca

1. Corrigir galeria de imagens e impedir perda de campos no formulario atual.
2. Centralizar tratamento de erros e feedback visual.
3. Escapar/sanitizar dados e substituir `innerHTML` inseguro onde houver conteudo dinamico.
4. Remover credenciais/segredos padrao em producao, parar de redefinir senha no startup e restringir CORS.
5. Validar uploads e corrigir autorizacao de acesso a pedido.
6. Criar testes de fumaca para login, CRUD de produto, upload, catalogo e pedido.

**Aceite:** o fluxo atual funciona sem erro de console, nenhum campo existente e perdido ao editar e as falhas criticas de seguranca estao fechadas.

### Fase 1 - Fonte unica de dados

1. Definir schemas versionados e migracoes.
2. Tornar categorias e filtros dinamicos na loja.
3. Remover categorias/conteudos duplicados do HTML/JavaScript.
4. Criar variantes reais e migrar o volume atual para uma variante inicial.
5. Implementar status de publicacao e arquivamento.

**Aceite:** criar/editar/desativar/reordenar uma categoria ou produto no admin altera corretamente todos os pontos correspondentes da loja, sem editar codigo.

### Fase 2 - Redesign do nucleo do admin

1. Construir layout, tokens visuais e componentes reutilizaveis.
2. Refazer listagem e editor de produtos.
3. Refazer categorias, marcas e atributos.
4. Adicionar preview, responsividade, acessibilidade e estados de interface.

**Aceite:** um operador consegue cadastrar produto completo, variantes e fotos, revisar no preview e publicar em um fluxo claro no desktop e celular.

### Fase 3 - Controle de conteudo da loja

1. Editor da home: hero, banners, cards de categoria e beneficios.
2. Menu, rodape, contatos e redes sociais.
3. SEO global e por pagina.
4. Publicacao agendada e preview.

**Aceite:** textos, imagens, links e ordem das secoes principais da loja sao administraveis sem deploy.

### Fase 4 - Operacao comercial

1. Detalhe e filtros de pedidos, historico e rastreio.
2. Separar pagamento de expedicao e sincronizar Mercado Pago.
3. Cupons e promocoes.
4. Inventario com movimentos, reservas e alertas.
5. Configuracoes de frete e simulador.

**Aceite:** o painel cobre o ciclo da venda do pagamento a entrega, com saldo de estoque auditavel e sem divergencia silenciosa.

### Fase 5 - Gestao, dados e qualidade

1. Dashboard por periodo, faturamento, ticket medio, status, produtos e estoque.
2. Clientes e historico de compras com controles LGPD.
3. Usuarios administrativos, permissoes e auditoria.
4. Exportacao CSV, backups e observabilidade.
5. Testes E2E, desempenho, seguranca e plano de rollback.

**Aceite:** principais indicadores sao confiaveis, toda alteracao sensivel e rastreavel e os fluxos criticos passam em testes automatizados antes do deploy.

## 7. Ordem recomendada de entrega

| Prioridade | Entrega | Motivo |
|---|---|---|
| P0 | Bugs, seguranca e preservacao de dados | Evita quebra do painel, perda de conteudo e risco operacional |
| P0 | Categoria/filtros dinamicos e contrato unico | Faz o admin realmente alimentar a loja |
| P1 | Nova tela de produtos e editor completo | Resolve o maior volume de trabalho diario |
| P1 | Variantes, midia e estoque real | Corrige lacunas diretas de venda e frete |
| P1 | Pedidos e sincronizacao de status | Reduz erros no pos-venda |
| P2 | CMS da home/menu/rodape | Entrega controle de conteudo sem deploy |
| P2 | Cupons, frete e configuracoes | Remove regras comerciais fixas no codigo |
| P3 | Analytics, clientes, papeis e auditoria avancada | Completa a maturidade operacional |

## 8. Estrategia tecnica recomendada

- Manter FastAPI e evoluir por migracoes, evitando uma reescrita total de uma vez.
- Decidir antes da implementacao qual sera o banco de producao. Se a escolha for Supabase/Postgres, migrar de verdade; nao manter dois schemas sem sincronizacao.
- Para o admin, adotar uma camada de componentes e estado organizada. Pode ser React/Vite para crescer com seguranca, ou JavaScript modular se o objetivo for menor mudanca; a decisao deve considerar quem dara manutencao.
- Manter a vitrine atual inicialmente, substituindo gradualmente blocos fixos por endpoints dinamicos.
- Usar feature flags e publicar por fatias: catalogo, conteudo e operacao comercial.

## 9. Validacao final

Antes de considerar o novo painel pronto, executar uma matriz de testes com:

- Desktop e celular; Chrome, Edge e Safari/WebKit.
- Produto simples e com varias variantes.
- Produto sem estoque, com estoque baixo, inativo, rascunho e arquivado.
- Imagens grandes, formato invalido, reordenacao e troca de capa.
- Categoria ativa/inativa, reordenada e com produtos vinculados.
- Pagamento aprovado, pendente, recusado, cancelado e webhook repetido.
- Cupom valido, expirado, sem saldo e restrito a produto/categoria.
- Falha de API, sessao expirada, integracao indisponivel e rede lenta.
- Tentativas de acesso sem permissao, XSS, upload malicioso e manipulacao de preco/frete/estoque.

## 10. Resultado esperado

Ao final, o admin deve ser a fonte de verdade da operacao: tudo que o cliente ve no catalogo e na pagina de produto, o conteudo principal da loja, precos, variantes, estoque, promocoes, pedidos e configuracoes comerciais devem ser controlados por interfaces claras, com preview, seguranca, historico e validacao.
