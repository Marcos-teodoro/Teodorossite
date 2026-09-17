// Lógica da loja: catálogo, PDP, sacola, wishlist, frete e checkout
function formatBRL(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function teodoraApiBase() {
  return (typeof window.TEODORA_API_BASE === 'string' ? window.TEODORA_API_BASE : 'http://localhost:3001').replace(/\/$/, '');
}

function getFilteredProducts() {
  let result = [...APP_STATE.products];

  // Filtro por Categoria principal
  if (APP_STATE.filters.category !== 'todos') {
    result = result.filter(p => p.category === APP_STATE.filters.category);
  }

  // Filtro por Preço Máximo
  result = result.filter(p => p.price <= APP_STATE.filters.maxPrice);

  // Filtro por Curadoria Especial (Badge)
  if (APP_STATE.filters.badge) {
    result = result.filter(p => p.badge === APP_STATE.filters.badge);
  }

  // Filtros Dinâmicos específicos do Menu ativo
  for (const [groupId, selectedVals] of Object.entries(APP_STATE.filters.activeCategoryFilters)) {
    if (selectedVals && selectedVals.length > 0) {
      result = result.filter(p => {
        const prodVal = p[groupId];
        if (Array.isArray(prodVal)) {
          return selectedVals.some(v => prodVal.includes(v));
        }
        return selectedVals.includes(prodVal);
      });
    }
  }

  // Busca textual
  if (APP_STATE.filters.search) {
    const q = APP_STATE.filters.search.toLowerCase();
    result = result.filter(p => 
      p.title.toLowerCase().includes(q) || 
      p.notes.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }

  // Ordenação
  switch (APP_STATE.filters.sortBy) {
    case 'preco-crescente':
      result.sort((a, b) => a.price - b.price);
      break;
    case 'preco-decrescente':
      result.sort((a, b) => b.price - a.price);
      break;
    case 'avaliacao':
      result.sort((a, b) => b.rating - a.rating);
      break;
    default:
      result.sort((a, b) => b.reviews - a.reviews);
      break;
  }

  return result;
}

function renderDynamicFilters() {
  const activeCat = APP_STATE.filters.category;
  const config = CATEGORY_FILTER_CONFIGS[activeCat] || CATEGORY_FILTER_CONFIGS['todos'];

  const sideEyebrow = document.getElementById('sidebarCategoryEyebrow');
  if (sideEyebrow) sideEyebrow.innerText = config.eyebrow.replace(/[✦★☆]/g, '').trim();

  const sideTitle = document.getElementById('sidebarCategoryTitle');
  if (sideTitle) sideTitle.innerText = config.title;

  const mobEyebrow = document.getElementById('mobileCategoryEyebrow');
  if (mobEyebrow) mobEyebrow.innerText = config.eyebrow.replace(/[✦★☆]/g, '').trim();

  const mobTitle = document.getElementById('mobileCategoryTitle');
  if (mobTitle) mobTitle.innerText = config.title;

  const desktopContainer = document.getElementById('dynamicSidebarFilterGroups');
  if (desktopContainer) {
    desktopContainer.innerHTML = config.groups.map(group => renderFilterGroupHTML(group, false)).join('');
  }

  const mobileContainer = document.getElementById('dynamicMobileFilterGroups');
  if (mobileContainer) {
    mobileContainer.innerHTML = config.groups.map(group => renderFilterGroupHTML(group, true)).join('');
  }
}

function renderFilterGroupHTML(group, isMobile) {
  const activeVals = APP_STATE.filters.activeCategoryFilters[group.id] || [];

  if (group.type === 'shortcuts') {
    return `
      <div class="space-y-3">
        <h4 class="text-[11px] uppercase tracking-[0.14em] text-teodora-textMuted">${group.name}</h4>
        <div class="flex flex-col gap-1 text-sm">
          <button onclick="setCategoryFilter('todos')" class="text-left px-3 py-2 rounded-md transition ${APP_STATE.filters.category === 'todos' ? 'filter-active text-teodora-text font-medium' : 'text-teodora-textMuted hover:text-teodora-text'}">
            Todos os produtos
          </button>
          ${group.options.map(opt => `
            <button onclick="setCategoryFilter('${opt.value}')" class="text-left px-3 py-2 rounded-md transition ${APP_STATE.filters.category === opt.value ? 'filter-active text-teodora-text font-medium' : 'text-teodora-textMuted hover:text-teodora-text'}">
              ${opt.label}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (group.type === 'pills') {
    return `
      <div class="space-y-3 pt-6 border-t border-teodora-border">
        <h4 class="text-[11px] uppercase tracking-[0.14em] text-teodora-textMuted">${group.name}</h4>
        <div class="flex flex-col gap-2 text-sm">
          ${group.options.map(opt => {
            const isSelected = activeVals.includes(opt.value);
            return `
              <button onclick="toggleDynamicFilter('${group.id}', '${opt.value}')" class="text-left transition ${isSelected ? 'text-teodora-text font-medium' : 'text-teodora-textMuted hover:text-teodora-text'}">
                ${isSelected ? '— ' : ''}${opt.label}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="space-y-3 pt-6 border-t border-teodora-border">
      <h4 class="text-[11px] uppercase tracking-[0.14em] text-teodora-textMuted">${group.name}</h4>
      <div class="space-y-2.5 text-sm">
        ${group.options.map(opt => {
          const isChecked = activeVals.includes(opt.value);
          return `
            <label class="flex items-center gap-2.5 cursor-pointer text-teodora-textMuted hover:text-teodora-text transition">
              <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleDynamicFilter('${group.id}', '${opt.value}')" class="accent-teodora-gold w-3.5 h-3.5">
              <span>${opt.label}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function toggleDynamicFilter(groupId, value) {
  if (!APP_STATE.filters.activeCategoryFilters[groupId]) {
    APP_STATE.filters.activeCategoryFilters[groupId] = [];
  }

  const list = APP_STATE.filters.activeCategoryFilters[groupId];
  const idx = list.indexOf(value);

  if (idx > -1) {
    list.splice(idx, 1);
    if (list.length === 0) {
      delete APP_STATE.filters.activeCategoryFilters[groupId];
    }
  } else {
    list.push(value);
  }

  renderDynamicFilters();
  renderProducts();
}

function setCategoryFilter(category) {
  APP_STATE.filters.category = category;
  // Reseta os sub-filtros específicos ao alternar de universo
  APP_STATE.filters.activeCategoryFilters = {};

  if (APP_STATE.activeProductId) {
    closeProductPage();
  }

  updateNavigationUI(category);
  renderDynamicFilters();
  renderProducts();

  const catalogEl = document.getElementById('catalogo');
  if (catalogEl) {
    catalogEl.scrollIntoView({ behavior: 'smooth' });
  }
}

function updateNavigationUI(activeCategory) {
  document.querySelectorAll('.nav-cat-btn').forEach(btn => {
    const cat = btn.getAttribute('data-nav-cat');
    if (cat === activeCategory) {
      btn.classList.add('text-teodora-text', 'border-teodora-text');
      btn.classList.remove('border-transparent', 'text-teodora-textMuted');
    } else {
      btn.classList.remove('text-teodora-gold', 'border-teodora-gold', 'border-teodora-text', 'font-bold');
      btn.classList.add('border-transparent');
    }
  });

  document.querySelectorAll('.cat-circle-card').forEach(card => {
    const cat = card.getAttribute('data-circle-cat');
    const label = card.querySelector('span');
    if (cat === activeCategory) {
      if (label) label.classList.add('font-semibold', 'text-teodora-gold');
    } else {
      if (label) label.classList.remove('font-semibold', 'text-teodora-gold', 'border-b', 'border-teodora-text');
    }
  });

  document.querySelectorAll('.mobile-cat-pill').forEach(btn => {
    const cat = btn.getAttribute('data-mobile-cat');
    if (cat === activeCategory) {
      btn.classList.add('border-teodora-gold', 'bg-teodora-roseLight/70', 'font-bold');
    } else {
      btn.classList.remove('border-teodora-gold', 'bg-teodora-roseLight/70', 'font-bold');
    }
  });
}

function resetCategoryFilters() {
  APP_STATE.filters.activeCategoryFilters = {};
  renderDynamicFilters();
  renderProducts();
}

function renderActiveFilterTags() {
  const container = document.getElementById('activeFilterTags');
  if (!container) return;

  let tags = [];

  // Tag da categoria selecionada
  if (APP_STATE.filters.category !== 'todos') {
    tags.push({
      label: APP_STATE.filters.category,
      clear: () => setCategoryFilter('todos')
    });
  }

  // Tags de sub-filtros dinâmicos ativos
  const activeCat = APP_STATE.filters.category;
  const config = CATEGORY_FILTER_CONFIGS[activeCat] || CATEGORY_FILTER_CONFIGS['todos'];

  for (const [groupId, vals] of Object.entries(APP_STATE.filters.activeCategoryFilters)) {
    const groupDef = config.groups.find(g => g.id === groupId);
    if (groupDef && vals) {
      vals.forEach(val => {
        const optDef = groupDef.options.find(o => o.value === val);
        const label = optDef ? optDef.label : val;
        tags.push({
          label: `${groupDef.name}: ${label}`,
          clear: () => toggleDynamicFilter(groupId, val)
        });
      });
    }
  }

  // Preço Máximo
  if (APP_STATE.filters.maxPrice < PRICE_FILTER_MAX) {
    tags.push({
      label: `Até ${formatBRL(APP_STATE.filters.maxPrice)}`,
      clear: () => handlePriceRangeChange(PRICE_FILTER_MAX)
    });
  }

  // Curadoria / Badge
  if (APP_STATE.filters.badge) {
    tags.push({
      label: `Destaque: ${APP_STATE.filters.badge}`,
      clear: () => setSpecialFilter('')
    });
  }

  // Busca
  if (APP_STATE.filters.search) {
    tags.push({
      label: `Busca: "${APP_STATE.filters.search}"`,
      clear: () => {
        APP_STATE.filters.search = '';
        const input = document.getElementById('headerDesktopSearch');
        if (input) input.value = '';
        renderProducts();
      }
    });
  }

  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = tags.map((t, idx) => `
    <button onclick="tagClearActions[${idx}]()" class="inline-flex items-center gap-1.5 text-xs text-teodora-textMuted hover:text-teodora-text border-b border-teodora-border pb-0.5 transition">
      ${t.label} <span aria-hidden="true">×</span>
    </button>
  `).join('');

  window.tagClearActions = tags.map(t => t.clear);
}

function resetAllFilters() {
  APP_STATE.filters.category = 'todos';
  APP_STATE.filters.maxPrice = PRICE_FILTER_MAX;
  APP_STATE.filters.badge = '';
  APP_STATE.filters.search = '';
  APP_STATE.filters.sortBy = 'populares';
  APP_STATE.filters.activeCategoryFilters = {};

  const dSearch = document.getElementById('headerDesktopSearch');
  if (dSearch) dSearch.value = '';

  const priceSlider = document.getElementById('priceRangeInput');
  if (priceSlider) priceSlider.value = PRICE_FILTER_MAX;

  const priceLabel = document.getElementById('priceDisplayLabel');
  if (priceLabel) priceLabel.innerText = formatBRL(PRICE_FILTER_MAX);

  const badgeDefault = document.querySelector('input[name="badgeFilter"][value=""]');
  if (badgeDefault) badgeDefault.checked = true;

  updateNavigationUI('todos');
  renderDynamicFilters();
  renderProducts();
}

function handlePriceRangeChange(val) {
  const num = Number(val);
  APP_STATE.filters.maxPrice = num;
  const formatted = formatBRL(num);
  
  const desktopLabel = document.getElementById('priceDisplayLabel');
  if (desktopLabel) desktopLabel.innerText = formatted;
  
  const mobileLabel = document.getElementById('mobilePriceLabel');
  if (mobileLabel) mobileLabel.innerText = formatted;
  
  const rangeInput = document.getElementById('priceRangeInput');
  if (rangeInput && rangeInput.value !== val) rangeInput.value = val;
  
  renderProducts();
}

function toggleFamilyFilter(family, checked) {
  if (checked) {
    if (!APP_STATE.filters.families.includes(family)) {
      APP_STATE.filters.families.push(family);
    }
  } else {
    APP_STATE.filters.families = APP_STATE.filters.families.filter(f => f !== family);
  }
  renderProducts();
}

function setSpecialFilter(badge) {
  APP_STATE.filters.badge = badge;
  if (APP_STATE.activeProductId) {
    closeProductPage();
  }
  const radios = document.querySelectorAll('input[name="badgeFilter"]');
  radios.forEach(r => {
    r.checked = (r.value === badge);
  });
  renderProducts();
}

function applySorting(val) {
  APP_STATE.filters.sortBy = val;
  renderProducts();
}

function handleQuickSearch(val) {
  APP_STATE.filters.search = val.trim();
  renderProducts();
}

function setHomeLandingVisible(visible) {
  ['homeHero', 'homeCategories', 'homeBenefits'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  });
}

function openProductPage(productId) {
  const product = APP_STATE.products.find(p => p.id === productId);
  if (!product) return;

  APP_STATE.activeProductId = productId;
  APP_STATE.selectedPdpVariantIdx = 0;
  APP_STATE.pdpQuantity = 1;

  // Oculta home + catálogo e exibe só a página do produto
  setHomeLandingVisible(false);
  const mainFlow = document.getElementById('catalogMainFlow');
  if (mainFlow) mainFlow.classList.add('hidden');

  const pdp = document.getElementById('productPageView');
  if (pdp) pdp.classList.remove('hidden');

  // Preenche Breadcrumbs & Cabeçalho com verificações defensivas
  const breadCat = document.getElementById('pdpBreadcrumbCategory');
  if (breadCat) breadCat.innerText = product.category;
  const breadTitle = document.getElementById('pdpBreadcrumbTitle');
  if (breadTitle) breadTitle.innerText = product.title;
  const brandTag = document.getElementById('pdpBrandTag');
  if (brandTag) brandTag.innerText = product.brandTag;
  const pdpTitle = document.getElementById('pdpTitle');
  if (pdpTitle) pdpTitle.innerText = product.title;
  const badgeTag = document.getElementById('pdpBadgeTag');
  if (badgeTag) badgeTag.innerText = product.badge || 'Destaque';
  const ratingEl = document.getElementById('pdpRating');
  if (ratingEl) ratingEl.innerText = product.rating.toFixed(1);
  const reviewsCount = document.getElementById('pdpReviewsCount');
  if (reviewsCount) reviewsCount.innerText = `${product.reviews} avaliações`;

  // Imagem principal e galeria
  const mainImg = document.getElementById('pdpMainImage');
  if (mainImg) mainImg.src = product.gallery && product.gallery.length > 0 ? product.gallery[0] : product.image;

  const thumbBox = document.getElementById('pdpThumbnailRow');
  if (thumbBox) {
    const galleryList = product.gallery || [product.image];
    thumbBox.innerHTML = galleryList.map((src, idx) => `
      <button onclick="changePdpGalleryImage('${src}', this)" class="pdp-thumb-item rounded-2xl overflow-hidden aspect-[4/5] border-2 ${idx === 0 ? 'border-teodora-gold' : 'border-teodora-border'} bg-white hover:border-teodora-gold transition">
        <img src="${src}" alt="${product.title}" class="w-full h-full object-cover">
      </button>
    `).join('');
  }

  // Preços e Parcelamento com null-checks seguros
  updatePdpPriceDisplay(product);


  // Seletor de Variantes
  const variantBox = document.getElementById('pdpVariantSelector');
  const volumeLabel = document.getElementById('pdpSelectedVolumeLabel');
  if (variantBox) {
    if (product.variants && product.variants.length > 0) {
      variantBox.innerHTML = product.variants.map((v, idx) => `
        <button onclick="selectPdpVariant(${idx})" class="pdp-var-btn p-2.5 rounded-2xl border ${idx === 0 ? 'border-teodora-gold bg-teodora-roseLight/70' : 'border-teodora-border bg-white'} text-center transition">
          <span class="block text-xs font-bold text-teodora-text">${v.size}</span>
          <span class="block text-[10px] text-teodora-textMuted">${formatBRL(v.price)}</span>
        </button>
      `).join('');
      if (volumeLabel) volumeLabel.innerText = product.variants[0].label;
    } else {
      variantBox.innerHTML = `<span class="text-xs text-teodora-textMuted col-span-3">${product.volume}</span>`;
      if (volumeLabel) volumeLabel.innerText = product.volume;
    }
  }

  // Notas olfativas
  const topNotes = document.getElementById('pdpTopNotes');
  if (topNotes) topNotes.innerText = product.pyramid ? product.pyramid.top : product.notes;
  const heartNotes = document.getElementById('pdpHeartNotes');
  if (heartNotes) heartNotes.innerText = product.pyramid ? product.pyramid.heart : product.notes;
  const baseNotes = document.getElementById('pdpBaseNotes');
  if (baseNotes) baseNotes.innerText = product.pyramid ? product.pyramid.base : 'Madeiras e almíscar';

  // Abas descritivas
  const descEl = document.getElementById('pdpDescription');
  if (descEl) descEl.innerText = product.description;
  const ritualEl = document.getElementById('pdpRitualAdvice');
  if (ritualEl) ritualEl.innerText = product.ritual || 'Borrife nos pulsos e na nuca.';
  const ingrEl = document.getElementById('pdpIngredients');
  if (ingrEl) ingrEl.innerText = product.ingredients || 'Alcohol Denat, Parfum, Aqua.';
  switchPdpTab('ritual');

  // Quantidade
  const qEl = document.getElementById('pdpQuantityCount');
  if (qEl) qEl.innerText = '1';

  // Ícone Favorito
  const isFav = APP_STATE.wishlist.some(w => w.id === product.id);
  const favIcon = document.getElementById('pdpWishlistIcon');
  if (favIcon) favIcon.className = isFav ? 'fa-solid fa-heart text-red-500' : 'fa-regular fa-heart text-lg';

  // Renderiza Produtos Similares
  renderSimilarProducts(product);

  // Rola suavemente ao topo
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeProductPage() {
  const pdp = document.getElementById('productPageView');
  if (pdp) pdp.classList.add('hidden');
  const mainFlow = document.getElementById('catalogMainFlow');
  if (mainFlow) mainFlow.classList.remove('hidden');
  setHomeLandingVisible(true);
  APP_STATE.activeProductId = null;
}

function changePdpGalleryImage(src, btnEl) {
  const mainImg = document.getElementById('pdpMainImage');
  if (mainImg) mainImg.src = src;
  document.querySelectorAll('.pdp-thumb-item').forEach(b => {
    b.classList.remove('border-teodora-gold');
    b.classList.add('border-teodora-border');
  });
  if (btnEl) {
    btnEl.classList.remove('border-teodora-border');
    btnEl.classList.add('border-teodora-gold');
  }
}

function selectPdpVariant(idx) {
  APP_STATE.selectedPdpVariantIdx = idx;
  const product = APP_STATE.products.find(p => p.id === APP_STATE.activeProductId);
  if (!product || !product.variants) return;

  const variant = product.variants[idx];
  const volEl = document.getElementById('pdpSelectedVolumeLabel');
  if (volEl) volEl.innerText = variant.label;

  document.querySelectorAll('.pdp-var-btn').forEach((b, i) => {
    if (i === idx) {
      b.classList.add('border-teodora-gold', 'bg-teodora-roseLight/70');
      b.classList.remove('border-teodora-border', 'bg-white');
    } else {
      b.classList.remove('border-teodora-gold', 'bg-teodora-roseLight/70');
      b.classList.add('border-teodora-border', 'bg-white');
    }
  });

  updatePdpPriceDisplay(product);
}

function updatePdpPriceDisplay(product) {
  if (!product) return;
  const price = product.variants && product.variants[APP_STATE.selectedPdpVariantIdx] 
    ? product.variants[APP_STATE.selectedPdpVariantIdx].price 
    : product.price;

  const installment = price / 6;
  const pixPrice = price * 0.95;

  const curPriceEl = document.getElementById('pdpCurrentPrice');
  if (curPriceEl) curPriceEl.innerText = formatBRL(price);

  const oldPriceEl = document.getElementById('pdpOldPrice');
  const discountEl = document.getElementById('pdpDiscountBadge');
  if (oldPriceEl && discountEl) {
    if (product.oldPrice && product.oldPrice > price) {
      const savings = product.oldPrice - price;
      oldPriceEl.style.display = 'inline';
      oldPriceEl.innerText = formatBRL(product.oldPrice);
      discountEl.style.display = 'inline';
      discountEl.innerText = `−${formatBRL(savings)}`;
    } else {
      oldPriceEl.style.display = 'none';
      discountEl.style.display = 'none';
    }
  }

  const instEl = document.getElementById('pdpInstallmentPrice');
  if (instEl) instEl.innerText = formatBRL(installment);

  const pixEl = document.getElementById('pdpPixPrice');
  if (pixEl) pixEl.innerText = pixPrice.toFixed(2).replace('.', ',');
}

function changePdpQuantity(delta) {
  let current = APP_STATE.pdpQuantity + delta;
  if (current < 1) current = 1;
  if (current > 10) current = 10;
  APP_STATE.pdpQuantity = current;
  const qEl = document.getElementById('pdpQuantityCount');
  if (qEl) qEl.innerText = current;
}

function addToCartFromPdp() {
  const product = APP_STATE.products.find(p => p.id === APP_STATE.activeProductId);
  if (!product) return;

  const variant = product.variants ? product.variants[APP_STATE.selectedPdpVariantIdx] : null;
  const finalPrice = variant ? variant.price : product.price;
  const finalVolume = variant ? variant.size : product.volume;

  const cartItem = {
    ...product,
    price: finalPrice,
    volume: finalVolume,
    quantity: APP_STATE.pdpQuantity
  };

  const existing = APP_STATE.cart.find(i => i.id === product.id && i.volume === finalVolume);
  if (existing) {
    existing.quantity += APP_STATE.pdpQuantity;
  } else {
    APP_STATE.cart.push(cartItem);
  }

  updateCartUI();
  displayToast(`<strong>${product.title} (${finalVolume})</strong> adicionado à sacola!`);
  toggleCartDrawer(true);
}

function buyNowFromPdp() {
  addToCartFromPdp();
  openMercadoPagoModal();
}

function toggleWishlistFromPdp() {
  if (!APP_STATE.activeProductId) return;
  toggleWishlist(APP_STATE.activeProductId);
  const isFav = APP_STATE.wishlist.some(w => w.id === APP_STATE.activeProductId);
  const favIcon = document.getElementById('pdpWishlistIcon');
  if (favIcon) favIcon.className = isFav ? 'fa-solid fa-heart text-red-500' : 'fa-regular fa-heart text-lg';
}

function setPriceShortcut(val) {
  handlePriceRangeChange(val);
}

function switchPdpTab(tab) {
  document.querySelectorAll('.pdp-tab-btn').forEach(b => {
    b.classList.remove('border-teodora-gold', 'text-teodora-text', 'font-bold');
    b.classList.add('border-transparent', 'text-teodora-textMuted');
  });

  const tabRitual = document.getElementById('pdpTabContentRitual');
  const tabAtivos = document.getElementById('pdpTabContentAtivos');
  const tabAval = document.getElementById('pdpTabContentAvaliacoes');

  if (tabRitual) tabRitual.classList.add('hidden');
  if (tabAtivos) tabAtivos.classList.add('hidden');
  if (tabAval) tabAval.classList.add('hidden');

  const btnRitual = document.getElementById('tabBtnRitual');
  const btnAtivos = document.getElementById('tabBtnAtivos');
  const btnAval = document.getElementById('tabBtnAvaliacoes');

  if (tab === 'ritual') {
    if (btnRitual) {
      btnRitual.classList.add('border-teodora-gold', 'text-teodora-text', 'font-bold');
      btnRitual.classList.remove('border-transparent', 'text-teodora-textMuted');
    }
    if (tabRitual) tabRitual.classList.remove('hidden');
  } else if (tab === 'ativos') {
    if (btnAtivos) {
      btnAtivos.classList.add('border-teodora-gold', 'text-teodora-text', 'font-bold');
      btnAtivos.classList.remove('border-transparent', 'text-teodora-textMuted');
    }
    if (tabAtivos) tabAtivos.classList.remove('hidden');
  } else {
    if (btnAval) {
      btnAval.classList.add('border-teodora-gold', 'text-teodora-text', 'font-bold');
      btnAval.classList.remove('border-transparent', 'text-teodora-textMuted');
    }
    if (tabAval) tabAval.classList.remove('hidden');
  }
}

async function calculateFreightForPdp() {
  const raw = document.getElementById('pdpCepInput').value.replace(/\D/g, '');
  const box = document.getElementById('pdpShippingResults');
  const product = APP_STATE.products.find((p) => p.id === APP_STATE.activeProductId);

  if (raw.length !== 8) {
    displayToast('Informe um CEP válido com 8 dígitos.');
    return;
  }

  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = `<span class="text-teodora-gold"><i class="fa-solid fa-spinner fa-spin"></i> Cotando CepCerto...</span>`;
  }

  try {
    const apiBase = teodoraApiBase();
    const ids = product ? String(product.id) : '';
    const declared = product ? product.price : 50;
    const resp = await fetch(`${apiBase}/api/shipping/quote?cep=${raw}&product_ids=${ids}&declared_value=${declared}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Falha na cotação');

    const addr = data.address || {};
    const options = data.options || [];
    if (box) {
      box.innerHTML = `
        <div class="p-2.5 rounded-xl bg-teodora-bgLight border border-teodora-border space-y-1">
          <p class="text-[11px] font-bold text-teodora-text">${addr.localidade || ''} - ${addr.uf || ''} (${addr.bairro || 'Região'})</p>
          ${options.map((o) => `
            <div class="flex justify-between text-[11px]">
              <span class="text-teodora-textMuted">${o.name}${o.days ? ` (${o.days})` : ''}:</span>
              <span class="font-bold text-teodora-text">${formatBRL(o.price)}</span>
            </div>
          `).join('') || '<span class="text-red-500 text-[11px]">Sem opções para este CEP.</span>'}
          ${data.demo ? '<p class="text-[10px] text-amber-700">Estimativa local — configure CepCerto no servidor.</p>' : ''}
        </div>
      `;
    }
  } catch (e) {
    if (box) box.innerHTML = `<span class="text-red-500">${e.message || 'Erro ao cotar frete.'}</span>`;
  }
}

function renderSimilarProducts(product) {
  const container = document.getElementById('pdpSimilarProductsGrid');
  if (!container) return;
  
  const similarList = (product.similarIds || [2, 3, 4])
    .map(id => APP_STATE.products.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 4);

  container.innerHTML = similarList.map(item => `
    <article class="group bg-white rounded-3xl border border-teodora-border hover:border-teodora-gold/50 shadow-card-clean hover:shadow-card-hover transition-all duration-300 flex flex-col h-full overflow-hidden p-4">
      <div onclick="openProductPage(${item.id})" class="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-teodora-bgLight mb-4 flex-shrink-0 cursor-pointer">
        <img src="${item.image}" alt="${item.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700">
        ${item.badge ? `
          <span class="absolute top-3 left-3 px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-white/95 text-teodora-text border border-teodora-border shadow-sm">
            ${item.badge}
          </span>
        ` : ''}
      </div>
      <div class="flex-1 flex flex-col justify-between space-y-3">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-teodora-gold block mb-1">${item.brandTag}</span>
          <h3 onclick="openProductPage(${item.id})" class="font-heading text-base font-semibold text-teodora-text group-hover:text-teodora-gold transition-colors leading-tight line-clamp-1 cursor-pointer">
            ${item.title}
          </h3>
          <div class="flex items-center gap-1.5 text-xs mt-1.5">
            <span class="text-teodora-gold text-xs"><i class="fa-solid fa-star"></i></span>
            <span class="font-bold text-teodora-text">${item.rating.toFixed(1)}</span>
            <span class="text-teodora-textMuted">(${item.reviews})</span>
          </div>
        </div>
        <div class="pt-2 border-t border-teodora-border space-y-2">
          <span class="text-lg font-bold text-teodora-text block">${formatBRL(item.price)}</span>
          <button onclick="openProductPage(${item.id})" class="w-full py-2.5 px-3 rounded-xl bg-white border border-teodora-border hover:border-teodora-gold text-teodora-text text-[11px] font-semibold uppercase tracking-wider transition">
            Ver detalhes
          </button>
        </div>
      </div>
    </article>
  `).join('');
}

function toggleIntensityFilter(intensity, checked) {
  if (checked) {
    if (!APP_STATE.filters.intensities.includes(intensity)) APP_STATE.filters.intensities.push(intensity);
  } else {
    APP_STATE.filters.intensities = APP_STATE.filters.intensities.filter(i => i !== intensity);
  }
  renderProducts();
}

function toggleOccasionShortcut(occ) {
  const idx = APP_STATE.filters.occasions.indexOf(occ);
  const btn = document.getElementById(`occBtn-${occ}`);
  if (idx > -1) {
    APP_STATE.filters.occasions.splice(idx, 1);
    if (btn) btn.classList.remove('border-teodora-gold', 'bg-teodora-roseLight/70', 'font-bold');
  } else {
    APP_STATE.filters.occasions.push(occ);
    if (btn) btn.classList.add('border-teodora-gold', 'bg-teodora-roseLight/70', 'font-bold');
  }
  renderProducts();
}

function toggleActiveFilter(active, checked) {
  if (checked) {
    if (!APP_STATE.filters.actives.includes(active)) APP_STATE.filters.actives.push(active);
  } else {
    APP_STATE.filters.actives = APP_STATE.filters.actives.filter(a => a !== active);
  }
  renderProducts();
}

function createProductCardHTML(item) {
  const isFav = APP_STATE.wishlist.some(w => w.id === item.id);
  const installment = item.price / 6;
  const savings = item.oldPrice && item.oldPrice > item.price
    ? item.oldPrice - item.price
    : 0;
  let badgeClass = 'badge-default';
  if (item.badge === 'Mais Vendido') badgeClass = 'badge-vendido';
  else if (item.badge === 'Lançamento') badgeClass = 'badge-lancamento';
  else if (item.badge === 'Edição Especial') badgeClass = 'badge-especial';

  return `
    <article class="product-card group flex flex-col h-full overflow-hidden">
      <div onclick="openProductPage(${item.id})" class="product-card__media relative w-full overflow-hidden cursor-pointer">
        <img src="${item.image}" alt="${item.title}" class="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" loading="lazy">
        ${item.badge ? `
          <span class="absolute top-2.5 left-2.5 text-[9px] sm:text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1 ${badgeClass}">
            ${item.badge}
          </span>
        ` : ''}
        <button onclick="event.stopPropagation(); toggleWishlist(${item.id})" class="absolute top-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center text-teodora-text/80 hover:text-teodora-text bg-white/95 shadow-sm transition" aria-label="Favoritar">
          <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart text-sm"></i>
        </button>
      </div>

      <div class="p-3 sm:p-4 flex-1 flex flex-col gap-2">
        <div class="space-y-1 cursor-pointer" onclick="openProductPage(${item.id})">
          <p class="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] text-teodora-textMuted line-clamp-1">${item.brandTag || item.volume}</p>
          <h3 class="font-heading text-sm sm:text-[15px] font-normal text-teodora-text leading-snug line-clamp-2">
            ${item.title}
          </h3>
          <p class="hidden sm:block text-[11px] text-teodora-textMuted font-light line-clamp-2 leading-relaxed">${item.notes}</p>
        </div>

        <div class="mt-auto pt-2 space-y-2.5">
          <div onclick="openProductPage(${item.id})" class="cursor-pointer space-y-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="text-base sm:text-lg font-semibold text-teodora-text tracking-tight">${formatBRL(item.price)}</span>
              ${item.oldPrice ? `<span class="text-xs text-teodora-textMuted line-through">${formatBRL(item.oldPrice)}</span>` : ''}
              ${savings ? `<span class="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5">−${formatBRL(savings)}</span>` : ''}
            </div>
            <p class="text-[11px] text-teodora-textMuted">ou 6x de ${formatBRL(installment)} sem juros</p>
          </div>

          <button onclick="quickAddToCart(${item.id})" class="btn-comprar w-full py-2.5 text-[11px] uppercase tracking-[0.16em] font-semibold">
            Comprar
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const items = getFilteredProducts();
  const countEl = document.getElementById('productResultsCount');
  if (countEl) {
    countEl.innerText = `${items.length}`;
  }

  renderActiveFilterTags();

  const container = document.getElementById('productGridContainer');
  const emptyState = document.getElementById('emptyCatalogState');

  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  container.innerHTML = `
    <div class="product-grid grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
      ${items.map(item => createProductCardHTML(item)).join('')}
    </div>
  `;
}

function quickAddToCart(id) {
  const product = APP_STATE.products.find(p => p.id === id);
  if (!product) return;

  const existing = APP_STATE.cart.find(i => i.id === id);
  if (existing) {
    existing.quantity += 1;
  } else {
    APP_STATE.cart.push({ ...product, quantity: 1 });
  }

  updateCartUI();
  displayToast(`<strong>${product.title}</strong> adicionado à sacola!`);
  toggleCartDrawer(true);
}

function updateCartQuantity(id, delta) {
  const idx = APP_STATE.cart.findIndex(i => i.id === id);
  if (idx === -1) return;

  APP_STATE.cart[idx].quantity += delta;
  if (APP_STATE.cart[idx].quantity <= 0) {
    APP_STATE.cart.splice(idx, 1);
  }
  updateCartUI();
}

function removeFromCart(id) {
  APP_STATE.cart = APP_STATE.cart.filter(i => i.id !== id);
  updateCartUI();
  displayToast('Item removido da sacola.');
}

function updateCartUI() {
  const totalCount = APP_STATE.cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = APP_STATE.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const cartCountEl = document.getElementById('cartCountBadge');
  if (cartCountEl) cartCountEl.innerText = totalCount;
  const cartHeaderEl = document.getElementById('cartHeaderBadge');
  if (cartHeaderEl) cartHeaderEl.innerText = totalCount;
  const headerTotalEl = document.getElementById('headerCartTotal');
  if (headerTotalEl) headerTotalEl.innerText = formatBRL(subtotal);

  const listEl = document.getElementById('cartItemList');
  if (APP_STATE.cart.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-14 text-teodora-textMuted space-y-2">
        <i class="fa-solid fa-bag-shopping text-4xl text-teodora-roseSoft"></i>
        <p class="text-xs">Sua sacola de compras está vazia.</p>
        <button onclick="toggleCartDrawer(false)" class="mt-2 text-xs uppercase tracking-wider text-teodora-gold font-bold underline">Explorar fragrâncias</button>
      </div>
    `;
  } else {
    listEl.innerHTML = APP_STATE.cart.map(item => `
      <div class="flex items-center gap-3 p-3 bg-teodora-bgLight rounded-2xl border border-teodora-border">
        <img src="${item.image}" alt="${item.title}" class="w-16 h-16 rounded-xl object-cover bg-white border border-teodora-border">
        <div class="flex-1 min-w-0">
          <h4 class="font-heading text-xs font-semibold text-teodora-text truncate">${item.title}</h4>
          <p class="text-[10px] text-teodora-textMuted">${item.volume}</p>
          <div class="flex items-center justify-between mt-2">
            <div class="flex items-center border border-teodora-border rounded-lg bg-white">
              <button onclick="updateCartQuantity(${item.id}, -1)" class="w-6 h-6 flex items-center justify-center text-xs font-semibold hover:bg-teodora-roseLight">-</button>
              <span class="w-6 text-center text-xs font-semibold">${item.quantity}</span>
              <button onclick="updateCartQuantity(${item.id}, 1)" class="w-6 h-6 flex items-center justify-center text-xs font-semibold hover:bg-teodora-roseLight">+</button>
            </div>
            <span class="text-xs font-bold text-teodora-text">${formatBRL(item.price * item.quantity)}</span>
          </div>
        </div>
        <button onclick="removeFromCart(${item.id})" class="text-teodora-textMuted hover:text-red-500 p-1" aria-label="Remover">
          <i class="fa-regular fa-trash-can text-xs"></i>
        </button>
      </div>
    `).join('');
  }

  let discount = 0;
  if (APP_STATE.couponCode === 'TEODORA10') {
    discount = subtotal * 0.10;
    document.getElementById('summaryDiscountRow').style.display = 'flex';
    document.getElementById('summaryDiscount').innerText = `- ${formatBRL(discount)}`;
  } else {
    document.getElementById('summaryDiscountRow').style.display = 'none';
  }

  const total = Math.max(0, subtotal - discount + APP_STATE.shippingCost);
  document.getElementById('summarySubtotal').innerText = formatBRL(subtotal);
  document.getElementById('summaryShipping').innerText = APP_STATE.shippingCost === 0 && APP_STATE.shippingOptionName ? 'GRÁTIS' : (APP_STATE.shippingCost > 0 ? formatBRL(APP_STATE.shippingCost) : 'Informe seu CEP');
  document.getElementById('summaryTotal').innerText = formatBRL(total);
}

function toggleCartDrawer(open) {
  const backdrop = document.getElementById('cartDrawerBackdrop');
  const panel = document.getElementById('cartDrawerPanel');
  if (open) {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    panel.classList.remove('translate-x-full');
  } else {
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    panel.classList.add('translate-x-full');
  }
}

async function calculateFreightViaCEP() {
  const raw = document.getElementById('cepInput').value.replace(/\D/g, '');
  const label = document.getElementById('cepResultLabel');
  const box = document.getElementById('shippingRatesBox');

  if (raw.length !== 8) {
    displayToast('Informe um CEP válido com 8 dígitos.');
    return;
  }
  if (!APP_STATE.cart.length) {
    displayToast('Adicione produtos à sacola para calcular o frete.');
    return;
  }

  label.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-teodora-gold"></i> Cotando CepCerto...`;

  try {
    const apiBase = teodoraApiBase();
    const ids = APP_STATE.cart.map((i) => i.id).join(',');
    const declared = APP_STATE.cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const url = `${apiBase}/api/shipping/quote?cep=${raw}&product_ids=${ids}&declared_value=${declared}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Falha na cotação');

    APP_STATE.shippingInfo = data.address || null;
    const city = data.address?.localidade || '';
    const uf = data.address?.uf || '';
    label.innerText = city ? `${city} - ${uf}` : 'Frete disponível';

    const options = data.options || [];
    if (!options.length) {
      box.classList.remove('hidden');
      box.innerHTML = `<p class="text-xs text-red-600">Nenhuma opção de frete para este CEP.</p>`;
      return;
    }

    box.classList.remove('hidden');
    box.innerHTML = options.map((opt, idx) => `
      <label class="flex items-center justify-between p-2.5 rounded-xl border border-teodora-border bg-white cursor-pointer hover:border-teodora-gold transition">
        <div class="flex items-center gap-2">
          <input type="radio" name="shippingRate" ${idx === 0 ? 'checked' : ''}
            onchange='setShippingChoice(${opt.price}, ${JSON.stringify(opt.name)}, ${JSON.stringify(opt)})'
            class="accent-teodora-gold">
          <span class="text-xs font-medium text-teodora-text">${opt.name}${opt.days ? ` (${opt.days})` : ''}</span>
        </div>
        <span class="font-bold text-xs">${formatBRL(opt.price)}</span>
      </label>
    `).join('') + (data.demo ? `<p class="text-[10px] text-amber-700 pt-1">Cotação estimada — configure o token CepCerto no servidor.</p>` : '');

    setShippingChoice(options[0].price, options[0].name, options[0]);
    displayToast(city ? `Frete calculado para ${city}/${uf}` : 'Frete calculado');
  } catch (err) {
    label.innerText = 'Erro na cotação.';
    displayToast(err.message || 'Erro ao cotar frete.');
  }
}

function setShippingChoice(cost, name, option) {
  APP_STATE.shippingCost = cost;
  APP_STATE.shippingOptionName = name;
  APP_STATE.shippingOption = option || { name, price: cost };
  updateCartUI();
}

function applyDiscountCoupon() {
  const code = document.getElementById('cartCouponInput').value.trim().toUpperCase();
  if (code === 'TEODORA10') {
    APP_STATE.couponCode = 'TEODORA10';
    updateCartUI();
    displayToast('Cupom <strong>TEODORA10</strong> ativado: 10% de desconto!');
  } else {
    displayToast('Cupom inválido ou expirado.');
  }
}

async function openMercadoPagoModal() {
  if (APP_STATE.cart.length === 0) {
    displayToast('Sua sacola está vazia. Adicione produtos antes de comprar.');
    return;
  }
  toggleCartDrawer(false);

  const subtotal = APP_STATE.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = APP_STATE.couponCode ? subtotal * 0.10 : 0;
  let finalTotal = Math.max(0, subtotal - discount + APP_STATE.shippingCost);
  if (APP_STATE.paymentMethod === 'pix') finalTotal *= 0.95;

  document.getElementById('checkoutFinalTotal').innerText = formatBRL(finalTotal);

  if (APP_STATE.shippingInfo) {
    const info = APP_STATE.shippingInfo;
    const parts = [info.logradouro, info.bairro, info.localidade && info.uf ? `${info.localidade}/${info.uf}` : ''].filter(Boolean);
    if (parts.length) {
      document.getElementById('buyerAddress').value = parts.join(', ');
    }
  }

  const user = window.TeodoraAPI?.getUser?.();
  if (user) {
    if (user.name) document.getElementById('buyerName').value = user.name;
    if (user.email) document.getElementById('buyerEmail').value = user.email;
    if (user.phone) document.getElementById('buyerPhone').value = user.phone;
  }

  document.getElementById('checkoutFormPanel').style.display = 'block';
  document.getElementById('checkoutSuccessPanel').classList.add('hidden');
  document.getElementById('paymentBrick_container').innerHTML = '';
  document.getElementById('paymentBrickWrap').classList.add('hidden');
  document.getElementById('btnSubmitPayment').classList.remove('hidden');
  document.getElementById('mercadoPagoModal').classList.remove('hidden');
  document.getElementById('mercadoPagoModal').classList.add('flex');
}

function closeMercadoPagoModal() {
  if (APP_STATE.mpBrickController?.unmount) {
    try { APP_STATE.mpBrickController.unmount(); } catch (_) { /* ignore */ }
  }
  APP_STATE.mpBrickController = null;
  document.getElementById('mercadoPagoModal').classList.add('hidden');
  document.getElementById('mercadoPagoModal').classList.remove('flex');
}

function changePaymentOption(method) {
  APP_STATE.paymentMethod = method;
  document.querySelectorAll('.pay-tab').forEach(t => {
    t.classList.remove('border-teodora-gold', 'bg-teodora-cream');
    t.classList.add('border-teodora-border', 'bg-white');
  });

  document.getElementById('panelPix').classList.add('hidden');
  document.getElementById('panelCard').classList.add('hidden');
  document.getElementById('panelBoleto').classList.add('hidden');

  if (method === 'pix') {
    document.getElementById('payTabPix').classList.add('border-teodora-gold', 'bg-teodora-cream');
    document.getElementById('payTabPix').classList.remove('border-teodora-border', 'bg-white');
    document.getElementById('panelPix').classList.remove('hidden');
  } else if (method === 'card') {
    document.getElementById('payTabCard').classList.add('border-teodora-gold', 'bg-teodora-cream');
    document.getElementById('payTabCard').classList.remove('border-teodora-border', 'bg-white');
    document.getElementById('panelCard').classList.remove('hidden');
  } else {
    document.getElementById('payTabBoleto').classList.add('border-teodora-gold', 'bg-teodora-cream');
    document.getElementById('payTabBoleto').classList.remove('border-teodora-border', 'bg-white');
    document.getElementById('panelBoleto').classList.remove('hidden');
  }

  const subtotal = APP_STATE.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = APP_STATE.couponCode ? subtotal * 0.10 : 0;
  let total = Math.max(0, subtotal - discount + APP_STATE.shippingCost);
  if (method === 'pix') total *= 0.95;
  document.getElementById('checkoutFinalTotal').innerText = formatBRL(total);
}

async function mountPaymentBrick(amount, publicKey, orderId) {
  if (!window.MercadoPago) throw new Error('SDK Mercado Pago não carregou.');
  if (!publicKey) throw new Error('MP_PUBLIC_KEY não configurada no servidor.');

  const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();
  const container = document.getElementById('paymentBrick_container');
  container.innerHTML = '';

  const paymentMethods = { maxInstallments: 6 };
  if (APP_STATE.paymentMethod === 'pix') {
    paymentMethods.creditCard = 'none';
    paymentMethods.debitCard = 'none';
    paymentMethods.ticket = 'none';
  } else if (APP_STATE.paymentMethod === 'boleto') {
    paymentMethods.creditCard = 'none';
    paymentMethods.debitCard = 'none';
    paymentMethods.bankTransfer = 'none';
  } else {
    paymentMethods.ticket = 'none';
    paymentMethods.bankTransfer = 'none';
  }

  APP_STATE.mpBrickController = await bricksBuilder.create('payment', 'paymentBrick_container', {
    initialization: {
      amount: Number(amount),
    },
    customization: {
      paymentMethods,
    },
    callbacks: {
      onReady: () => {},
      onSubmit: async ({ formData }) => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          const token = window.TeodoraAPI?.getToken?.();
          if (token) headers.Authorization = `Bearer ${token}`;
          const apiBase = teodoraApiBase();
          const res = await fetch(`${apiBase}/api/payments`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ orderId, formData }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || 'Pagamento recusado');

          const status = data.status || 'pending';
          if (status === 'approved') {
            showCheckoutReturnPanel('success');
          } else if (status === 'rejected') {
            showCheckoutReturnPanel('failure');
          } else {
            showCheckoutReturnPanel('pending');
          }
          try { sessionStorage.setItem('teodora_last_order', orderId); } catch (_) { /* ignore */ }
        } catch (err) {
          displayToast(err.message || 'Erro no pagamento');
          throw err;
        }
      },
      onError: (error) => {
        console.error(error);
        displayToast('Erro no formulário de pagamento.');
      },
    },
  });
}

async function executePaymentTransaction() {
  const name = (document.getElementById('buyerName')?.value || '').trim();
  const email = (document.getElementById('buyerEmail')?.value || '').trim();
  const doc = (document.getElementById('buyerDoc')?.value || '').trim();
  const phone = (document.getElementById('buyerPhone')?.value || '').trim();
  const address = (document.getElementById('buyerAddress')?.value || '').trim();

  if (!name || !email) {
    displayToast('Informe nome e e-mail para continuar.');
    return;
  }
  if (APP_STATE.cart.length === 0) {
    displayToast('Sua sacola está vazia.');
    return;
  }

  const btn = document.getElementById('btnSubmitPayment');
  const prevHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparando...`;

  const apiBase = teodoraApiBase();

  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = window.TeodoraAPI?.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    const payload = {
      items: APP_STATE.cart.map((item) => ({ id: item.id, quantity: item.quantity })),
      shippingCost: APP_STATE.shippingCost || 0,
      couponCode: APP_STATE.couponCode || '',
      paymentHint: APP_STATE.paymentMethod || 'pix',
      shippingOption: APP_STATE.shippingOption || null,
      payer: { name, email, doc, phone, address },
    };

    const res = await fetch(`${apiBase}/api/checkout/prepare`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Não foi possível preparar o pedido.');

    APP_STATE.checkoutOrderId = data.orderId;
    try { sessionStorage.setItem('teodora_last_order', data.orderId); } catch (_) { /* ignore */ }

    document.getElementById('checkoutFinalTotal').innerText = formatBRL(data.amount);
    document.getElementById('paymentBrickWrap').classList.remove('hidden');
    btn.classList.add('hidden');

    await mountPaymentBrick(data.amount, data.publicKey, data.orderId);
    displayToast('Escolha a forma de pagamento abaixo.');
  } catch (err) {
    console.error(err);
    displayToast(err.message || 'Erro ao conectar com o Mercado Pago.');
    btn.disabled = false;
    btn.innerHTML = prevHtml;
  }
}

function copyPixToClipboard() {
  displayToast('O Pix oficial é gerado no Checkout Pro do Mercado Pago.');
}

function showCheckoutReturnPanel(status) {
  document.getElementById('checkoutFormPanel').style.display = 'none';
  const brickWrap = document.getElementById('paymentBrickWrap');
  if (brickWrap) brickWrap.classList.add('hidden');
  document.getElementById('checkoutSuccessPanel').classList.remove('hidden');
  document.getElementById('mercadoPagoModal').classList.remove('hidden');
  document.getElementById('mercadoPagoModal').classList.add('flex');

  const eyebrow = document.getElementById('checkoutResultEyebrow');
  const title = document.getElementById('checkoutResultTitle');
  const message = document.getElementById('checkoutResultMessage');
  const orderEl = document.getElementById('displayOrderNumber');

  let ref = '—';
  try {
    ref = sessionStorage.getItem('teodora_last_order') || '—';
  } catch (_) { /* ignore */ }
  if (orderEl) orderEl.innerText = ref;

  if (status === 'success') {
    if (eyebrow) eyebrow.innerText = 'Pagamento aprovado';
    if (title) title.innerText = 'Pedido confirmado';
    if (message) message.innerText = 'Recebemos a confirmação do Mercado Pago. Obrigado por comprar na Teodora.';
    APP_STATE.cart = [];
    updateCartUI();
    displayToast('Pagamento aprovado. Pedido registrado!');
  } else if (status === 'pending') {
    if (eyebrow) {
      eyebrow.innerText = 'Pagamento pendente';
      eyebrow.classList.remove('text-emerald-700');
      eyebrow.classList.add('text-amber-700');
    }
    if (title) title.innerText = 'Aguardando confirmação';
    if (message) message.innerText = 'Pix ou boleto ainda estão processando. Você recebe a confirmação por e-mail.';
    displayToast('Pedido criado. Aguardando pagamento.');
  } else {
    if (eyebrow) {
      eyebrow.innerText = 'Pagamento não concluído';
      eyebrow.classList.remove('text-emerald-700');
      eyebrow.classList.add('text-red-600');
    }
    if (title) title.innerText = 'Tente novamente';
    if (message) message.innerText = 'O pagamento não foi finalizado. Sua sacola foi mantida — você pode tentar de novo.';
    displayToast('Pagamento cancelado ou recusado.');
  }
}

function handleCheckoutReturnFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('checkout');
  if (!status) return;

  showCheckoutReturnPanel(status);

  const url = new URL(window.location.href);
  url.searchParams.delete('checkout');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

function resetStoreAfterPurchase() {
  if (APP_STATE.cart.length) {
    APP_STATE.cart = [];
    updateCartUI();
  }
  closeMercadoPagoModal();
  displayToast('Obrigado por escolher a Teodora.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openQuickModal(id) {
  const p = APP_STATE.products.find(item => item.id === id);
  if (!p) return;

  const c = document.getElementById('quickModalContent');
  c.innerHTML = `
    <div class="rounded-2xl overflow-hidden aspect-[3/4] bg-teodora-bgLight border border-teodora-border">
      <img src="${p.image}" alt="${p.title}" class="w-full h-full object-cover">
    </div>
    <div class="space-y-4">
      <div>
        <span class="text-xs uppercase tracking-widest text-teodora-gold font-bold">${p.brandTag}</span>
        <h3 class="font-heading text-2xl font-bold text-teodora-text mt-1">${p.title}</h3>
        <p class="text-xs text-teodora-textMuted">${p.volume}</p>
      </div>
      
      <div class="p-3 rounded-2xl bg-teodora-roseLight/60 text-xs text-teodora-text space-y-1.5 border border-teodora-border">
        <p class="font-bold text-teodora-gold"><i class="fa-solid fa-droplet"></i> Notas principais</p>
        <p class="text-teodora-textMuted">${p.notes}</p>
      </div>

      <p class="text-xs text-teodora-text leading-relaxed font-light">${p.description}</p>
      
      <div class="pt-2 border-t border-teodora-border">
        <span class="text-2xl font-bold text-teodora-text">${formatBRL(p.price)}</span>
        <p class="text-xs text-teodora-textMuted">ou 6x de ${formatBRL(p.price / 6)} sem juros no Mercado Pago</p>
      </div>

      <div class="flex gap-3 pt-2">
        <button onclick="quickAddToCart(${p.id}); closeQuickModal();" class="flex-1 py-3.5 bg-teodora-text hover:bg-black text-white rounded-xl text-xs uppercase tracking-widest font-semibold transition shadow-md">
          Adicionar à Sacola
        </button>
        <button onclick="toggleWishlist(${p.id})" class="w-12 h-12 rounded-xl border border-teodora-border flex items-center justify-center text-teodora-text hover:text-red-500 transition">
          <i class="fa-regular fa-heart text-base"></i>
        </button>
      </div>
    </div>
  `;

  document.getElementById('quickModal').classList.remove('hidden');
  document.getElementById('quickModal').classList.add('flex');
}

function closeQuickModal() {
  document.getElementById('quickModal').classList.add('hidden');
  document.getElementById('quickModal').classList.remove('flex');
}

function toggleWishlist(id) {
  const p = APP_STATE.products.find(item => item.id === id);
  if (!p) return;

  const idx = APP_STATE.wishlist.findIndex(i => i.id === id);
  if (idx > -1) {
    APP_STATE.wishlist.splice(idx, 1);
    displayToast('Item removido dos favoritos.');
  } else {
    APP_STATE.wishlist.push(p);
    displayToast(`<strong>${p.title}</strong> adicionado aos favoritos!`);
  }

  document.getElementById('wishlistCountBadge').innerText = APP_STATE.wishlist.length;
  renderProducts();
}

function openWishlistModal() {
  const list = document.getElementById('wishlistItemsContainer');
  if (APP_STATE.wishlist.length === 0) {
    list.innerHTML = '<p class="text-xs text-teodora-textMuted text-center py-6">Sua lista de desejos está vazia.</p>';
  } else {
    list.innerHTML = APP_STATE.wishlist.map(p => `
      <div class="flex items-center justify-between p-3 bg-teodora-bgLight rounded-2xl border border-teodora-border">
        <div class="flex items-center gap-3">
          <img src="${p.image}" class="w-12 h-12 rounded-xl object-cover border border-teodora-border">
          <div>
            <p class="text-xs font-semibold text-teodora-text">${p.title}</p>
            <p class="text-xs text-teodora-text font-bold">${formatBRL(p.price)}</p>
          </div>
        </div>
        <button onclick="quickAddToCart(${p.id}); closeWishlistModal();" class="px-3.5 py-2 bg-teodora-text hover:bg-black text-white text-[10px] uppercase font-semibold rounded-lg shadow-sm">Comprar</button>
      </div>
    `).join('');
  }

  document.getElementById('wishlistModal').classList.remove('hidden');
  document.getElementById('wishlistModal').classList.add('flex');
}

function closeWishlistModal() {
  document.getElementById('wishlistModal').classList.add('hidden');
  document.getElementById('wishlistModal').classList.remove('flex');
}

function toggleMobileFilter() {
  const drawer = document.getElementById('mobileFilterDrawer');
  const panel = document.getElementById('mobileFilterPanel');
  const open = !drawer.classList.contains('pointer-events-none');
  if (open) {
    drawer.classList.add('opacity-0', 'pointer-events-none');
    panel.classList.add('-translate-x-full');
  } else {
    drawer.classList.remove('opacity-0', 'pointer-events-none');
    panel.classList.remove('-translate-x-full');
  }
}

function openSearchModal() {
  const modal = document.getElementById('searchOverlay');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => document.getElementById('liveSearchInput').focus(), 100);
}

function closeSearchModal() {
  const modal = document.getElementById('searchOverlay');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function executeLiveSearch(query) {
  const out = document.getElementById('liveSearchResults');
  const clean = query.trim().toLowerCase();
  if (clean.length < 2) {
    out.innerHTML = '<p class="text-xs text-teodora-textMuted text-center py-4">Digite ao menos 2 caracteres...</p>';
    return;
  }

  const matches = APP_STATE.products.filter(p => 
    p.title.toLowerCase().includes(clean) || 
    p.notes.toLowerCase().includes(clean) ||
    p.category.toLowerCase().includes(clean)
  );

  if (matches.length === 0) {
    out.innerHTML = '<p class="text-xs text-teodora-textMuted text-center py-4">Nenhum produto localizado.</p>';
    return;
  }

  out.innerHTML = matches.map(m => `
    <div onclick="openQuickModal(${m.id}); closeSearchModal();" class="flex items-center justify-between p-2.5 rounded-xl hover:bg-teodora-roseLight cursor-pointer transition">
      <div class="flex items-center gap-3">
        <img src="${m.image}" class="w-11 h-11 rounded-lg object-cover border border-teodora-border">
        <div>
          <p class="text-xs font-semibold text-teodora-text">${m.title}</p>
          <p class="text-[10px] text-teodora-textMuted">${m.volume}</p>
        </div>
      </div>
      <span class="text-xs font-bold text-teodora-text">${formatBRL(m.price)}</span>
    </div>
  `).join('');
}

function displayToast(htmlContent) {
  const outlet = document.getElementById('toastOutlet');
  const toast = document.createElement('div');
  toast.className = "pointer-events-auto bg-teodora-text text-white text-xs px-4 py-3.5 rounded-2xl shadow-xl border border-teodora-gold/40 flex items-center gap-2.5 max-w-sm transition-all duration-300 transform translate-y-2 opacity-0";
  toast.innerHTML = `<i class="fa-solid fa-check text-teodora-gold"></i><div class="flex-1">${htmlContent}</div>`;
  outlet.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

window.addEventListener('DOMContentLoaded', async () => {
  updateHeaderAccountLink();
  updateNavigationUI('todos');
  renderDynamicFilters();
  updateCartUI();
  handleCheckoutReturnFromQuery();
  try {
    await loadCatalogFromApi();
    renderProducts();
  } catch (err) {
    console.error(err);
    displayToast('Não foi possível carregar o catálogo. Suba a API em :3001.');
  }
});

function updateHeaderAccountLink() {
  const btn = document.getElementById('headerAccountBtn');
  if (!btn) return;
  const user = window.TeodoraAPI?.getUser?.();
  btn.setAttribute('href', user ? '/minha-conta.html' : '/conta.html');
  btn.setAttribute('aria-label', user ? 'Minha conta' : 'Entrar');
}
