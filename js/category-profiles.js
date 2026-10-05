/* Perfis por categoria: o que o admin pede e o que a página do produto mostra.
 *
 * Cada categoria tem suas peculiaridades (perfume tem pirâmide olfativa, skincare tem tipo de pele
 * e modo de uso, etc.). Os valores continuam nas mesmas colunas do banco:
 *   selects.family/intensity/occasion/sensation  -> products.family/intensity/occasion/sensation
 *   details.top/heart/base                       -> products.pyramid_top/heart/base
 *   ritual / ingredients                         -> products.ritual / products.ingredients
 * Categoria nova criada no admin (slug desconhecido) usa o perfil "generic".
 */
(function () {
  'use strict';

  const o = (value, label, title) => ({ value, label, title: title || '' });

  const PROFILES = {
    perfumes: {
      name: 'Perfumaria',
      cardTitle: 'Conteúdo & Perfumaria',
      cardHelp: 'Classificação olfativa e pirâmide de notas, exibidas na página do produto.',
      selects: {
        family: { label: 'Família Olfativa', options: [
          o('oriental', 'Oriental Gourmand'), o('floral', 'Floral'), o('cítrico', 'Cítrico Refrescante'),
          o('amadeirado', 'Amadeirado / Chypre'),
        ] },
        intensity: { label: 'Concentração', titleSuffix: true, options: [
          o('edp', 'Eau de Parfum (EDP)', 'Eau de Parfum'), o('edt', 'Eau de Toilette (EDT)', 'Eau de Toilette'),
          o('parfum', 'Parfum / Extrait', 'Parfum'),
        ] },
        occasion: { label: 'Ocasião Recomendada', options: [
          o('noite', 'Noite & Eventos'), o('dia', 'Uso Diário / Assinatura'), o('festa', 'Encontros & Festas'),
        ] },
        sensation: { label: 'Sensação / Acorde', options: [
          o('romantico', 'Romântico & Marcante'), o('marcante', 'Sensual & Magnético'),
          o('fresco', 'Energizante & Leve'), o('elegante', 'Clássico & Imponente'),
        ] },
      },
      details: {
        title: 'Pirâmide Olfativa (Notas Oficiais)',
        storeTitle: 'Notas olfativas',
        help: 'Preenche o card olfativo na loja',
        icon: 'fa-feather-pointed',
        items: {
          top: { label: 'Notas de Topo (Saída)', hint: '0 a 15 min', sub: 'Primeiros 15 minutos', placeholder: 'Ex: Pêra suculenta e bergamota' },
          heart: { label: 'Notas de Coração (Corpo)', hint: '15 min a 4h', sub: 'Corpo da fragrância', placeholder: 'Ex: Vetiver e flores brancas' },
          base: { label: 'Notas de Fundo (Base)', hint: 'Fixação 8h+', sub: 'Fixação na pele', placeholder: 'Ex: Baunilha de Madagascar e âmbar' },
        },
      },
      description: { placeholder: 'Conte a história e o perfil da fragrância.' },
      ritual: { label: 'Ritual de Uso', tab: 'Descrição', placeholder: 'Ex: Borrife a 15 cm da pele, em pulsos, pescoço e dobras dos cotovelos.' },
      ingredients: { label: 'Ingredientes / Composição', placeholder: 'Ex: Alcohol Denat., Parfum (Fragrance), Aqua...' },
      similarHelp: 'Automatizado com base na marca e na família olfativa cadastrada.',
    },

    skincare: {
      name: 'Skincare',
      cardTitle: 'Conteúdo & Skincare',
      cardHelp: 'Tipo de produto, pele indicada, benefícios e modo de uso.',
      selects: {
        family: { label: 'Tipo de Produto', options: [
          o('limpeza', 'Limpeza / Sabonete facial'), o('hidratante', 'Hidratante'), o('serum', 'Sérum / Ampola'),
          o('protetor', 'Protetor solar'), o('esfoliante', 'Esfoliante / Tônico'), o('mascara', 'Máscara facial'),
          o('olhos', 'Área dos olhos'), o('labios', 'Lábios'),
        ] },
        intensity: { label: 'Tipo de Pele', options: [
          o('todas', 'Todos os tipos'), o('oleosa', 'Oleosa / Acneica'), o('seca', 'Seca'),
          o('mista', 'Mista'), o('sensivel', 'Sensível'), o('madura', 'Madura'),
        ] },
        occasion: { label: 'Momento de Uso', options: [
          o('dia', 'Manhã'), o('noite', 'Noite'), o('ambos', 'Manhã e noite'),
        ] },
        sensation: { label: 'Foco Principal', options: [
          o('hidratacao', 'Hidratação'), o('antioxidante', 'Antioxidante / Vitamina C'), o('manchas', 'Manchas / Uniformizar'),
          o('antiidade', 'Anti-idade'), o('oleosidade', 'Controle de oleosidade / Acne'), o('poros', 'Poros / Textura'),
        ] },
      },
      details: {
        title: 'Benefícios & Ativos',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-droplet',
        items: {
          top: { label: 'Benefícios', hint: 'Resultado', sub: 'O que o produto entrega', placeholder: 'Ex: Hidrata por 24h, ilumina e suaviza linhas finas' },
          heart: { label: 'Ativos Principais', hint: 'Ativos', sub: 'Ingredientes de destaque', placeholder: 'Ex: Ácido hialurônico, niacinamida, vitamina C' },
          base: { label: 'Textura & Sensorial', hint: 'Toque', sub: 'Como é na pele', placeholder: 'Ex: Gel-creme leve, absorção rápida, sem pegajosidade' },
        },
      },
      description: { placeholder: 'Descreva o produto, a marca e para quem ele é indicado.' },
      ritual: { label: 'Modo de Uso', tab: 'Como usar', placeholder: 'Ex: Aplique no rosto limpo e seco, 2 vezes ao dia. Use protetor solar durante o dia.' },
      ingredients: { label: 'Ingredientes (INCI)', placeholder: 'Lista de ingredientes conforme a embalagem / Anvisa...' },
      similarHelp: 'Automatizado com base na marca e no tipo de produto cadastrado.',
    },

    maquiagem: {
      name: 'Maquiagem',
      cardTitle: 'Conteúdo & Maquiagem',
      cardHelp: 'Tipo, acabamento, cobertura, cor e modo de aplicação.',
      selects: {
        family: { label: 'Tipo de Produto', options: [
          o('base', 'Base / BB / Corretivo'), o('po', 'Pó / Iluminador / Blush'), o('batom', 'Batom / Gloss'),
          o('olhos', 'Sombra / Delineador'), o('cilios', 'Máscara de cílios'), o('sobrancelha', 'Sobrancelha'),
          o('fixador', 'Primer / Fixador'), o('acessorio', 'Pincéis & Acessórios'),
        ] },
        intensity: { label: 'Acabamento', options: [
          o('matte', 'Matte'), o('acetinado', 'Acetinado'), o('glow', 'Glow / Iluminado'), o('cremoso', 'Cremoso'),
        ] },
        occasion: { label: 'Uso Recomendado', options: [
          o('dia', 'Dia a dia'), o('noite', 'Noite'), o('festa', 'Eventos & Festas'),
        ] },
        sensation: { label: 'Cobertura', options: [
          o('leve', 'Leve'), o('media', 'Média'), o('alta', 'Alta / Total'),
        ] },
      },
      details: {
        title: 'Cor, Benefícios & Duração',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-wand-magic-sparkles',
        items: {
          top: { label: 'Cor / Tom', hint: 'Cor', sub: 'Tom disponível', placeholder: 'Ex: Nude rosado (tom 120)' },
          heart: { label: 'Benefícios', hint: 'Benefícios', sub: 'Diferenciais', placeholder: 'Ex: Hidrata os lábios, não resseca, cor intensa' },
          base: { label: 'Duração & Fixação', hint: 'Duração', sub: 'Quanto tempo dura', placeholder: 'Ex: Até 8h, resistente à água' },
        },
      },
      description: { placeholder: 'Descreva o produto, o efeito e para quem é indicado.' },
      ritual: { label: 'Modo de Aplicação', tab: 'Como aplicar', placeholder: 'Ex: Aplique com pincel ou esponja do centro do rosto para fora, em camadas finas.' },
      ingredients: { label: 'Ingredientes', placeholder: 'Lista de ingredientes conforme a embalagem / Anvisa...' },
      similarHelp: 'Automatizado com base na marca e no tipo de produto cadastrado.',
    },

    cabelos: {
      name: 'Cabelos',
      cardTitle: 'Conteúdo & Cabelos',
      cardHelp: 'Tipo de produto, cabelo indicado, objetivo e modo de uso.',
      selects: {
        family: { label: 'Tipo de Produto', options: [
          o('shampoo', 'Shampoo'), o('condicionador', 'Condicionador'), o('mascara', 'Máscara / Tratamento'),
          o('leavein', 'Leave-in / Creme de pentear'), o('oleo', 'Óleo / Sérum capilar'), o('finalizador', 'Finalizador / Spray'),
          o('coloracao', 'Coloração / Tonalizante'),
        ] },
        intensity: { label: 'Tipo de Cabelo', options: [
          o('todos', 'Todos os tipos'), o('liso', 'Liso'), o('ondulado', 'Ondulado'), o('cacheado', 'Cacheado'),
          o('crespo', 'Crespo'), o('quimica', 'Com química / Danificado'),
        ] },
        occasion: { label: 'Frequência', options: [
          o('dia', 'Uso diário'), o('semanal', 'Semanal'), o('ocasional', 'Ocasional / Tratamento'),
        ] },
        sensation: { label: 'Objetivo', options: [
          o('hidratacao', 'Hidratação'), o('nutricao', 'Nutrição'), o('reconstrucao', 'Reconstrução'),
          o('brilho', 'Brilho'), o('antifrizz', 'Anti-frizz / Definição'), o('volume', 'Volume / Crescimento'),
        ] },
      },
      details: {
        title: 'Benefícios & Ativos',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-feather-pointed',
        items: {
          top: { label: 'Benefícios', hint: 'Resultado', sub: 'O que o produto entrega', placeholder: 'Ex: Reduz o frizz, devolve o brilho e a maciez' },
          heart: { label: 'Ativos Principais', hint: 'Ativos', sub: 'Ingredientes de destaque', placeholder: 'Ex: Óleo de argan, queratina, pantenol' },
          base: { label: 'Resultado Esperado', hint: 'Duração', sub: 'Quanto tempo dura', placeholder: 'Ex: Efeito de até 3 lavagens' },
        },
      },
      description: { placeholder: 'Descreva o produto, a linha e para quem é indicado.' },
      ritual: { label: 'Modo de Uso', tab: 'Como usar', placeholder: 'Ex: Aplique nos fios úmidos, deixe agir por 5 minutos e enxágue.' },
      ingredients: { label: 'Ingredientes', placeholder: 'Lista de ingredientes conforme a embalagem / Anvisa...' },
      similarHelp: 'Automatizado com base na marca e no tipo de produto cadastrado.',
    },

    corpo: {
      name: 'Corpo & Banho',
      cardTitle: 'Conteúdo & Corpo e Banho',
      cardHelp: 'Tipo de produto, pele, aroma/textura e modo de uso.',
      selects: {
        family: { label: 'Tipo de Produto', options: [
          o('hidratante', 'Hidratante corporal'), o('oleo', 'Óleo / Manteiga'), o('esfoliante', 'Esfoliante'),
          o('sabonete', 'Sabonete / Gel de banho'), o('bodysplash', 'Body splash / Colônia'), o('desodorante', 'Desodorante'),
          o('maos', 'Mãos & Pés'),
        ] },
        intensity: { label: 'Tipo de Pele', options: [
          o('todas', 'Todos os tipos'), o('seca', 'Seca'), o('sensivel', 'Sensível'), o('normal', 'Normal a mista'),
        ] },
        occasion: { label: 'Momento de Uso', options: [
          o('dia', 'Dia a dia'), o('banho', 'Banho'), o('noite', 'Noite / Relaxar'),
        ] },
        sensation: { label: 'Sensação', options: [
          o('hidratacao', 'Hidratação profunda'), o('fresco', 'Frescor'), o('relaxante', 'Relaxante'), o('perfumado', 'Perfumação marcante'),
        ] },
      },
      details: {
        title: 'Benefícios, Aroma & Textura',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-spa',
        items: {
          top: { label: 'Benefícios', hint: 'Resultado', sub: 'O que o produto entrega', placeholder: 'Ex: Hidratação por 48h e pele macia' },
          heart: { label: 'Aroma', hint: 'Aroma', sub: 'Perfil de cheiro', placeholder: 'Ex: Baunilha, coco e flor de laranjeira' },
          base: { label: 'Textura & Sensorial', hint: 'Toque', sub: 'Como é na pele', placeholder: 'Ex: Creme leve de rápida absorção' },
        },
      },
      description: { placeholder: 'Descreva o produto e para quem é indicado.' },
      ritual: { label: 'Modo de Uso', tab: 'Como usar', placeholder: 'Ex: Aplique após o banho com a pele ainda levemente úmida.' },
      ingredients: { label: 'Ingredientes', placeholder: 'Lista de ingredientes conforme a embalagem / Anvisa...' },
      similarHelp: 'Automatizado com base na marca e no tipo de produto cadastrado.',
    },

    kits: {
      name: 'Kits & Presentes',
      cardTitle: 'Conteúdo & Kits',
      cardHelp: 'O que vem no kit, para quem é e em que ocasião presentear.',
      selects: {
        family: { label: 'Tipo de Kit', options: [
          o('perfumaria', 'Perfumaria'), o('skincare', 'Skincare'), o('maquiagem', 'Maquiagem'), o('cabelos', 'Cabelos'),
          o('corpo', 'Corpo & Banho'), o('misto', 'Misto'),
        ] },
        intensity: { label: 'Para Quem', options: [
          o('feminino', 'Feminino'), o('masculino', 'Masculino'), o('unissex', 'Unissex'),
        ] },
        occasion: { label: 'Ocasião', options: [
          o('presente', 'Presente em geral'), o('aniversario', 'Aniversário'), o('maes', 'Dia das Mães'),
          o('namorados', 'Dia dos Namorados'), o('natal', 'Natal'), o('dia', 'Uso próprio'),
        ] },
        sensation: { label: 'Estilo', options: [
          o('romantico', 'Romântico'), o('elegante', 'Sofisticado'), o('pratico', 'Prático / Viagem'),
        ] },
      },
      details: {
        title: 'Composição do Kit',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-gift',
        items: {
          top: { label: 'Itens do Kit', hint: 'Itens', sub: 'O que vem na caixa', placeholder: 'Ex: Perfume 100ml + hidratante 200ml + necessaire' },
          heart: { label: 'Ideal Para', hint: 'Indicação', sub: 'Quem vai gostar', placeholder: 'Ex: Quem ama fragrâncias doces e quer um presente completo' },
          base: { label: 'Diferencial', hint: 'Extra', sub: 'Por que escolher', placeholder: 'Ex: Embalagem presenteável com cartão' },
        },
      },
      description: { placeholder: 'Descreva o kit e o que o torna um bom presente.' },
      ritual: { label: 'Como Usar / Observações', tab: 'Como usar', placeholder: 'Ex: Siga o modo de uso de cada item. Embalagem pronta para presente.' },
      ingredients: { label: 'Composição dos Itens', placeholder: 'Ingredientes de cada item, se aplicável...' },
      similarHelp: 'Automatizado com base na marca e no tipo de kit cadastrado.',
    },

    generic: {
      name: 'Produto',
      cardTitle: 'Conteúdo do Produto',
      cardHelp: 'Destaques, modo de uso e composição exibidos na página do produto.',
      selects: {},
      details: {
        title: 'Destaques do Produto',
        help: 'Aparece como destaques na página do produto',
        icon: 'fa-star',
        items: {
          top: { label: 'Destaque 1', hint: '', sub: '', placeholder: 'Ex: Principal benefício' },
          heart: { label: 'Destaque 2', hint: '', sub: '', placeholder: 'Ex: Diferencial do produto' },
          base: { label: 'Destaque 3', hint: '', sub: '', placeholder: 'Ex: Informação extra' },
        },
      },
      description: { placeholder: 'Descreva o produto.' },
      ritual: { label: 'Modo de Uso', tab: 'Como usar', placeholder: 'Como usar o produto...' },
      ingredients: { label: 'Ingredientes / Composição', placeholder: 'Composição do produto...' },
      similarHelp: 'Automatizado com base na marca e na categoria cadastrada.',
    },
  };

  function slugOf(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getProfile(slug) {
    return PROFILES[slugOf(slug)] || PROFILES.generic;
  }

  function hasContent(product) {
    const p = product && product.pyramid;
    return !!(p && (p.top || p.heart || p.base));
  }

  window.TeodoraCategoryProfiles = { PROFILES, getProfile, hasContent };
})();
