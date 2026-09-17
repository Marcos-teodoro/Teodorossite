// Estado da loja + filtros. Catálogo vem da API (/api/catalog/products).
const PRICE_FILTER_MAX = 800;

function makeProduct(p) {
  const image = p.image || p.cover_image || '';
  const gallery = p.gallery || [image, image, image, image].filter(Boolean);
  const variants = p.variants || [{ size: p.volume || "100ml", price: p.price, label: p.volume || "100ml" }];
  return {
    rating: 4.8,
    reviews: 48,
    oldPrice: null,
    badge: "",
    family: "floral",
    intensity: "edp",
    occasion: "dia",
    sensation: "romantico",
    notes: "Boa fixação e projeção",
    pyramid: {
      top: "Notas de saída",
      heart: "Notas de coração",
      base: "Notas de fundo"
    },
    description: `${p.title || ''}. Perfume original.`,
    ritual: "Borrife nos pulsos e na nuca.",
    ingredients: "Alcohol Denat, Parfum (Fragrance), Aqua.",
    similarIds: [],
    weightKg: 0.5,
    heightCm: 12,
    widthCm: 8,
    lengthCm: 8,
    ...p,
    image: image || p.image,
    oldPrice: p.oldPrice ?? p.old_price ?? null,
    brandTag: p.brandTag || p.brand_tag || "",
    category: p.category || p.category_slug || "perfumes",
    similarIds: p.similarIds || p.similar_ids || [],
    gallery,
    variants
  };
}

const APP_STATE = {
  activeProductId: null,
  selectedPdpVariantIdx: 0,
  pdpQuantity: 1,
  products: [],
  catalogLoaded: false,
  filters: {
    category: 'todos',
    maxPrice: PRICE_FILTER_MAX,
    badge: '',
    search: '',
    sortBy: 'populares',
    activeCategoryFilters: {}
  },
  cart: [],
  wishlist: [],
  shippingCost: 0,
  shippingOptionName: '',
  shippingOption: null,
  shippingInfo: null,
  couponCode: '',
  paymentMethod: 'pix',
  checkoutOrderId: null,
  mpBrickController: null
};

const CATEGORY_FILTER_CONFIGS = {
  todos: {
    eyebrow: "Catálogo",
    title: "Todos os produtos",
    groups: [
      {
        id: "universos",
        name: "Categorias",
        type: "shortcuts",
        options: [
          { value: "perfumes", label: "Perfumes", icon: "fa-solid fa-wine-bottle" },
          { value: "skincare", label: "Skincare", icon: "fa-solid fa-droplet" },
          { value: "maquiagem", label: "Maquiagem", icon: "fa-solid fa-wand-magic-sparkles" },
          { value: "cabelos", label: "Cabelos", icon: "fa-solid fa-feather-pointed" },
          { value: "corpo", label: "Corpo & Banho", icon: "fa-solid fa-spa" },
          { value: "kits", label: "Kits", icon: "fa-solid fa-gift" }
        ]
      },
      {
        id: "sensation",
        name: "Sensação",
        type: "checkbox",
        options: [
          { value: "romantico", label: "Romântico" },
          { value: "marcante", label: "Marcante" }
        ]
      },
      {
        id: "occasion",
        name: "Ocasião",
        type: "pills",
        options: [
          { value: "dia", label: "Dia a dia" },
          { value: "noite", label: "Noite" },
          { value: "festa", label: "Eventos" }
        ]
      }
    ]
  },
  perfumes: {
    eyebrow: "Perfumes",
    title: "Filtrar",
    groups: [
      {
        id: "family",
        name: "Família olfativa",
        type: "checkbox",
        options: [
          { value: "floral", label: "Floral" },
          { value: "amadeirado", label: "Amadeirado" },
          { value: "oriental", label: "Oriental" }
        ]
      },
      {
        id: "intensity",
        name: "Concentração",
        type: "checkbox",
        options: [
          { value: "edp", label: "Eau de Parfum" },
          { value: "edt", label: "Eau de Toilette" }
        ]
      },
      {
        id: "occasion",
        name: "Ocasião",
        type: "pills",
        options: [
          { value: "dia", label: "Dia a dia" },
          { value: "noite", label: "Noite" },
          { value: "festa", label: "Eventos" }
        ]
      }
    ]
  },
  kits: {
    eyebrow: "Kits",
    title: "Filtrar",
    groups: [
      {
        id: "giftPackaging",
        name: "Embalagem",
        type: "checkbox",
        options: [
          { value: "caixa-luxo", label: "Coffret / caixa" }
        ]
      },
      {
        id: "giftOccasion",
        name: "Ocasião",
        type: "pills",
        options: [
          { value: "amor", label: "Presente" }
        ]
      }
    ]
  },
  skincare: { eyebrow: "Skincare", title: "Filtrar", groups: [] },
  maquiagem: { eyebrow: "Maquiagem", title: "Filtrar", groups: [] },
  cabelos: { eyebrow: "Cabelos", title: "Filtrar", groups: [] },
  corpo: { eyebrow: "Corpo & Banho", title: "Filtrar", groups: [] }
};

async function loadCatalogFromApi() {
  const apiBase = (typeof window.TEODORA_API_BASE === 'string' ? window.TEODORA_API_BASE : 'http://127.0.0.1:3001').replace(/\/$/, '');
  const res = await fetch(`${apiBase}/api/catalog/products`);
  if (!res.ok) throw new Error('Falha ao carregar catálogo');
  const data = await res.json();
  APP_STATE.products = (data.products || []).map((p) => {
    const product = makeProduct(p);
    if (product.image && product.image.startsWith('/')) {
      product.image = `${apiBase}${product.image}`;
      product.gallery = (product.gallery || []).map((g) => (g && g.startsWith('/') ? `${apiBase}${g}` : g));
    }
    return product;
  });
  APP_STATE.catalogLoaded = true;
}
