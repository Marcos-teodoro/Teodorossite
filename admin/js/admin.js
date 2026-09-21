/* Painel Admin TEODORA — reescrito para o novo HTML Tailwind */
(function () {
  'use strict';

  // ============================================================
  // UTILITÁRIOS
  // ============================================================

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function money(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtDate(str) {
    if (!str) return '—';
    try {
      return new Date(str).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return String(str); }
  }

  // ============================================================
  // TOAST
  // ============================================================

  function showToast(msg, type) {
    const el = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!el || !msgEl) return;
    msgEl.textContent = msg;
    const icon = el.querySelector('span:first-child');
    if (icon) icon.className = type === 'error' ? 'text-red-400 text-sm' : 'text-emerald-400 text-sm';
    el.classList.remove('translate-y-20', 'opacity-0');
    el.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(el._tt);
    el._tt = setTimeout(() => {
      el.classList.remove('translate-y-0', 'opacity-100');
      el.classList.add('translate-y-20', 'opacity-0');
    }, 3600);
  }

  async function runSafe(action) {
    try { return await action(); } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        TeodoraAPI.clearSession();
        location.reload();
      }
      showToast(err?.message || 'Operação não pôde ser concluída.', 'error');
      throw err;
    }
  }

  // ============================================================
  // ESTADO GLOBAL
  // ============================================================

  let _categories = [];
  let _boxes = [];
  let _allProducts = [];
  let _filteredProducts = [];
  let _catalogPage = 1;
  let _catalogPerPage = 8;
  let _catalogFilters = { q: '', category: '', status: '' };
  let _catEditId = null;
  let _currentView = '';

  // ============================================================
  // MAPEAMENTOS DE VALORES
  // ============================================================

  // Selos: valor do <select> → badge enviado à API
  const BADGE_OUT = {
    sem_selo: '',
    mais_vendido: 'Mais Vendido',
    lancamento: 'Lançamento',
    exclusivo: 'Edição Especial',
    edicao_limitada: 'Edição Especial',
  };
  // Badge da API → valor do <select>
  const BADGE_IN = {
    '': 'sem_selo',
    'Mais Vendido': 'mais_vendido',
    'Lançamento': 'lancamento',
    'Edição Especial': 'exclusivo',
  };

  // Concentração: texto do <select> → intensity code da API
  const INTENSITY_OUT = {
    'Eau de Parfum': 'edp',
    'Eau de Toilette': 'edt',
    'Parfum': 'parfum',
    'Eau de Cologne': 'edt',
  };
  // Intensity code da API → texto do <select>
  const INTENSITY_IN = {
    edp: 'Eau de Parfum',
    edt: 'Eau de Toilette',
    parfum: 'Parfum',
    'body-splash': 'Eau de Parfum',
  };

  // Família: valor interno do <select> → family code da API
  const FAMILY_OUT = {
    oriental_gourmand: 'oriental',
    floral: 'floral',
    citrico: 'cítrico',
    chypre: 'amadeirado',
    amadeirado: 'amadeirado',
  };
  // Family code da API → valor interno do <select>
  const FAMILY_IN = {
    floral: 'floral',
    amadeirado: 'amadeirado',
    oriental: 'oriental_gourmand',
    'cítrico': 'citrico',
    'aromático': 'floral',
  };

  // Mapeamento label-texto → name do campo de configurações da loja
  const STORE_FIELD_MAP = {
    'Chamada': 'hero_eyebrow',
    'Botão': 'hero_button',
    'Título': 'hero_title',
    'Imagem': 'hero_image',
    'WhatsApp': 'whatsapp_url',
    'Instagram': 'instagram_url',
    'Facebook': 'facebook_url',
    'Youtube': 'youtube_url',
    'Pinterest': 'pinterest_url',
    'Parcelas Sem Juros': 'installments',
    'Descrição do Rodapé': 'footer_description',
  };

  // ============================================================
  // AUTH & BOOT
  // ============================================================

  function requireAdmin() {
    const token = TeodoraAPI.getToken();
    const user = TeodoraAPI.getUser();
    if (!token || !user || user.role !== 'admin') {
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('appShell').classList.add('hidden');
      return false;
    }
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    const nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.textContent = user.name || user.email || 'Admin';
    return true;
  }

  async function boot() {
    if (!requireAdmin()) return;
    document.getElementById('btnLogout').onclick = () => {
      TeodoraAPI.clearSession();
      location.reload();
    };
    try {
      const data = await TeodoraAPI.api('/api/admin/categories');
      _categories = data.categories || [];
    } catch (_) {}
    loadBoxesFromStorage();
    bindGalleryUploadControls();
    navigateView('dashboard');
  }

  // ============================================================
  // NAVEGAÇÃO
  // ============================================================

  function navigateView(view) {
    _currentView = view;
    const ALL_VIEWS = ['dashboard', 'produtos', 'categorias', 'caixas', 'envios', 'pedidos', 'cupons', 'loja', 'clientes', 'auditoria'];
    ALL_VIEWS.forEach((v) => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.toggle('hidden', v !== view);
    });
    ALL_VIEWS.forEach((v) => {
      const btn = document.getElementById(`nav-${v}`);
      if (!btn) return;
      if (v === view) {
        btn.classList.add('bg-stone-800', 'text-white', 'font-medium');
        btn.classList.remove('text-stone-400', 'hover:text-white', 'hover:bg-stone-850');
      } else {
        btn.classList.remove('bg-stone-800', 'text-white', 'font-medium');
        btn.classList.add('text-stone-400');
      }
    });
    const BREADCRUMBS = {
      dashboard: 'Dashboard', produtos: 'Produtos', categorias: 'Categorias',
      caixas: 'Caixas de Envio', envios: 'CepCerto', pedidos: 'Pedidos / Vendas', cupons: 'Cupons',
      loja: 'Loja & Layout', clientes: 'Clientes', auditoria: 'Auditoria',
    };
    const bc = document.getElementById('breadcrumb-current');
    if (bc) bc.textContent = BREADCRUMBS[view] || view;

    // Ao entrar em produtos, sempre mostra a lista
    if (view === 'produtos') {
      const listEl = document.getElementById('product-list-container');
      const formEl = document.getElementById('product-form-container');
      if (listEl) listEl.classList.remove('hidden');
      if (formEl) formEl.classList.add('hidden');
    }
    // Fecha sidebar mobile
    const sidebar = document.getElementById('main-sidebar');
    if (sidebar && window.innerWidth < 768) sidebar.classList.add('-translate-x-full');

    runSafe(async () => {
      if (view === 'dashboard') await loadDashboard();
      if (view === 'produtos') await loadProducts();
      if (view === 'categorias') await loadCategories();
      if (view === 'caixas') renderBoxesTable();
      if (view === 'envios') await loadCepCertoPanel();
      if (view === 'pedidos') await loadOrders();
      if (view === 'cupons') await loadCoupons();
      if (view === 'loja') await loadStore();
      if (view === 'clientes') await loadCustomers();
      if (view === 'auditoria') await loadAudit();
    }).catch(() => {});
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    if (sidebar) sidebar.classList.toggle('-translate-x-full');
  }

  // ============================================================
  // PREVIEW MODAL
  // ============================================================

  function openStorePreview() {
    updatePreviewFromForm();
    document.getElementById('preview-modal').classList.remove('hidden');
  }

  function closeStorePreview() {
    document.getElementById('preview-modal').classList.add('hidden');
  }

  function updatePreviewFromForm() {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    const title = g('prod_titulo');
    const brand = g('prod_marca');
    const price = parseFloat(g('prod_preco')) || 0;
    const oldPrice = parseFloat(g('prod_preco_antigo')) || 0;
    const volume = g('prod_volume');
    const conc = g('prod_concentracao');
    const badge = BADGE_OUT[g('prod_selo')] || '';
    const inst = 6;

    setTxt('preview-title', title || 'Produto sem título');
    setTxt('preview-brand', (brand || '').toUpperCase());
    setTxt('preview-price', money(price));
    setTxt('preview-old-price', oldPrice > price ? money(oldPrice) : '');
    setTxt('preview-discount-tag', oldPrice > price ? `-R$ ${(oldPrice - price).toFixed(2).replace('.', ',')}` : '');
    setTxt('preview-volume-label', [conc, volume].filter(Boolean).join(' - '));
    setTxt('preview-volume-badge', [conc, volume].filter(Boolean).join(' • '));
    setTxt('preview-notes-top', g('prod_notas_saida') || '—');
    setTxt('preview-notes-heart', g('prod_notas_coracao') || '—');
    setTxt('preview-notes-base', g('prod_notas_fundo') || '—');
    setTxt('preview-description-text', g('prod_descricao') || '');
    setTxt('preview-badge', badge || '');
    const badgeEl = document.getElementById('preview-badge');
    if (badgeEl) badgeEl.classList.toggle('hidden', !badge);
    setTxt('preview-installments', `${inst}x de ${money(price / inst)} sem juros`);
    setTxt('preview-pix-price', `${money(price * 0.95)} no Pix`);
    setTxt('preview-breadcrumb-title', brand || 'Produto');

    const coverImg = document.querySelector('#gallery-grid .gallery-thumb-img');
    const mainImg = document.getElementById('preview-main-img');
    if (mainImg && coverImg) mainImg.src = coverImg.src;
  }

  async function previewSpecificProduct(id) {
    try {
      const data = await TeodoraAPI.api(`/api/admin/products/${id}`);
      const p = data.product || {};
      const imgs = p.images || [];
      const mainImg = document.getElementById('preview-main-img');
      if (mainImg && imgs.length) mainImg.src = TeodoraAPI.absoluteUrl(imgs[0].url);
      const setTxt = (elId, txt) => { const el = document.getElementById(elId); if (el) el.textContent = txt; };
      setTxt('preview-title', p.title || '');
      setTxt('preview-brand', (p.brandTag || '').toUpperCase());
      setTxt('preview-price', money(p.price));
      setTxt('preview-old-price', p.oldPrice ? money(p.oldPrice) : '');
      setTxt('preview-notes-top', p.pyramid?.top || '—');
      setTxt('preview-notes-heart', p.pyramid?.heart || '—');
      setTxt('preview-notes-base', p.pyramid?.base || '—');
      setTxt('preview-description-text', p.description || '');
      setTxt('preview-badge', p.badge || '');
      const badgeEl = document.getElementById('preview-badge');
      if (badgeEl) badgeEl.classList.toggle('hidden', !p.badge);
      document.getElementById('preview-modal').classList.remove('hidden');
    } catch (err) {
      showToast('Erro ao carregar preview: ' + (err.message || ''), 'error');
    }
  }

  // ============================================================
  // DASHBOARD
  // ============================================================

  async function loadDashboard() {
    const data = await TeodoraAPI.api('/api/admin/dashboard');
    const s = data.stats || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val ?? '—'); };
    set('dash-products', s.products ?? '—');
    set('dash-active', s.activeProducts ?? '—');
    set('dash-pending', s.pendingOrders ?? '—');
    set('dash-approved', s.approvedOrders ?? '—');
    set('dash-revenue', money(s.revenue));
    set('dash-lowstock', s.lowStock ?? '—');

    const pending = Number(s.pendingOrders || 0);
    const badge = document.getElementById('nav-orders-badge');
    if (badge) { badge.textContent = pending; badge.classList.toggle('hidden', pending === 0); }
    const pendingLabel = document.getElementById('orders-pending-label');
    if (pendingLabel) pendingLabel.textContent = `${pending} pendente(s)`;

    const tbody = document.getElementById('dash-recent-orders');
    if (tbody) {
      const orders = data.recentOrders || [];
      tbody.innerHTML = orders.length
        ? orders.map((o) => `
          <tr class="hover:bg-stone-50/50 transition-colors">
            <td class="py-3 px-6 font-mono text-xs text-stone-600">#${escapeHtml(String(o.id).slice(0, 8))}</td>
            <td class="py-3 px-6 text-sm">${escapeHtml(o.payer_name || o.payer_email || '—')}</td>
            <td class="py-3 px-6">${statusBadge(o.status)}</td>
            <td class="py-3 px-6 font-mono text-sm font-medium">${money(o.total)}</td>
            <td class="py-3 px-6 text-xs text-stone-500">${fmtDate(o.created_at)}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="py-8 text-center text-xs text-stone-400">Nenhum pedido ainda.</td></tr>';
    }
  }

  // ============================================================
  // PRODUTOS — CATÁLOGO PAGINADO
  // ============================================================

  async function loadProducts(resetPage) {
    if (resetPage !== false) _catalogPage = 1;
    const params = new URLSearchParams();
    if (_catalogFilters.q) params.set('q', _catalogFilters.q);
    if (_catalogFilters.category && _catalogFilters.category !== 'todos') params.set('category', _catalogFilters.category);
    if (_catalogFilters.status === 'ativo') params.set('status', 'active');
    else if (_catalogFilters.status === 'rascunho') params.set('status', 'inactive');
    const qs = params.size ? `?${params}` : '';
    const data = await TeodoraAPI.api(`/api/admin/products${qs}`);
    _allProducts = data.products || [];
    _filteredProducts = _catalogFilters.status === 'baixo_estoque'
      ? _allProducts.filter((p) => (p.stock ?? 0) < 10)
      : _allProducts;
    renderProductTable();
    populateCatalogCategoryFilter();
  }

  function populateCatalogCategoryFilter() {
    const sel = document.getElementById('catalog-category-filter');
    if (!sel || !_categories.length) return;
    const current = sel.value;
    const first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    _categories.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.slug;
      opt.textContent = c.name;
      if (c.slug === current) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderProductTable() {
    const prods = _filteredProducts;
    const total = prods.length;
    const perPage = _catalogPerPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (_catalogPage > totalPages) _catalogPage = totalPages;
    const start = (_catalogPage - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const page = prods.slice(start, end);

    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;
    tbody.innerHTML = page.length
      ? page.map((p) => {
          const imgSrc = p.image ? TeodoraAPI.absoluteUrl(p.image) : '';
          const stockCls = (p.stock ?? 0) < 10 ? 'text-red-700 font-semibold' : 'text-stone-700';
          const badgeHtml = p.badge
            ? `<span class="inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded ml-1">${escapeHtml(p.badge)}</span>`
            : '';
          return `
          <tr class="hover:bg-stone-50/50 transition-colors">
            <td class="py-3 px-5">
              ${imgSrc
                ? `<img src="${escapeHtml(imgSrc)}" alt="" class="w-10 h-10 object-cover rounded border border-stone-200">`
                : '<div class="w-10 h-10 bg-stone-100 rounded border border-stone-200 flex items-center justify-center text-[10px] text-stone-400">Sem</div>'}
            </td>
            <td class="py-3 px-5">
              <div class="font-medium text-stone-900 text-sm leading-snug">${escapeHtml(p.title)}</div>
              <div class="text-xs text-stone-400 mt-0.5">${escapeHtml(p.brandTag || '')}${badgeHtml}</div>
            </td>
            <td class="py-3 px-5 text-xs text-stone-500 font-mono">${escapeHtml(String(p.id || '').slice(0, 8))}</td>
            <td class="py-3 px-5 text-xs text-stone-600">${escapeHtml(p.category || '—')}</td>
            <td class="py-3 px-5 font-mono text-sm font-medium text-stone-900">${money(p.price)}</td>
            <td class="py-3 px-5 text-sm ${stockCls}">${p.stock ?? 0}</td>
            <td class="py-3 px-5 text-xs text-stone-500">${escapeHtml(p.box_name || '—')}</td>
            <td class="py-3 px-5">
              ${p.active
                ? '<span class="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">Ativo</span>'
                : '<span class="text-[11px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded">Rascunho</span>'}
            </td>
            <td class="py-3 px-5 text-right">
              <div class="flex items-center justify-end gap-2">
                <button type="button" onclick="previewSpecificProduct('${escapeHtml(String(p.id))}')"
                  class="text-xs px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-600">👁</button>
                <button type="button" onclick="openEditProduct('${escapeHtml(String(p.id))}')"
                  class="text-xs px-3 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-medium">Editar</button>
                <button type="button" onclick="deleteProduct('${escapeHtml(String(p.id))}')"
                  class="text-xs px-3 py-1 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 font-medium">Excluir</button>
              </div>
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="9" class="py-10 text-center text-sm text-stone-400">Nenhum produto encontrado.</td></tr>';

    const info = document.getElementById('catalog-pagination-info');
    if (info) info.textContent = total > 0 ? `Mostrando ${start + 1} a ${end} de ${total} produto(s)` : 'Nenhum produto';
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    const ctrl = document.getElementById('catalog-pagination-controls');
    if (!ctrl) return;
    const pg = _catalogPage;
    let html = '';
    const btnCls = (disabled) =>
      `px-2.5 py-1.5 text-xs border border-stone-200 rounded transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-stone-50'}`;
    html += `<button type="button" onclick="window._cpg(${pg - 1})" ${pg <= 1 ? 'disabled' : ''} class="${btnCls(pg <= 1)}">←</button>`;
    const s = Math.max(1, pg - 2), e = Math.min(totalPages, pg + 2);
    if (s > 1) html += `<button type="button" onclick="window._cpg(1)" class="${btnCls(false)}">1</button>`;
    if (s > 2) html += `<span class="px-1 text-stone-400 text-xs">…</span>`;
    for (let i = s; i <= e; i++) {
      html += `<button type="button" onclick="window._cpg(${i})" class="px-2.5 py-1.5 text-xs border rounded ${i === pg ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 hover:bg-stone-50'}">${i}</button>`;
    }
    if (e < totalPages - 1) html += `<span class="px-1 text-stone-400 text-xs">…</span>`;
    if (e < totalPages) html += `<button type="button" onclick="window._cpg(${totalPages})" class="${btnCls(false)}">${totalPages}</button>`;
    html += `<button type="button" onclick="window._cpg(${pg + 1})" ${pg >= totalPages ? 'disabled' : ''} class="${btnCls(pg >= totalPages)}">→</button>`;
    ctrl.innerHTML = html;
  }
  window._cpg = function (page) {
    const tot = Math.ceil(_filteredProducts.length / _catalogPerPage);
    _catalogPage = Math.max(1, Math.min(page, tot || 1));
    renderProductTable();
  };

  function handleCatalogSearch(q) {
    _catalogFilters.q = q;
    clearTimeout(window._sd);
    window._sd = setTimeout(() => runSafe(() => loadProducts()).catch(() => {}), 350);
  }
  function handleCatalogCategoryChange(val) {
    _catalogFilters.category = val;
    runSafe(() => loadProducts()).catch(() => {});
  }
  function handleCatalogStatusChange(val) {
    _catalogFilters.status = val;
    runSafe(() => loadProducts()).catch(() => {});
  }
  function handleCatalogPerPageChange(val) {
    _catalogPerPage = Number(val) || 8;
    _catalogPage = 1;
    renderProductTable();
  }

  // ============================================================
  // PRODUTOS — FORMULÁRIO
  // ============================================================

  function openNewProductForm() {
    const fields = {
      prod_edit_id: '',
      prod_titulo: '',
      prod_marca: '',
      prod_volume: '100ml',
      prod_categoria: 'perfumes',
      prod_selo: 'sem_selo',
      prod_preco: '',
      prod_preco_antigo: '',
      prod_estoque: '50',
      prod_ativo: 'sim',
      prod_familia: 'oriental_gourmand',
      prod_concentracao: 'Eau de Parfum',
      prod_ocasiao: 'noite',
      prod_sensacao: 'romantico',
      prod_notas_saida: '',
      prod_notas_coracao: '',
      prod_notas_fundo: '',
      prod_descricao: '',
      prod_ritual: '',
      prod_ingredientes: '',
      prod_peso_manual: '0.38',
      prod_altura: '',
      prod_largura: '',
      prod_comprimento: '',
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
    const heading = document.getElementById('form-product-heading');
    if (heading) heading.textContent = 'Novo produto';
    const bc = document.getElementById('breadcrumb-current');
    if (bc) bc.textContent = 'Produtos / Novo';
    renderGallery(null);
    populateBoxSelect(null);
    document.getElementById('product-list-container').classList.add('hidden');
    document.getElementById('product-form-container').classList.remove('hidden');
    calculateDiscount();
  }

  async function openEditProduct(id) {
    document.getElementById('product-list-container').classList.add('hidden');
    document.getElementById('product-form-container').classList.remove('hidden');
    const bc = document.getElementById('breadcrumb-current');
    if (bc) bc.textContent = 'Produtos / Carregando…';
    try {
      const data = await TeodoraAPI.api(`/api/admin/products/${id}`);
      const p = data.product || {};
      const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = (val ?? ''); };
      set('prod_edit_id', p.id || '');
      set('prod_titulo', p.title || '');
      set('prod_marca', p.brandTag || '');
      set('prod_volume', p.volume || '');
      set('prod_categoria', p.category || 'perfumes');
      set('prod_selo', BADGE_IN[p.badge || ''] || 'sem_selo');
      set('prod_preco', p.price ?? '');
      set('prod_preco_antigo', p.oldPrice ?? '');
      set('prod_estoque', p.stock ?? 0);
      set('prod_ativo', p.active !== false ? 'sim' : 'nao');
      set('prod_familia', FAMILY_IN[p.family || ''] || 'oriental_gourmand');
      set('prod_concentracao', INTENSITY_IN[p.intensity || ''] || 'Eau de Parfum');
      set('prod_ocasiao', ({ noite: 'noite', dia: 'dia', festa: 'encontros' })[p.occasion] || p.occasion || 'noite');
      set('prod_sensacao', ({ romantico: 'romantico', marcante: 'sedutor', fresco: 'fresco', elegante: 'elegante' })[p.sensation] || p.sensation || 'romantico');
      set('prod_notas_saida', p.pyramid?.top || '');
      set('prod_notas_coracao', p.pyramid?.heart || '');
      set('prod_notas_fundo', p.pyramid?.base || '');
      set('prod_descricao', p.description || '');
      set('prod_ritual', p.ritual || '');
      set('prod_ingredientes', p.ingredients || '');
      set('prod_peso_manual', p.weightKg ?? 0.38);
      set('prod_altura', p.heightCm ?? '');
      set('prod_largura', p.widthCm ?? '');
      set('prod_comprimento', p.lengthCm ?? '');
      const heading = document.getElementById('form-product-heading');
      if (heading) heading.textContent = p.title || 'Editar produto';
      if (bc) bc.textContent = `Produtos / ${escapeHtml(p.title || 'Editar')}`;
      renderGallery(p);
      populateBoxSelect(p.box_id || null);
      calculateDiscount();
    } catch (err) {
      showToast('Erro ao carregar produto: ' + (err.message || ''), 'error');
    }
  }

  function closeProductForm() {
    document.getElementById('product-list-container').classList.remove('hidden');
    document.getElementById('product-form-container').classList.add('hidden');
    const bc = document.getElementById('breadcrumb-current');
    if (bc) bc.textContent = 'Produtos';
    runSafe(() => loadProducts(false)).catch(() => {});
  }

  async function handleSaveProduct(event) {
    if (event && event.preventDefault) event.preventDefault();
    const id = document.getElementById('prod_edit_id').value;
    const g = (elId) => { const el = document.getElementById(elId); return el ? el.value : ''; };
    const payload = {
      title: g('prod_titulo').trim(),
      brand_tag: g('prod_marca').trim(),
      volume: g('prod_volume').trim(),
      category_slug: g('prod_categoria'),
      badge: BADGE_OUT[g('prod_selo')] ?? '',
      price: parseFloat(g('prod_preco')) || 0,
      old_price: parseFloat(g('prod_preco_antigo')) || null,
      stock: parseInt(g('prod_estoque')) || 0,
      active: g('prod_ativo') === 'sim',
      family: FAMILY_OUT[g('prod_familia')] || g('prod_familia'),
      intensity: INTENSITY_OUT[g('prod_concentracao')] || 'edp',
      occasion: ({ noite: 'noite', dia: 'dia', encontros: 'festa', verao: 'dia', festa: 'festa' })[g('prod_ocasiao')] || 'dia',
      sensation: ({ romantico: 'romantico', sedutor: 'marcante', fresco: 'fresco', elegante: 'elegante', marcante: 'marcante' })[g('prod_sensacao')] || 'romantico',
      pyramid_top: g('prod_notas_saida').trim(),
      pyramid_heart: g('prod_notas_coracao').trim(),
      pyramid_base: g('prod_notas_fundo').trim(),
      description: g('prod_descricao').trim(),
      ritual: g('prod_ritual').trim(),
      ingredients: g('prod_ingredientes').trim(),
      weight_kg: parseFloat(g('prod_peso_manual')) || 0,
      height_cm: parseFloat(g('prod_altura')) || null,
      width_cm: parseFloat(g('prod_largura')) || null,
      length_cm: parseFloat(g('prod_comprimento')) || null,
    };
    if (!payload.old_price) payload.old_price = null;

    try {
      let productId = id;
      if (id) {
        await TeodoraAPI.api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Produto atualizado com sucesso!');
      } else {
        const created = await TeodoraAPI.api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
        productId = created.product?.id || created.id;
        document.getElementById('prod_edit_id').value = productId || '';
        const heading = document.getElementById('form-product-heading');
        if (heading) heading.textContent = payload.title || 'Produto criado';
        const bc = document.getElementById('breadcrumb-current');
        if (bc) bc.textContent = `Produtos / ${escapeHtml(payload.title || 'Novo')}`;
        showToast('Produto criado! Agora adicione as fotos abaixo.');
      }
      if (productId) {
        const fresh = await TeodoraAPI.api(`/api/admin/products/${productId}`);
        renderGallery(fresh.product || {});
      }
    } catch (err) {
      showToast(err.message || 'Erro ao salvar produto.', 'error');
    }
  }

  // ============================================================
  // GALERIA DE FOTOS
  // ============================================================

  let _pendingPhotos = [];
  let _pendingCoverKey = null;
  let _galleryProduct = null;
  let _pendingKeySeq = 0;

  function clearPendingPhotos() {
    _pendingPhotos.forEach((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
    });
    _pendingPhotos = [];
    _pendingCoverKey = null;
  }

  function updateGalleryFileLabel() {
    const label = document.getElementById('gallery-file-names');
    if (!label) return;
    if (!_pendingPhotos.length) {
      label.textContent = 'Nenhum arquivo selecionado.';
      return;
    }
    const names = _pendingPhotos.map((p) => p.file.name);
    label.textContent = names.length === 1
      ? names[0]
      : `${names.length} arquivos: ${names.join(', ')}`;
  }

  function handleGalleryFilesSelected(event) {
    const input = event?.target || document.getElementById('input_nova_foto_file');
    const files = [...(input?.files || [])].filter((f) => {
      if (!f) return false;
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|gif)$/i.test(f.name || '');
    });
    if (!files.length) {
      showToast('Selecione imagens JPG, PNG, WEBP ou GIF.', 'error');
      return;
    }

    files.forEach((file) => {
      _pendingKeySeq += 1;
      const key = `p${_pendingKeySeq}`;
      _pendingPhotos.push({
        key,
        file,
        url: URL.createObjectURL(file),
      });
      if (!_pendingCoverKey) _pendingCoverKey = key;
    });

    if (input) input.value = '';
    updateGalleryFileLabel();
    paintGalleryGrid();
  }

  function bindGalleryUploadControls() {
    const fileInput = document.getElementById('input_nova_foto_file');
    const sendBtn = document.getElementById('btn_upload_fotos');
    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = '1';
      fileInput.addEventListener('change', handleGalleryFilesSelected);
    }
    if (sendBtn && !sendBtn.dataset.bound) {
      sendBtn.dataset.bound = '1';
      sendBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        uploadGalleryFile();
      });
    }
  }

  function paintGalleryGrid() {
    const grid = document.getElementById('gallery-grid');
    const counter = document.getElementById('gallery-counter');
    if (!grid) return;

    const product = _galleryProduct;
    const hasProduct = Boolean(product && product.id);
    const saved = hasProduct ? (product.images || []) : [];
    const pending = _pendingPhotos;

    if (counter) counter.textContent = `${saved.length + pending.length} foto(s)`;

    if (!saved.length && !pending.length) {
      grid.innerHTML = hasProduct
        ? '<div class="col-span-6 text-center text-xs text-stone-400 py-4 italic">Nenhuma foto. Escolha os arquivos para visualizar e marcar a capa.</div>'
        : '<div class="col-span-6 py-6 text-center text-xs text-stone-400 italic">Salve o produto para enviar fotos à galeria. Você já pode escolher e visualizar as fotos.</div>';
      return;
    }

    const pendingHtml = pending.map((item) => {
      const isCover = item.key === _pendingCoverKey;
      const src = escapeHtml(item.url);
      const key = escapeHtml(item.key);
      return `
        <div class="rounded border ${isCover ? 'border-stone-900 ring-2 ring-stone-900' : 'border-amber-300'} overflow-hidden bg-stone-50">
          <div class="relative aspect-square bg-stone-50">
            <img class="gallery-thumb-img w-full h-full object-cover" src="${src}" alt="">
            ${isCover ? '<div class="absolute top-1 left-1 text-[9px] font-bold bg-stone-900 text-white px-1.5 py-0.5 rounded">CAPA</div>' : ''}
            <div class="absolute top-1 right-1 text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">NOVA</div>
          </div>
          <div class="p-1.5 flex flex-col gap-1 bg-white border-t border-stone-100">
            ${isCover
              ? '<span class="text-[10px] text-center font-semibold text-emerald-800 py-1">Foto de capa</span>'
              : `<button type="button" onclick="setPendingCover('${key}')" class="text-[10px] py-1 rounded bg-stone-900 text-white font-semibold hover:bg-black">Usar como capa</button>`}
            <button type="button" onclick="removePendingPhoto('${key}')" class="text-[10px] py-1 rounded border border-stone-200 text-stone-600 font-semibold hover:bg-stone-50">Remover</button>
          </div>
        </div>`;
    }).join('');

    const savedHtml = saved.map((img) => {
      const src = escapeHtml(TeodoraAPI.absoluteUrl(img.url));
      const pid = escapeHtml(String(product.id));
      const iid = escapeHtml(String(img.id));
      const isCover = Boolean(Number(img.is_cover)) && !_pendingCoverKey;
      return `
        <div class="rounded border ${isCover ? 'border-stone-900 ring-2 ring-stone-900' : 'border-stone-200'} overflow-hidden bg-stone-50">
          <div class="relative aspect-square bg-stone-50">
            <img class="gallery-thumb-img w-full h-full object-cover" src="${src}" alt="">
            ${isCover ? '<div class="absolute top-1 left-1 text-[9px] font-bold bg-stone-900 text-white px-1.5 py-0.5 rounded">CAPA</div>' : ''}
          </div>
          <div class="p-1.5 flex flex-col gap-1 bg-white border-t border-stone-100">
            ${isCover
              ? '<span class="text-[10px] text-center font-semibold text-emerald-800 py-1">Foto de capa</span>'
              : `<button type="button" onclick="setGalleryCover('${pid}','${iid}')" class="text-[10px] py-1 rounded bg-stone-900 text-white font-semibold hover:bg-black">Usar como capa</button>`}
            <button type="button" onclick="deleteGalleryImage('${pid}','${iid}')" class="text-[10px] py-1 rounded border border-red-200 text-red-700 font-semibold hover:bg-red-50">Excluir</button>
          </div>
        </div>`;
    }).join('');

    grid.innerHTML = pendingHtml + savedHtml;
  }

  function renderGallery(product) {
    bindGalleryUploadControls();
    const hint = document.getElementById('gallery-upload-hint');
    const nextId = product && product.id ? String(product.id) : '';
    const prevId = _galleryProduct && _galleryProduct.id ? String(_galleryProduct.id) : '';
    // Limpa só ao trocar de produto ou ao abrir formulário novo — mantém preview ao salvar o 1º vez
    if ((prevId && nextId && nextId !== prevId) || (!nextId && prevId)) clearPendingPhotos();
    _galleryProduct = product && product.id ? product : null;

    if (hint) {
      hint.textContent = _galleryProduct
        ? 'Ao selecionar, as fotos aparecem abaixo. Marque a capa e clique em Enviar.'
        : 'Você pode escolher e visualizar as fotos agora; para enviar, salve o produto antes.';
    }

    updateGalleryFileLabel();
    paintGalleryGrid();
  }

  window.pickGalleryFiles = function () {
    const fileInput = document.getElementById('input_nova_foto_file');
    if (fileInput) fileInput.click();
  };

  window.setPendingCover = function (key) {
    if (!_pendingPhotos.some((p) => p.key === key)) return;
    _pendingCoverKey = key;
    paintGalleryGrid();
  };

  window.removePendingPhoto = function (key) {
    const idx = _pendingPhotos.findIndex((p) => p.key === key);
    if (idx < 0) return;
    URL.revokeObjectURL(_pendingPhotos[idx].url);
    _pendingPhotos.splice(idx, 1);
    if (_pendingCoverKey === key) {
      _pendingCoverKey = _pendingPhotos[0]?.key || null;
    }
    updateGalleryFileLabel();
    paintGalleryGrid();
  };

  async function uploadGalleryFile() {
    const productId = document.getElementById('prod_edit_id')?.value;
    if (!productId) { showToast('Salve o produto antes de enviar fotos.', 'error'); return; }
    if (!_pendingPhotos.length) { showToast('Clique em Escolher fotos e selecione os arquivos.', 'error'); return; }

    const btn = document.getElementById('btn_upload_fotos');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

    const queue = [..._pendingPhotos];
    const coverKey = _pendingCoverKey;
    const coverFirst = coverKey
      ? [...queue.filter((p) => p.key === coverKey), ...queue.filter((p) => p.key !== coverKey)]
      : queue;

    let ok = 0;
    let coverImageId = null;
    try {
      for (const item of coverFirst) {
        const fd = new FormData();
        fd.append('file', item.file);
        const res = await TeodoraAPI.apiForm(`/api/admin/products/${productId}/images`, fd);
        ok += 1;
        if (item.key === coverKey && res?.image?.id) coverImageId = res.image.id;
      }

      if (coverImageId) {
        try {
          await TeodoraAPI.api(`/api/admin/products/${productId}/images/${coverImageId}`, { method: 'PATCH' });
        } catch (_) { /* capa já pode ter sido a primeira */ }
      }

      clearPendingPhotos();
      updateGalleryFileLabel();
      showToast(ok === 1 ? 'Foto enviada.' : `${ok} fotos enviadas.`);
      const fresh = await TeodoraAPI.api(`/api/admin/products/${productId}`);
      renderGallery(fresh.product || {});
    } catch (err) {
      showToast(err.message || 'Erro ao enviar foto.', 'error');
      paintGalleryGrid();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
    }
  }

  window.uploadGalleryFile = uploadGalleryFile;
  window.addPhoto = window.pickGalleryFiles;

  window.setGalleryCover = async function (productId, imageId) {
    try {
      _pendingCoverKey = null;
      await TeodoraAPI.api(`/api/admin/products/${productId}/images/${imageId}`, { method: 'PATCH' });
      showToast('Capa atualizada.');
      const fresh = await TeodoraAPI.api(`/api/admin/products/${productId}`);
      renderGallery(fresh.product || {});
    } catch (err) { showToast(err.message || 'Erro ao definir capa.', 'error'); }
  };

  window.deleteGalleryImage = async function (productId, imageId) {
    if (!confirm('Excluir esta foto do produto e do Storage?')) return;
    try {
      await TeodoraAPI.api(`/api/admin/products/${productId}/images/${imageId}`, { method: 'DELETE' });
      showToast('Foto excluída.');
      const fresh = await TeodoraAPI.api(`/api/admin/products/${productId}`);
      _galleryProduct = fresh.product || null;
      paintGalleryGrid();
    } catch (err) { showToast(err.message || 'Erro ao excluir foto.', 'error'); }
  };

  // ============================================================
  // TÍTULO AUTOMÁTICO & CÁLCULO DE DESCONTO
  // ============================================================

  function autoGenerateTitle(force) {
    const titleEl = document.getElementById('prod_titulo');
    if (!titleEl) return;
    if (!force && titleEl.value.trim()) return;
    const brand = document.getElementById('prod_marca')?.value?.trim() || '';
    const volume = document.getElementById('prod_volume')?.value?.trim() || '';
    const conc = document.getElementById('prod_concentracao')?.value || '';
    if (!brand) return;
    titleEl.value = [brand, volume, conc].filter(Boolean).join(' ');
  }

  function calculateDiscount() {
    const price = parseFloat(document.getElementById('prod_preco')?.value) || 0;
    const oldPrice = parseFloat(document.getElementById('prod_preco_antigo')?.value) || 0;
    const badge = document.getElementById('discount-badge');
    const instPrev = document.getElementById('installment-preview');
    const pixPrev = document.getElementById('pix-preview');
    if (badge) {
      if (oldPrice > price && price > 0) {
        const diff = oldPrice - price;
        const pct = Math.round((diff / oldPrice) * 100);
        badge.textContent = `-R$ ${diff.toFixed(2).replace('.', ',')} (${pct}% OFF)`;
        badge.className = 'inline-flex items-center font-mono font-medium bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px]';
      } else {
        badge.textContent = 'Sem desconto aplicado';
        badge.className = 'inline-flex items-center font-mono font-medium bg-stone-100 text-stone-500 px-2 py-0.5 rounded text-[11px]';
      }
    }
    if (instPrev && price > 0) instPrev.textContent = `Até 6x de R$ ${(price / 6).toFixed(2).replace('.', ',')} sem juros`;
    if (pixPrev && price > 0) pixPrev.textContent = `R$ ${(price * 0.95).toFixed(2).replace('.', ',')} no Pix (5% OFF)`;
  }

  async function toggleProductStatus(id, active) {
    try {
      await TeodoraAPI.api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
      showToast(active ? 'Produto ativado.' : 'Produto desativado.');
      await loadProducts(false);
    } catch (err) { showToast(err.message || 'Erro ao alterar status.', 'error'); }
  }

  async function deleteProduct(id) {
    if (!confirm('Excluir produto? Esta ação não pode ser desfeita.')) return;
    try {
      const result = await TeodoraAPI.api(`/api/admin/products/${id}`, { method: 'DELETE' });
      showToast(result.archived ? 'Produto com histórico foi desativado.' : 'Produto excluído.');
      await loadProducts(false);
    } catch (err) { showToast(err.message || 'Erro ao excluir produto.', 'error'); }
  }

  // ============================================================
  // CATEGORIAS
  // ============================================================

  const MAX_CATEGORIES = 8;
  let _catPendingFile = null;
  let _catPendingPreviewUrl = null;

  function bindCategoryPhotoControls() {
    const input = document.getElementById('cat_foto_file');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (_catPendingPreviewUrl) URL.revokeObjectURL(_catPendingPreviewUrl);
      _catPendingPreviewUrl = null;
      _catPendingFile = null;
      if (!file) {
        updateCategoryPreview(document.getElementById('cat_url')?.value || '');
        return;
      }
      _catPendingFile = file;
      _catPendingPreviewUrl = URL.createObjectURL(file);
      updateCategoryPreview(_catPendingPreviewUrl);
      const nameEl = document.getElementById('cat_foto_name');
      if (nameEl) nameEl.textContent = file.name;
    });
    const urlInput = document.getElementById('cat_url');
    if (urlInput && !urlInput.dataset.bound) {
      urlInput.dataset.bound = '1';
      urlInput.addEventListener('input', () => {
        if (_catPendingFile) return;
        updateCategoryPreview(urlInput.value.trim());
      });
    }
  }

  function updateCategoryPreview(src) {
    const img = document.getElementById('cat_preview_img');
    const empty = document.getElementById('cat_preview_empty');
    if (!img) return;
    if (src) {
      img.src = src.startsWith('blob:') || src.startsWith('http') || src.startsWith('/')
        ? (src.startsWith('/') ? TeodoraAPI.absoluteUrl(src) : src)
        : src;
      img.classList.remove('hidden');
      if (empty) empty.classList.add('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      if (empty) empty.classList.remove('hidden');
    }
  }

  window.resetCategoryForm = function () {
    _catEditId = null;
    _catPendingFile = null;
    if (_catPendingPreviewUrl) URL.revokeObjectURL(_catPendingPreviewUrl);
    _catPendingPreviewUrl = null;
    ['cat_slug', 'cat_nome', 'cat_url'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('cat_ordem').value = String((_categories.length || 0) + 1);
    document.getElementById('cat_ativa').value = 'Sim';
    const fileInput = document.getElementById('cat_foto_file');
    if (fileInput) fileInput.value = '';
    const nameEl = document.getElementById('cat_foto_name');
    if (nameEl) nameEl.textContent = 'JPG · PNG · WEBP · até 8 MB';
    updateCategoryPreview('');
  };

  async function loadCategories() {
    bindCategoryPhotoControls();
    const data = await TeodoraAPI.api('/api/admin/categories');
    _categories = data.categories || [];
    renderCategoriesTable();
    syncCategorySelects();
    const hint = document.getElementById('categories-limit-hint');
    if (hint) hint.textContent = `${_categories.length}/${MAX_CATEGORIES} categorias`;
    const saveBtn = document.getElementById('cat_save_btn');
    if (saveBtn && !_catEditId) {
      saveBtn.disabled = _categories.length >= MAX_CATEGORIES;
      saveBtn.title = _categories.length >= MAX_CATEGORIES
        ? 'Limite de categorias atingido'
        : '';
    }
    if (!_catEditId) resetCategoryForm();
  }

  function syncCategorySelects() {
    const options = _categories.map((c) =>
      `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`
    ).join('');
    const filter = document.getElementById('catalog-category-filter');
    if (filter) {
      const current = filter.value;
      filter.innerHTML = `<option value="todos">Todas as Categorias</option>${options}`;
      filter.value = current || 'todos';
    }
    const prodCat = document.getElementById('prod_categoria');
    if (prodCat && options) {
      const current = prodCat.value;
      prodCat.innerHTML = options;
      if ([...prodCat.options].some((o) => o.value === current)) prodCat.value = current;
    }
  }

  function renderCategoriesTable() {
    const tbody = document.getElementById('categories-table-body');
    if (!tbody) return;
    const countEl = document.getElementById('categories-count-label');
    if (countEl) countEl.textContent = `${_categories.length}/${MAX_CATEGORIES} categoria(s) · limite da loja`;
    tbody.innerHTML = _categories.length
      ? _categories.map((c) => {
          const thumb = c.image_url
            ? `<img src="${escapeHtml(TeodoraAPI.absoluteUrl(c.image_url))}" alt="" class="w-10 h-10 rounded object-cover border border-stone-200">`
            : '<div class="w-10 h-10 rounded bg-stone-100 border border-stone-200"></div>';
          return `
        <tr class="hover:bg-stone-50/50 transition-colors">
          <td class="py-3.5 px-6">${thumb}</td>
          <td class="py-3.5 px-6 font-mono text-xs">${escapeHtml(String(c.sort_order ?? 0))}</td>
          <td class="py-3.5 px-6"><code class="text-xs bg-stone-100 px-1.5 py-0.5 rounded">${escapeHtml(c.slug)}</code></td>
          <td class="py-3.5 px-6 font-medium text-sm">${escapeHtml(c.name)}</td>
          <td class="py-3.5 px-6">
            ${c.active
              ? '<span class="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">Ativa</span>'
              : '<span class="text-[11px] font-semibold text-stone-400 bg-stone-100 px-2 py-0.5 rounded">Inativa</span>'}
          </td>
          <td class="py-3.5 px-6 text-right">
            <div class="flex items-center justify-end gap-2">
              <button type="button" onclick="editCategory('${escapeHtml(String(c.id))}')"
                class="text-xs px-3 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-medium">Editar</button>
              <button type="button" onclick="deleteCategory('${escapeHtml(String(c.id))}')"
                class="text-xs px-3 py-1 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 font-medium">Excluir</button>
            </div>
          </td>
        </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="py-8 text-center text-xs text-stone-400">Nenhuma categoria cadastrada.</td></tr>';
  }

  async function handleSaveCategory(event) {
    event.preventDefault();
    if (!_catEditId && _categories.length >= MAX_CATEGORIES) {
      showToast(`Limite de ${MAX_CATEGORIES} categorias. Exclua uma antes de criar outra.`, 'error');
      return;
    }
    const payload = {
      slug: document.getElementById('cat_slug').value.trim(),
      name: document.getElementById('cat_nome').value.trim(),
      sort_order: parseInt(document.getElementById('cat_ordem').value) || 1,
      active: document.getElementById('cat_ativa').value === 'Sim',
      image_url: document.getElementById('cat_url').value.trim() || null,
    };
    const btn = document.getElementById('cat_save_btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
      let categoryId = _catEditId;
      if (_catEditId) {
        const res = await TeodoraAPI.api(`/api/admin/categories/${_catEditId}`, { method: 'PUT', body: JSON.stringify(payload) });
        categoryId = res.category?.id || _catEditId;
        showToast('Categoria atualizada.');
      } else {
        const res = await TeodoraAPI.api('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
        categoryId = res.category?.id;
        showToast('Categoria criada.');
      }
      if (_catPendingFile && categoryId) {
        const fd = new FormData();
        fd.append('file', _catPendingFile);
        await TeodoraAPI.apiForm(`/api/admin/categories/${categoryId}/image`, fd);
        showToast('Foto da categoria enviada.');
      }
      _catEditId = null;
      _catPendingFile = null;
      if (_catPendingPreviewUrl) URL.revokeObjectURL(_catPendingPreviewUrl);
      _catPendingPreviewUrl = null;
      await loadCategories();
    } catch (err) {
      showToast(err.message || 'Erro ao salvar categoria.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar Categoria'; }
    }
  }

  window.editCategory = function (id) {
    const c = _categories.find((x) => String(x.id) === String(id));
    if (!c) return;
    _catEditId = c.id;
    _catPendingFile = null;
    if (_catPendingPreviewUrl) URL.revokeObjectURL(_catPendingPreviewUrl);
    _catPendingPreviewUrl = null;
    document.getElementById('cat_slug').value = c.slug;
    document.getElementById('cat_nome').value = c.name;
    document.getElementById('cat_ordem').value = c.sort_order ?? 1;
    document.getElementById('cat_ativa').value = c.active ? 'Sim' : 'Não';
    document.getElementById('cat_url').value = c.image_url || '';
    const fileInput = document.getElementById('cat_foto_file');
    if (fileInput) fileInput.value = '';
    const nameEl = document.getElementById('cat_foto_name');
    if (nameEl) nameEl.textContent = c.image_url ? 'Foto atual — escolha outra para substituir' : 'JPG · PNG · WEBP · até 8 MB';
    updateCategoryPreview(c.image_url || '');
    const saveBtn = document.getElementById('cat_save_btn');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.title = ''; }
    document.getElementById('cat_slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  window.deleteCategory = async function (id) {
    if (!confirm('Excluir esta categoria?')) return;
    try {
      await TeodoraAPI.api(`/api/admin/categories/${id}`, { method: 'DELETE' });
      showToast('Categoria excluída.');
      _catEditId = null;
      await loadCategories();
    } catch (err) { showToast(err.message || 'Erro ao excluir categoria.', 'error'); }
  };

  // ============================================================
  // CAIXAS DE ENVIO (localStorage)
  // ============================================================

  const BOXES_KEY = 'teodora_shipping_boxes';

  function loadBoxesFromStorage() {
    try { _boxes = JSON.parse(localStorage.getItem(BOXES_KEY) || '[]'); } catch (_) { _boxes = []; }
  }
  function saveBoxesToStorage() {
    try { localStorage.setItem(BOXES_KEY, JSON.stringify(_boxes)); } catch (_) {}
  }

  function renderBoxesTable() {
    loadBoxesFromStorage();
    const countLabel = document.getElementById('boxes-count-label');
    if (countLabel) countLabel.textContent = `${_boxes.length} modelo(s)`;
    const tbody = document.getElementById('boxes-table-body');
    if (!tbody) return;
    tbody.innerHTML = _boxes.length
      ? _boxes.map((b) => `
        <tr class="hover:bg-stone-50/50 transition-colors">
          <td class="py-3.5 px-6 font-mono text-xs">${escapeHtml(b.codigo || '—')}</td>
          <td class="py-3.5 px-6 font-medium text-sm">
            ${escapeHtml(b.nome)}
            ${b.isDefault ? '<span class="ml-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Padrão</span>' : ''}
          </td>
          <td class="py-3.5 px-6 font-mono text-xs">${b.altura ?? '—'} × ${b.largura ?? '—'} × ${b.comprimento ?? '—'} cm</td>
          <td class="py-3.5 px-6 font-mono text-xs">${b.tara ? `${b.tara} kg` : '—'}</td>
          <td class="py-3.5 px-6 text-xs text-stone-500">${escapeHtml(b.desc || '—')}</td>
          <td class="py-3.5 px-6"><span class="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">Ativa</span></td>
          <td class="py-3.5 px-6 text-right">
            <div class="flex items-center justify-end gap-2">
              <button type="button" onclick="editBox('${escapeHtml(String(b.id))}')"
                class="text-xs px-3 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-medium">Editar</button>
              <button type="button" onclick="deleteBox('${escapeHtml(String(b.id))}')"
                class="text-xs px-3 py-1 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 font-medium">Excluir</button>
            </div>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="py-8 text-center text-xs text-stone-400">Nenhuma caixa cadastrada. Use o formulário acima.</td></tr>';
  }

  function resetBoxForm() {
    document.getElementById('box_edit_id').value = '';
    const title = document.getElementById('box-form-title');
    if (title) title.textContent = 'Adicionar Modelo de Embalagem';
    document.getElementById('boxForm').reset();
  }

  function handleSaveBox(event) {
    event.preventDefault();
    const editId = document.getElementById('box_edit_id').value;
    const box = {
      id: editId || String(Date.now()),
      nome: document.getElementById('box_nome').value.trim(),
      codigo: document.getElementById('box_codigo').value.trim(),
      desc: document.getElementById('box_desc').value.trim(),
      altura: parseFloat(document.getElementById('box_altura').value) || 0,
      largura: parseFloat(document.getElementById('box_largura').value) || 0,
      comprimento: parseFloat(document.getElementById('box_comprimento').value) || 0,
      tara: parseFloat(document.getElementById('box_tara').value) || 0,
      isDefault: document.getElementById('box_default').checked,
    };
    if (box.isDefault) _boxes.forEach((b) => (b.isDefault = false));
    if (editId) {
      const idx = _boxes.findIndex((b) => String(b.id) === editId);
      if (idx >= 0) _boxes[idx] = box; else _boxes.push(box);
    } else {
      _boxes.push(box);
    }
    saveBoxesToStorage();
    renderBoxesTable();
    resetBoxForm();
    showToast('Caixa salva com sucesso!');
  }

  window.editBox = function (id) {
    const b = _boxes.find((x) => String(x.id) === String(id));
    if (!b) return;
    document.getElementById('box_edit_id').value = b.id;
    const title = document.getElementById('box-form-title');
    if (title) title.textContent = `Editar: ${b.nome}`;
    document.getElementById('box_nome').value = b.nome;
    document.getElementById('box_codigo').value = b.codigo || '';
    document.getElementById('box_desc').value = b.desc || '';
    document.getElementById('box_altura').value = b.altura || '';
    document.getElementById('box_largura').value = b.largura || '';
    document.getElementById('box_comprimento').value = b.comprimento || '';
    document.getElementById('box_tara').value = b.tara || '';
    document.getElementById('box_default').checked = !!b.isDefault;
    document.getElementById('box_nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  window.deleteBox = function (id) {
    if (!confirm('Excluir esta caixa?')) return;
    _boxes = _boxes.filter((b) => String(b.id) !== String(id));
    saveBoxesToStorage();
    renderBoxesTable();
    showToast('Caixa excluída.');
  };

  function populateBoxSelect(selectedId) {
    loadBoxesFromStorage();
    const sel = document.getElementById('prod_caixa_id');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione uma caixa…</option>';
    _boxes.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.nome} (${b.altura}×${b.largura}×${b.comprimento} cm)`;
      if (selectedId ? String(b.id) === String(selectedId) : b.isDefault) opt.selected = true;
      sel.appendChild(opt);
    });
    selectProductBox(sel.value);
  }

  function selectProductBox(boxId) {
    loadBoxesFromStorage();
    const b = _boxes.find((x) => String(x.id) === String(boxId));
    const dimLabel = document.getElementById('current-box-dimensions-label');
    if (!b) {
      if (dimLabel) dimLabel.textContent = '— cm';
      return;
    }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('prod_altura', b.altura);
    set('prod_largura', b.largura);
    set('prod_comprimento', b.comprimento);
    if (dimLabel) dimLabel.textContent = `${b.altura} × ${b.largura} × ${b.comprimento} cm`;
    updateShippingWeights();
  }

  function updateShippingWeights() {
    loadBoxesFromStorage();
    const peso = parseFloat(document.getElementById('prod_peso_manual')?.value) || 0;
    const boxId = document.getElementById('prod_caixa_id')?.value;
    const b = _boxes.find((x) => String(x.id) === String(boxId));
    const tara = b ? (parseFloat(b.tara) || 0) : 0;
    const total = peso + tara;
    const fmt = (v) => v.toFixed(2).replace('.', ',');
    const sp = document.getElementById('summary-prod-weight');
    const sb = document.getElementById('summary-box-tare');
    const st = document.getElementById('summary-total-weight');
    if (sp) sp.textContent = `${fmt(peso)} kg`;
    if (sb) sb.textContent = `${fmt(tara)} kg`;
    if (st) st.textContent = `${fmt(total)} kg`;
  }

  // ============================================================
  // PEDIDOS / VENDAS
  // ============================================================

  function statusBadge(status) {
    const map = {
      pending: 'bg-amber-100 text-amber-800',
      approved: 'bg-emerald-100 text-emerald-800',
      rejected: 'bg-red-100 text-red-700',
      shipped: 'bg-blue-100 text-blue-800',
      delivered: 'bg-stone-900 text-white',
      cancelled: 'bg-stone-100 text-stone-500',
    };
    const cls = map[status] || 'bg-stone-100 text-stone-500';
    return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded ${cls}">${escapeHtml(status || '—')}</span>`;
  }

  async function loadOrders() {
    const filterSel = document.getElementById('orders-status-filter');
    const statusFilter = filterSel ? filterSel.value : '';
    const url = `/api/admin/orders${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`;
    const data = await TeodoraAPI.api(url);
    const orders = data.orders || [];

    const pending = orders.filter((o) => o.status === 'pending').length;
    const badge = document.getElementById('nav-orders-badge');
    if (badge) { badge.textContent = pending; badge.classList.toggle('hidden', pending === 0); }
    const pendingLabel = document.getElementById('orders-pending-label');
    if (pendingLabel) pendingLabel.textContent = `${pending} pendente(s) · ${orders.length} total`;

    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;

    tbody.innerHTML = orders.length
      ? orders.map((o) => {
          const items = o.items || [];
          const summary = items.slice(0, 2).map((i) => `${i.quantity}× ${escapeHtml(i.title || '')}`).join(', ')
            + (items.length > 2 ? ` +${items.length - 2} mais` : '');
          const oid = escapeHtml(String(o.id));
          return `
          <tr class="hover:bg-stone-50/50 transition-colors">
            <td class="py-3 px-6">
              <div class="font-mono text-xs font-medium text-stone-800">#${oid.slice(0, 8)}</div>
              <div class="text-[11px] text-stone-400 mt-0.5">${fmtDate(o.created_at)}</div>
            </td>
            <td class="py-3 px-6">
              <div class="text-sm font-medium text-stone-800">${escapeHtml(o.payer_name || '—')}</div>
              <div class="text-xs text-stone-400">${escapeHtml(o.payer_email || '')}</div>
            </td>
            <td class="py-3 px-6 text-xs text-stone-600">${summary || '—'}</td>
            <td class="py-3 px-6 font-mono text-xs">${money(o.shipping_cost || 0)}</td>
            <td class="py-3 px-6 font-mono text-sm font-semibold text-stone-900">${money(o.total)}</td>
            <td class="py-3 px-6 text-xs text-stone-500 font-mono">${escapeHtml(o.mp_payment_id || '—')}</td>
            <td class="py-3 px-6">
              <select data-oid="${oid}" class="_osel text-xs px-2 py-1 border border-stone-200 rounded bg-white">
                ${['pending','approved','rejected','shipped','delivered','cancelled'].map((s) =>
                  `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
                ).join('')}
              </select>
            </td>
            <td class="py-3 px-6 text-right">
              <div class="flex items-center justify-end gap-2">
                <button type="button" onclick="saveOrderStatus('${oid}')"
                  class="text-xs px-3 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-medium">Salvar</button>
                <button type="button" onclick="showOrderDetail('${oid}')"
                  class="text-xs px-3 py-1 rounded bg-stone-900 text-white hover:bg-black font-medium">Detalhes</button>
              </div>
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="8" class="py-10 text-center text-sm text-stone-400">Nenhum pedido encontrado.</td></tr>';

    const refreshBtn = document.getElementById('orders-refresh-btn');
    if (refreshBtn) refreshBtn.onclick = () => runSafe(() => loadOrders()).catch(() => {});
    if (filterSel) filterSel.onchange = () => runSafe(() => loadOrders()).catch(() => {});
  }

  window.saveOrderStatus = async function (orderId) {
    const sel = document.querySelector(`._osel[data-oid="${orderId}"]`);
    if (!sel) return;
    try {
      await TeodoraAPI.api(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: sel.value }),
      });
      showToast('Status do pedido atualizado.');
    } catch (err) { showToast(err.message || 'Erro ao atualizar status.', 'error'); }
  };

  window.showOrderDetail = async function (orderId) {
    const panel = document.getElementById('order-detail-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="py-8 text-center text-xs text-stone-400">Carregando detalhes…</div>';
    try {
      const data = await TeodoraAPI.api(`/api/admin/orders/${orderId}/detail`);
      const o = data.order || {};
      const snap = o.shipping_snapshot || {};
      const addr = o.payer_address || [snap.street, snap.number, snap.city, snap.state].filter(Boolean).join(', ') || '—';
      const oid = escapeHtml(String(o.id || orderId));

      panel.innerHTML = `
        <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9] flex items-center justify-between">
            <div>
              <h3 class="font-serif text-lg font-medium text-stone-900">Pedido #${oid.slice(0, 8)}</h3>
              <p class="text-xs text-stone-500 mt-0.5">${escapeHtml(o.payer_name || o.payer_email || '')}</p>
            </div>
            <button type="button" onclick="closeOrderDetail()"
              class="px-4 py-2 text-xs uppercase tracking-wider font-semibold rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700">Fechar</button>
          </div>
          <div class="p-6 space-y-6">

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div><span class="text-stone-400 uppercase tracking-wider font-semibold text-[10px] block">Total</span>
                <div class="font-mono font-semibold text-lg text-stone-900 mt-1">${money(o.total)}</div></div>
              <div><span class="text-stone-400 uppercase tracking-wider font-semibold text-[10px] block">Status</span>
                <div class="mt-1">${statusBadge(o.status)}</div></div>
              <div><span class="text-stone-400 uppercase tracking-wider font-semibold text-[10px] block">MP Status</span>
                <div class="font-mono text-stone-700 mt-1">${escapeHtml(o.mp_status || '—')}</div></div>
              <div><span class="text-stone-400 uppercase tracking-wider font-semibold text-[10px] block">Data</span>
                <div class="text-stone-600 mt-1">${fmtDate(o.created_at)}</div></div>
            </div>

            <div class="p-4 bg-stone-50 rounded border border-stone-200 text-xs">
              <span class="font-semibold text-stone-600 uppercase tracking-wider text-[10px] block mb-1">Endereço de Entrega</span>
              <p class="text-stone-700">${escapeHtml(addr)}</p>
              ${o.payer_phone ? `<p class="text-stone-400 mt-0.5">Tel: ${escapeHtml(o.payer_phone)}</p>` : ''}
            </div>

            <div>
              <span class="font-semibold text-stone-600 uppercase tracking-wider text-[10px] block mb-3">Itens do Pedido</span>
              <table class="w-full text-xs">
                <thead><tr class="border-b border-stone-200 text-stone-400 text-[10px] uppercase">
                  <th class="py-2 text-left font-semibold">Produto</th>
                  <th class="py-2 text-center font-semibold">Qtd</th>
                  <th class="py-2 text-right font-semibold">Unit.</th>
                  <th class="py-2 text-right font-semibold">Subtotal</th>
                </tr></thead>
                <tbody class="divide-y divide-stone-100">
                  ${(o.items || []).map((item) => `
                    <tr>
                      <td class="py-2 text-stone-800 font-medium">
                        ${escapeHtml(item.title || '—')}
                        ${item.variant_label ? `<span class="ml-1 text-stone-400 text-[11px]">(${escapeHtml(item.variant_label)})</span>` : ''}
                      </td>
                      <td class="py-2 text-center font-mono">${item.quantity}</td>
                      <td class="py-2 text-right font-mono">${money(item.unit_price)}</td>
                      <td class="py-2 text-right font-mono font-semibold">${money((item.unit_price || 0) * (item.quantity || 0))}</td>
                    </tr>`).join('') || '<tr><td colspan="4" class="py-2 text-center text-stone-400">Sem itens.</td></tr>'}
                </tbody>
                <tfoot><tr class="border-t-2 border-stone-200">
                  <td colspan="3" class="py-2 text-right font-semibold text-stone-600 text-[11px] uppercase">Total do Pedido</td>
                  <td class="py-2 text-right font-mono font-semibold text-stone-900">${money(o.total)}</td>
                </tr></tfoot>
              </table>
            </div>

            ${o.mp_payment_id ? `
            <div class="p-4 bg-stone-50 rounded border border-stone-200 text-xs">
              <span class="font-semibold text-stone-600 uppercase tracking-wider text-[10px] block mb-2">Mercado Pago</span>
              <div class="grid grid-cols-2 gap-2 text-stone-700">
                <div><span class="text-stone-400">Payment ID:</span> <span class="font-mono">${escapeHtml(o.mp_payment_id || '—')}</span></div>
                <div><span class="text-stone-400">Status MP:</span> <span class="font-mono">${escapeHtml(o.mp_status || '—')}</span></div>
                ${o.mp_transaction_id ? `<div><span class="text-stone-400">Transaction:</span> <span class="font-mono">${escapeHtml(o.mp_transaction_id)}</span></div>` : ''}
              </div>
            </div>` : ''}

            <form id="_ff_${oid}" class="space-y-4 p-4 bg-white rounded border border-stone-200">
              <span class="font-semibold text-stone-700 uppercase tracking-wider text-[10px] block">Expedição &amp; Rastreio</span>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Código de Rastreio</label>
                  <input type="text" name="tracking_code" value="${escapeHtml(o.tracking_code || '')}"
                    placeholder="BR123456789BR" class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono">
                </div>
                <div>
                  <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">URL de Rastreio / Etiqueta</label>
                  <input type="url" name="tracking_url" value="${escapeHtml(o.tracking_url || '')}"
                    placeholder="https://…"
                    class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono">
                </div>
              </div>
              <div>
                <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Observações Internas</label>
                <textarea name="admin_notes" rows="3"
                  class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded">${escapeHtml(o.admin_notes || '')}</textarea>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" onclick="saveFulfillment('${oid}')"
                  class="px-5 py-2 text-xs uppercase tracking-wider font-semibold rounded bg-stone-900 hover:bg-black text-white">
                  Salvar Expedição
                </button>
                ${o.tracking_url ? `<a href="${escapeHtml(o.tracking_url)}" target="_blank" rel="noopener" class="px-4 py-2 text-xs uppercase tracking-wider font-semibold rounded border border-stone-300 bg-white hover:bg-stone-50">Abrir etiqueta/PDF</a>` : ''}
              </div>
            </form>

            <div class="space-y-4 p-4 bg-amber-50/50 rounded border border-amber-200/80">
              <span class="font-semibold text-stone-700 uppercase tracking-wider text-[10px] block">Etiqueta CepCerto</span>
              ${(() => {
                const lab = snap.label || {};
                const cost = lab.valor_etiqueta != null ? Number(lab.valor_etiqueta) : null;
                const charged = Number(o.shipping_cost || 0);
                const margin = cost != null ? charged - cost : null;
                if (lab.codigo_objeto && !lab.cancelled) {
                  return `
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                    <div><span class="text-stone-400 uppercase text-[10px] block">Frete pago (cliente)</span><div class="font-mono font-semibold mt-0.5">${money(charged)}</div></div>
                    <div><span class="text-stone-400 uppercase text-[10px] block">Custo etiqueta</span><div class="font-mono font-semibold mt-0.5">${cost != null ? money(cost) : '—'}</div></div>
                    <div><span class="text-stone-400 uppercase text-[10px] block">Margem</span><div class="font-mono font-semibold mt-0.5 ${margin != null && margin >= 0 ? 'text-emerald-800' : 'text-red-700'}">${margin != null ? money(margin) : '—'}</div></div>
                    <div><span class="text-stone-400 uppercase text-[10px] block">Origem</span><div class="font-mono text-[11px] mt-0.5">${escapeHtml(lab.originCep || snap.originCep || '—')}</div></div>
                  </div>
                  <p class="text-xs mb-2"><span class="text-stone-400">Objeto</span> <span class="font-mono font-semibold">${escapeHtml(lab.codigo_objeto)}</span>
                    ${lab.originLabel ? ` · ${escapeHtml(lab.originLabel)}` : ''}</p>
                  <div class="flex flex-wrap gap-2">
                    ${lab.pdf_url_etiqueta ? `<a href="${escapeHtml(lab.pdf_url_etiqueta)}" target="_blank" rel="noopener" class="px-4 py-2 text-xs font-semibold rounded bg-stone-900 text-white">Abrir PDF</a>` : ''}
                    ${lab.pdf_url_dce ? `<a href="${escapeHtml(lab.pdf_url_dce)}" target="_blank" rel="noopener" class="px-4 py-2 text-xs font-semibold rounded border border-stone-300 bg-white">Declaração</a>` : ''}
                    <button type="button" onclick="cancelOrderLabel('${oid}')" class="px-4 py-2 text-xs font-semibold rounded border border-red-200 text-red-700 bg-white hover:bg-red-50">Cancelar etiqueta</button>
                    <button type="button" onclick="generateOrderLabel('${oid}')" class="px-4 py-2 text-xs font-semibold rounded border border-stone-300 bg-white">Reabrir / dados</button>
                  </div>`;
                }
                if (lab.cancelled) {
                  return `<p class="text-xs text-stone-500 mb-2">Etiqueta cancelada (${escapeHtml(lab.codigo_objeto || '')}). Pode gerar outra.</p>`;
                }
                return `<p class="text-[11px] text-stone-500 mb-3">Emite postagem (debita saldo). CEP e nº se faltarem no pedido.</p>`;
              })()}
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label class="block text-[10px] font-semibold uppercase text-stone-600 mb-1">CEP destino</label>
                  <input id="_label_cep_${oid}" value="${escapeHtml(String(snap.cep || (snap.address && snap.address.cep) || ''))}"
                    class="w-full px-3 py-2 text-sm border border-stone-200 rounded font-mono" placeholder="00000000">
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase text-stone-600 mb-1">Serviço</label>
                  <select id="_label_tipo_${oid}" class="w-full px-3 py-2 text-sm border border-stone-200 rounded">
                    ${['pac','sedex','jadlog-package','jadlog-dotcom','loggi'].map((t) =>
                      `<option value="${t}" ${(snap.code || '').replace(/_/g,'-') === t || snap.code === t ? 'selected' : ''}>${t}</option>`
                    ).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] font-semibold uppercase text-stone-600 mb-1">Nº endereço dest.</label>
                  <input id="_label_num_${oid}" value="${escapeHtml(String(snap.address_number || ''))}" placeholder="auto" class="w-full px-3 py-2 text-sm border border-stone-200 rounded font-mono">
                </div>
              </div>
              <button type="button" id="_label_btn_${oid}" onclick="generateOrderLabel('${oid}')"
                class="px-5 py-2 text-xs uppercase tracking-wider font-semibold rounded bg-amber-800 hover:bg-amber-900 text-white">
                ${(snap.label && snap.label.codigo_objeto && !snap.label.cancelled) ? 'Reconsultar etiqueta' : 'Gerar etiqueta'}
              </button>
              <div id="_label_msg_${oid}" class="text-xs text-stone-600"></div>
            </div>

            <div>
              <span class="font-semibold text-stone-600 uppercase tracking-wider text-[10px] block mb-3">Histórico de Status</span>
              <div class="space-y-2">
                ${(o.history || []).map((h) => `
                  <div class="flex items-start gap-3 text-xs">
                    <div class="w-2 h-2 rounded-full bg-stone-400 mt-1 shrink-0"></div>
                    <div>
                      <span class="font-semibold text-stone-800">${escapeHtml(h.new_status || '')}</span>
                      <span class="text-stone-400 ml-2">${fmtDate(h.created_at)} · ${escapeHtml(h.source || '')}</span>
                    </div>
                  </div>`).join('') || '<p class="text-xs text-stone-400">Sem alterações registradas.</p>'}
              </div>
            </div>

          </div>
        </div>`;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      panel.innerHTML = `<div class="py-6 text-center text-sm text-red-600">Erro ao carregar detalhes: ${escapeHtml(err.message || '')}</div>`;
    }
  };

  window.closeOrderDetail = function () {
    const panel = document.getElementById('order-detail-panel');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
  };

  window.saveFulfillment = async function (orderId) {
    const form = document.getElementById(`_ff_${orderId}`);
    if (!form) return;
    const fd = new FormData(form);
    try {
      await TeodoraAPI.api(`/api/admin/orders/${orderId}/fulfillment`, {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(fd)),
      });
      showToast('Dados de expedição salvos.');
    } catch (err) { showToast(err.message || 'Erro ao salvar expedição.', 'error'); }
  };

  window.generateOrderLabel = async function (orderId) {
    const btn = document.getElementById(`_label_btn_${orderId}`);
    const msg = document.getElementById(`_label_msg_${orderId}`);
    const cep = document.getElementById(`_label_cep_${orderId}`)?.value || '';
    const tipo = document.getElementById(`_label_tipo_${orderId}`)?.value || 'pac';
    const num = document.getElementById(`_label_num_${orderId}`)?.value || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Processando…'; }
    if (msg) msg.textContent = '';
    try {
      const payload = { cep_destinatario: cep, tipo_entrega: tipo };
      if (num) payload.numero_endereco_destinatario = num;
      const res = await TeodoraAPI.api(`/api/admin/orders/${orderId}/label`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const label = res.label || {};
      showToast(res.reused ? 'Etiqueta já existia.' : (label.mensagem || 'Etiqueta gerada.'));
      if (msg) {
        const cost = res.label_cost != null ? res.label_cost : label.valor_etiqueta;
        msg.innerHTML = `
          <div class="space-y-1">
            <div><span class="text-stone-400">Objeto:</span> <span class="font-mono font-semibold">${escapeHtml(label.codigo_objeto || '—')}</span></div>
            ${cost != null ? `<div><span class="text-stone-400">Custo:</span> <span class="font-mono font-semibold">${money(cost)}</span>
              ${res.margin != null ? ` · margem ${money(res.margin)}` : ''}</div>` : ''}
            ${label.pdf_url_etiqueta ? `<a class="text-amber-900 underline font-semibold" href="${escapeHtml(label.pdf_url_etiqueta)}" target="_blank" rel="noopener">Baixar PDF</a>` : ''}
          </div>`;
      }
      await showOrderDetail(orderId);
      await loadOrders();
    } catch (err) {
      showToast(err.message || 'Erro ao gerar etiqueta.', 'error');
      if (msg) msg.textContent = err.message || 'Falha na emissão.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Gerar etiqueta'; }
    }
  };

  window.cancelOrderLabel = async function (orderId) {
    if (!confirm('Cancelar a etiqueta no CepCerto? Pode haver estorno de saldo.')) return;
    try {
      const res = await TeodoraAPI.api(`/api/admin/orders/${orderId}/label/cancel`, { method: 'POST', body: '{}' });
      showToast(res.cancel?.mensagem || 'Etiqueta cancelada.');
      await showOrderDetail(orderId);
    } catch (err) {
      showToast(err.message || 'Erro ao cancelar.', 'error');
    }
  };

  // ============================================================
  // CEPCERTO
  // ============================================================

  const ORIGIN_LABELS = {
    pac: 'PAC (Correios)',
    sedex: 'SEDEX',
    jadlog_package: 'Jadlog Package',
    jadlog_com: 'Jadlog .COM',
    loggi: 'Loggi',
    mini_envio: 'Mini Envio',
  };

  async function loadCepCertoPanel() {
    await loadCepCertoStatus();
    await loadCepCertoSpending();
  }

  function renderOriginsForm(origins, codes) {
    const box = document.getElementById('cepcerto-origins-rows');
    if (!box) return;
    const list = codes && codes.length ? codes : Object.keys(ORIGIN_LABELS);
    box.innerHTML = list.map((code) => {
      const o = (origins && origins[code]) || {};
      return `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end" data-origin-code="${escapeHtml(code)}">
          <div>
            <label class="block text-[10px] font-semibold uppercase text-stone-500 mb-1">${escapeHtml(ORIGIN_LABELS[code] || code)}</label>
            <input data-field="cep" value="${escapeHtml(o.cep || '')}" maxlength="9" placeholder="CEP 00000-000"
              class="w-full px-3 py-2 text-sm border border-stone-200 rounded font-mono">
          </div>
          <div class="sm:col-span-2">
            <label class="block text-[10px] font-semibold uppercase text-stone-500 mb-1">Nome do depósito / ponto</label>
            <input data-field="label" value="${escapeHtml(o.label || '')}" placeholder="Ex.: Base Jadlog Guarulhos"
              class="w-full px-3 py-2 text-sm border border-stone-200 rounded">
          </div>
        </div>`;
    }).join('');
  }

  window.loadCepCertoStatus = async function () {
    const grid = document.getElementById('cepcerto-status-grid');
    const badge = document.getElementById('nav-cepcerto-badge');
    const checklist = document.getElementById('cepcerto-checklist');
    try {
      const data = await TeodoraAPI.api('/api/admin/cepcerto/status');
      const shipper = data.shipper || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('shipper_name', shipper.nome_remetente);
      set('shipper_doc', shipper.cpf_cnpj_remetente);
      set('shipper_phone', shipper.whatsapp_remetente);
      set('shipper_email', shipper.email_remetente);
      set('shipper_address_number', shipper.numero_endereco_remetente);
      set('shipper_complement', shipper.complemento_remetente);
      renderOriginsForm(data.origins || {}, data.service_codes);

      const ok = Boolean(data.ready || data.configured);
      if (badge) {
        badge.textContent = data.ready ? 'OK' : (data.configured ? '…' : 'OFF');
        badge.className = data.ready
          ? 'text-[10px] bg-emerald-900/80 text-emerald-200 px-1.5 py-0.5 rounded font-mono'
          : 'text-[10px] bg-amber-900/80 text-amber-200 px-1.5 py-0.5 rounded font-mono';
      }
      if (grid) {
        const saldo = data.saldo?.saldo_atual || '—';
        grid.innerHTML = `
          <div>
            <span class="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Token postagem</span>
            <div class="mt-1 text-sm font-semibold ${data.configured ? 'text-emerald-800' : 'text-amber-800'}">${data.configured ? 'Configurado' : 'Ausente (Railway)'}</div>
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Saldo</span>
            <div class="mt-1 text-sm font-mono font-semibold text-stone-900">${escapeHtml(String(saldo))}</div>
            ${data.saldo?.nome_cliente ? `<div class="text-[11px] text-stone-400 mt-0.5">${escapeHtml(data.saldo.nome_cliente)}</div>` : ''}
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Fallback origem</span>
            <div class="mt-1 text-sm font-mono text-stone-800">${escapeHtml(data.origin_cep || '—')}</div>
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Pronto p/ emitir</span>
            <div class="mt-1 text-sm font-semibold ${data.ready ? 'text-emerald-800' : 'text-amber-800'}">${data.ready ? 'Sim' : 'Não'}</div>
          </div>
          ${data.message ? `<div class="sm:col-span-2 lg:col-span-4 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-3 py-2">${escapeHtml(data.message)}</div>` : ''}`;
      }
      if (checklist) {
        checklist.innerHTML = (data.checklist || []).map((item) =>
          `<li class="flex items-center gap-2 ${item.ok ? 'text-emerald-800' : 'text-amber-800'}">
            <span class="font-mono text-[10px]">${item.ok ? '[ok]' : '[ ]'}</span> ${escapeHtml(item.label)}</li>`
        ).join('') || '';
      }
    } catch (err) {
      if (grid) grid.innerHTML = `<div class="text-sm text-red-600">${escapeHtml(err.message || 'Erro')}</div>`;
    }
  };

  window.loadCepCertoSpending = async function () {
    const grid = document.getElementById('cepcerto-spending-grid');
    if (!grid) return;
    try {
      const data = await TeodoraAPI.api('/api/admin/cepcerto/spending?days=30');
      grid.innerHTML = `
        <div><span class="text-[10px] uppercase text-stone-400 font-semibold">Etiquetas</span>
          <div class="mt-1 font-mono font-semibold text-lg">${data.labels_count || 0}</div></div>
        <div><span class="text-[10px] uppercase text-stone-400 font-semibold">Custo etiquetas</span>
          <div class="mt-1 font-mono font-semibold text-lg">${money(data.label_cost_total || 0)}</div></div>
        <div><span class="text-[10px] uppercase text-stone-400 font-semibold">Frete cobrado</span>
          <div class="mt-1 font-mono font-semibold text-lg">${money(data.freight_charged_total || 0)}</div></div>
        <div><span class="text-[10px] uppercase text-stone-400 font-semibold">Margem</span>
          <div class="mt-1 font-mono font-semibold text-lg ${(data.margin_total || 0) >= 0 ? 'text-emerald-800' : 'text-red-700'}">${money(data.margin_total || 0)}</div></div>`;
    } catch (err) {
      grid.innerHTML = `<div class="text-xs text-red-600">${escapeHtml(err.message || 'Erro')}</div>`;
    }
  };

  window.saveCepCertoOrigins = async function (event) {
    event.preventDefault();
    const rows = document.querySelectorAll('#cepcerto-origins-rows [data-origin-code]');
    const map = {};
    rows.forEach((row) => {
      const code = row.getAttribute('data-origin-code');
      const cep = (row.querySelector('[data-field="cep"]')?.value || '').replace(/\D/g, '');
      const label = (row.querySelector('[data-field="label"]')?.value || '').trim();
      map[code] = { cep, label };
    });
    try {
      await TeodoraAPI.api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ shipping_origins_json: JSON.stringify(map) }),
      });
      showToast('CEPs de origem salvos.');
      await loadCepCertoStatus();
    } catch (err) {
      showToast(err.message || 'Erro ao salvar origens.', 'error');
    }
  };

  window.saveCepCertoShipper = async function (event) {
    event.preventDefault();
    const payload = {
      shipper_name: document.getElementById('shipper_name').value.trim(),
      shipper_doc: document.getElementById('shipper_doc').value.trim(),
      shipper_phone: document.getElementById('shipper_phone').value.trim(),
      shipper_email: document.getElementById('shipper_email').value.trim(),
      shipper_address_number: document.getElementById('shipper_address_number').value.trim(),
      shipper_complement: document.getElementById('shipper_complement').value.trim(),
    };
    try {
      await TeodoraAPI.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Remetente salvo.');
      await loadCepCertoStatus();
    } catch (err) { showToast(err.message || 'Erro ao salvar remetente.', 'error'); }
  };

  window.runCepCertoCredit = async function (event) {
    event.preventDefault();
    const box = document.getElementById('cc_credit_result');
    if (box) box.textContent = 'Gerando PIX…';
    try {
      const data = await TeodoraAPI.api('/api/admin/cepcerto/credit', {
        method: 'POST',
        body: JSON.stringify({ valor: document.getElementById('cc_credit_valor').value }),
      });
      const pix = data.pix_copia_cola || '';
      if (box) {
        box.innerHTML = `
          <p class="font-medium text-stone-800">${escapeHtml(data.mensagem || 'PIX gerado')}</p>
          <p class="text-stone-500">Valor: ${money(data.valor || 0)}</p>
          ${pix ? `<textarea readonly class="w-full mt-2 text-[10px] font-mono border border-stone-200 rounded p-2 h-20">${escapeHtml(pix)}</textarea>
            <button type="button" class="mt-1 text-xs font-semibold underline" onclick="navigator.clipboard.writeText(${JSON.stringify(pix)});showToast('PIX copiado.');">Copiar código</button>` : '<p class="text-amber-800">Resposta sem código PIX — confira o raw no CepCerto.</p>'}`;
      }
      showToast('Cobrança PIX criada. Saldo entra após o pagamento.');
    } catch (err) {
      if (box) box.textContent = err.message || 'Erro';
      showToast(err.message || 'Erro ao gerar crédito', 'error');
    }
  };

  window.runCepCertoQuote = async function (event) {
    event.preventDefault();
    const box = document.getElementById('cc_quote_result');
    if (box) box.textContent = 'Cotando…';
    try {
      const data = await TeodoraAPI.api('/api/admin/cepcerto/quote', {
        method: 'POST',
        body: JSON.stringify({
          cep: document.getElementById('cc_quote_cep').value,
          weight: document.getElementById('cc_quote_weight').value,
          height: document.getElementById('cc_quote_h').value,
          width: document.getElementById('cc_quote_w').value,
          length: document.getElementById('cc_quote_l').value,
          declared_value: document.getElementById('cc_quote_value').value,
        }),
      });
      const addr = data.address || {};
      const opts = data.options || [];
      if (box) {
        box.innerHTML = `
          <p class="font-medium text-stone-800">${escapeHtml([addr.localidade, addr.uf].filter(Boolean).join('/') || 'CEP ok')}${data.demo ? ' · estimativa' : ''}</p>
          <ul class="mt-2 space-y-1">${opts.map((o) =>
            `<li class="flex justify-between gap-4 border-b border-stone-100 py-1">
              <span>${escapeHtml(o.name)}${o.days ? ` · ${escapeHtml(String(o.days))}` : ''}
                ${o.originCep ? `<span class="text-stone-400"> · origem ${escapeHtml(o.originCep)}</span>` : ''}</span>
              <span class="font-mono font-semibold">${money(o.price)}</span></li>`
          ).join('') || '<li class="text-stone-400">Sem opções</li>'}</ul>`;
      }
    } catch (err) {
      if (box) box.textContent = err.message || 'Erro na cotação';
      showToast(err.message || 'Erro na cotação', 'error');
    }
  };

  window.runCepCertoTrack = async function (event) {
    event.preventDefault();
    const box = document.getElementById('cc_track_result');
    if (box) box.textContent = 'Consultando…';
    try {
      const data = await TeodoraAPI.api('/api/admin/cepcerto/track', {
        method: 'POST',
        body: JSON.stringify({ codigo: document.getElementById('cc_track_code').value }),
      });
      const eventos = data.eventos || [];
      if (box) {
        box.innerHTML = `
          <p><span class="text-stone-400">Objeto</span> <span class="font-mono font-semibold">${escapeHtml(data.objeto || '')}</span>
          · ${escapeHtml(data.transportadora || '')}</p>
          ${data.dt_prevista?.texto ? `<p class="text-stone-500">Previsão: ${escapeHtml(data.dt_prevista.texto)}</p>` : ''}
          <ul class="mt-2 space-y-2 border-l border-stone-200 pl-3">
            ${eventos.map((e) => `
              <li>
                <div class="font-medium text-stone-800">${escapeHtml(e.descricao || '')}</div>
                <div class="text-stone-400">${escapeHtml(e.data_br || '')}${e.unidade?.cidade ? ` · ${escapeHtml(e.unidade.cidade)}/${escapeHtml(e.unidade.uf || '')}` : ''}</div>
              </li>`).join('') || '<li class="text-stone-400">Sem eventos</li>'}
          </ul>`;
      }
    } catch (err) {
      if (box) box.textContent = err.message || 'Erro no rastreio';
      showToast(err.message || 'Erro no rastreio', 'error');
    }
  };

  // ============================================================
  // CUPONS
  // ============================================================

  async function loadCoupons() {
    const data = await TeodoraAPI.api('/api/admin/coupons');
    const coupons = data.coupons || [];
    const root = document.getElementById('coupons-root');
    if (!root) return;
    let editId = null;

    root.innerHTML = `
      <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] mb-8 overflow-hidden">
        <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9]">
          <h3 id="_ctitle" class="text-xs font-bold uppercase tracking-widest text-stone-800">Novo Cupom</h3>
        </div>
        <form id="_cform" class="p-6 space-y-5">
          <input type="hidden" id="_cid">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Código</label>
              <input type="text" id="_ccode" required placeholder="PROMO10"
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono uppercase">
            </div>
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Tipo</label>
              <select id="_ctype" class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded">
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor Fixo (R$)</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Desconto</label>
              <input type="number" id="_cval" step="0.01" min="0.01" required
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono">
            </div>
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Pedido Mínimo</label>
              <input type="number" id="_cmin" step="0.01" min="0" value="0"
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono">
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Limite de Usos</label>
              <input type="number" id="_climit" min="1" placeholder="Ilimitado"
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded font-mono">
            </div>
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Início</label>
              <input type="datetime-local" id="_cstarts"
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded">
            </div>
            <div>
              <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Validade</label>
              <input type="datetime-local" id="_cends"
                class="w-full px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded">
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-semibold tracking-wider text-stone-700 uppercase mb-1.5">Ativo</label>
            <select id="_cactive" class="w-full md:w-48 px-3.5 py-2.5 text-sm bg-white border border-stone-200 rounded">
              <option value="1">Sim</option>
              <option value="0">Não</option>
            </select>
          </div>
          <div class="flex items-center gap-3 pt-2">
            <button type="submit"
              class="px-5 py-2.5 text-xs uppercase tracking-wider font-semibold rounded bg-stone-900 hover:bg-black text-white">
              Salvar Cupom
            </button>
            <button type="button" id="_ccancel"
              class="hidden px-4 py-2 text-xs uppercase tracking-wider font-semibold rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
          </div>
        </form>
      </div>

      <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
        <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9]">
          <h3 class="text-xs font-bold uppercase tracking-widest text-stone-800">Cupons Cadastrados</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead><tr class="border-b border-stone-100 bg-stone-50/70 text-[11px] uppercase tracking-wider text-stone-500">
              <th class="py-3 px-6 font-semibold">Código</th>
              <th class="py-3 px-6 font-semibold">Desconto</th>
              <th class="py-3 px-6 font-semibold">Mínimo</th>
              <th class="py-3 px-6 font-semibold">Usos</th>
              <th class="py-3 px-6 font-semibold">Válido até</th>
              <th class="py-3 px-6 font-semibold">Status</th>
              <th class="py-3 px-6 font-semibold text-right">Ações</th>
            </tr></thead>
            <tbody class="divide-y divide-stone-100" id="_ctbody">
              ${coupons.length
                ? coupons.map((c) => `
                  <tr class="hover:bg-stone-50/50 transition-colors">
                    <td class="py-3 px-6 font-mono text-sm font-semibold">${escapeHtml(c.code)}</td>
                    <td class="py-3 px-6 font-mono text-sm">
                      ${c.discount_type === 'percent' ? `${c.discount_value}%` : money(c.discount_value)}
                    </td>
                    <td class="py-3 px-6 font-mono text-xs">${money(c.min_order || 0)}</td>
                    <td class="py-3 px-6 text-xs font-mono">
                      ${c.uses_count || 0}${c.usage_limit ? ` / ${c.usage_limit}` : ' / ∞'}
                    </td>
                    <td class="py-3 px-6 text-xs text-stone-500">${c.ends_at ? fmtDate(c.ends_at) : '—'}</td>
                    <td class="py-3 px-6">
                      ${c.active
                        ? '<span class="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">Ativo</span>'
                        : '<span class="text-[11px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded">Inativo</span>'}
                    </td>
                    <td class="py-3 px-6 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button" data-ec="${escapeHtml(String(c.id))}"
                          class="text-xs px-3 py-1 rounded border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-medium">Editar</button>
                        <button type="button" data-dc="${escapeHtml(String(c.id))}"
                          class="text-xs px-3 py-1 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 font-medium">Excluir</button>
                      </div>
                    </td>
                  </tr>`).join('')
                : '<tr><td colspan="7" class="py-8 text-center text-xs text-stone-400">Nenhum cupom cadastrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    const form = document.getElementById('_cform');
    const resetFn = () => {
      form.reset();
      editId = null;
      document.getElementById('_cid').value = '';
      document.getElementById('_cmin').value = '0';
      document.getElementById('_ctitle').textContent = 'Novo Cupom';
      document.getElementById('_ccancel').classList.add('hidden');
    };
    document.getElementById('_ccancel').onclick = resetFn;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const id2 = document.getElementById('_cid').value;
      const payload = {
        code: document.getElementById('_ccode').value.trim().toUpperCase(),
        discount_type: document.getElementById('_ctype').value,
        discount_value: parseFloat(document.getElementById('_cval').value) || 0,
        min_order: parseFloat(document.getElementById('_cmin').value) || 0,
        usage_limit: document.getElementById('_climit').value ? Number(document.getElementById('_climit').value) : null,
        starts_at: document.getElementById('_cstarts').value || null,
        ends_at: document.getElementById('_cends').value || null,
        active: document.getElementById('_cactive').value === '1',
      };
      try {
        await TeodoraAPI.api(id2 ? `/api/admin/coupons/${id2}` : '/api/admin/coupons', {
          method: id2 ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        showToast(id2 ? 'Cupom atualizado.' : 'Cupom criado.');
        await loadCoupons();
      } catch (err) { showToast(err.message || 'Erro ao salvar cupom.', 'error'); }
    };

    root.querySelectorAll('[data-ec]').forEach((btn) => {
      btn.onclick = () => {
        const c = coupons.find((x) => String(x.id) === btn.dataset.ec);
        if (!c) return;
        editId = c.id;
        document.getElementById('_cid').value = c.id;
        document.getElementById('_ccode').value = c.code;
        document.getElementById('_ctype').value = c.discount_type;
        document.getElementById('_cval').value = c.discount_value;
        document.getElementById('_cmin').value = c.min_order || 0;
        document.getElementById('_climit').value = c.usage_limit || '';
        document.getElementById('_cstarts').value = String(c.starts_at || '').replace(' ', 'T').slice(0, 16);
        document.getElementById('_cends').value = String(c.ends_at || '').replace(' ', 'T').slice(0, 16);
        document.getElementById('_cactive').value = c.active ? '1' : '0';
        document.getElementById('_ctitle').textContent = `Editar: ${c.code}`;
        document.getElementById('_ccancel').classList.remove('hidden');
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    root.querySelectorAll('[data-dc]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir/desativar este cupom?')) return;
        try {
          await TeodoraAPI.api(`/api/admin/coupons/${btn.dataset.dc}`, { method: 'DELETE' });
          showToast('Cupom removido.');
          await loadCoupons();
        } catch (err) { showToast(err.message || 'Erro ao excluir cupom.', 'error'); }
      };
    });
  }

  // ============================================================
  // LOJA & CONFIGURAÇÕES
  // ============================================================

  async function loadStore() {
    const data = await TeodoraAPI.api('/api/admin/settings');
    const s = data.settings || {};
    const form = document.querySelector('#view-loja form');
    if (!form) return;
    // Atribui names programaticamente por label text
    form.querySelectorAll('label').forEach((label) => {
      const text = (label.childNodes[0]?.textContent || '').trim();
      const fieldName = STORE_FIELD_MAP[text];
      if (!fieldName) return;
      const input = label.querySelector('input, textarea, select');
      if (!input) return;
      input.name = fieldName;
      if (s[fieldName] !== undefined && s[fieldName] !== null) {
        input.value = s[fieldName];
      }
    });
  }

  async function handleSaveStoreSettings(event) {
    event.preventDefault();
    const form = event.target;
    const fd = new FormData(form);
    const ALLOWED = [
      'hero_eyebrow', 'hero_title', 'hero_button', 'hero_image',
      'whatsapp_url', 'instagram_url', 'facebook_url', 'youtube_url', 'pinterest_url',
      'installments', 'footer_description',
    ];
    const payload = {};
    ALLOWED.forEach((k) => { const v = fd.get(k); if (v !== null) payload[k] = v; });
    try {
      await TeodoraAPI.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Configurações publicadas com sucesso!');
    } catch (err) { showToast(err.message || 'Erro ao salvar configurações.', 'error'); }
  }

  // ============================================================
  // CLIENTES
  // ============================================================

  async function loadCustomers() {
    const data = await TeodoraAPI.api('/api/admin/customers');
    const customers = data.customers || [];
    const root = document.getElementById('customers-root');
    if (!root) return;
    root.innerHTML = `
      <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
        <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9] flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-widest text-stone-800">Base de Clientes</h3>
          <span class="text-xs font-mono text-stone-500">${customers.length} cliente(s)</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead><tr class="border-b border-stone-100 bg-stone-50/70 text-[11px] uppercase tracking-wider text-stone-500">
              <th class="py-3 px-6 font-semibold">Cliente</th>
              <th class="py-3 px-6 font-semibold">Contato</th>
              <th class="py-3 px-6 font-semibold">Pedidos</th>
              <th class="py-3 px-6 font-semibold">Total Gasto</th>
              <th class="py-3 px-6 font-semibold">Cadastro</th>
            </tr></thead>
            <tbody class="divide-y divide-stone-100">
              ${customers.length
                ? customers.map((c) => `
                  <tr class="hover:bg-stone-50/50 transition-colors">
                    <td class="py-3 px-6 font-medium text-stone-900">${escapeHtml(c.name || '—')}</td>
                    <td class="py-3 px-6">
                      <div class="text-sm text-stone-600">${escapeHtml(c.email || '')}</div>
                      <div class="text-xs text-stone-400">${escapeHtml(c.phone || '')}</div>
                    </td>
                    <td class="py-3 px-6 font-mono text-sm">${c.orders_count || 0}</td>
                    <td class="py-3 px-6 font-mono text-sm font-semibold">${money(c.total_spent || 0)}</td>
                    <td class="py-3 px-6 text-xs text-stone-500">${fmtDate(c.created_at)}</td>
                  </tr>`).join('')
                : '<tr><td colspan="5" class="py-8 text-center text-xs text-stone-400">Nenhum cliente encontrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ============================================================
  // AUDITORIA
  // ============================================================

  async function loadAudit() {
    const root = document.getElementById('audit-root');
    if (!root) return;
    root.innerHTML = '<div class="py-8 text-center text-xs text-stone-400">Carregando registros…</div>';
    try {
      const [audit, movements] = await Promise.all([
        TeodoraAPI.api('/api/admin/audit'),
        TeodoraAPI.api('/api/admin/inventory-movements'),
      ]);
      root.innerHTML = `
        <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden mb-6">
          <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9]">
            <h3 class="text-xs font-bold uppercase tracking-widest text-stone-800">Alterações Administrativas</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead><tr class="border-b border-stone-100 bg-stone-50/70 text-[11px] uppercase tracking-wider text-stone-500">
                <th class="py-3 px-6 font-semibold">Data</th>
                <th class="py-3 px-6 font-semibold">Ação</th>
                <th class="py-3 px-6 font-semibold">Entidade</th>
                <th class="py-3 px-6 font-semibold">ID</th>
              </tr></thead>
              <tbody class="divide-y divide-stone-100">
                ${(audit.entries || []).map((e) => `
                  <tr class="hover:bg-stone-50/50">
                    <td class="py-3 px-6 text-xs text-stone-500">${fmtDate(e.created_at)}</td>
                    <td class="py-3 px-6 text-xs font-medium text-stone-800">${escapeHtml(e.action || '')}</td>
                    <td class="py-3 px-6 text-xs text-stone-600">${escapeHtml(e.entity_type || '')}</td>
                    <td class="py-3 px-6 font-mono text-xs text-stone-400">${escapeHtml(e.entity_id || '—')}</td>
                  </tr>`).join('') || '<tr><td colspan="4" class="py-8 text-center text-xs text-stone-400">Sem registros.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="bg-white rounded border border-brand-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          <div class="px-6 py-4 border-b border-stone-100 bg-[#FCFBF9]">
            <h3 class="text-xs font-bold uppercase tracking-widest text-stone-800">Movimentações de Estoque</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead><tr class="border-b border-stone-100 bg-stone-50/70 text-[11px] uppercase tracking-wider text-stone-500">
                <th class="py-3 px-6 font-semibold">Data</th>
                <th class="py-3 px-6 font-semibold">Produto</th>
                <th class="py-3 px-6 font-semibold">Tipo</th>
                <th class="py-3 px-6 font-semibold">Quantidade</th>
                <th class="py-3 px-6 font-semibold">Saldo</th>
              </tr></thead>
              <tbody class="divide-y divide-stone-100">
                ${(movements.movements || []).map((m) => `
                  <tr class="hover:bg-stone-50/50">
                    <td class="py-3 px-6 text-xs text-stone-500">${fmtDate(m.created_at)}</td>
                    <td class="py-3 px-6">
                      <span class="font-medium text-stone-800 text-sm">${escapeHtml(m.title || '—')}</span>
                      ${m.variant_label ? `<div class="text-xs text-stone-400">${escapeHtml(m.variant_label)}</div>` : ''}
                    </td>
                    <td class="py-3 px-6 text-xs text-stone-600">${escapeHtml(m.movement_type || '')}</td>
                    <td class="py-3 px-6 font-mono text-sm ${(m.quantity || 0) > 0 ? 'text-emerald-700' : 'text-red-700'}">
                      ${(m.quantity || 0) > 0 ? '+' : ''}${m.quantity || 0}
                    </td>
                    <td class="py-3 px-6 font-mono text-sm text-stone-700">${m.balance_after ?? '—'}</td>
                  </tr>`).join('') || '<tr><td colspan="5" class="py-8 text-center text-xs text-stone-400">Sem movimentações.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="py-8 text-center text-sm text-red-600">Erro ao carregar auditoria: ${escapeHtml(err.message || '')}</div>`;
    }
  }

  // ============================================================
  // LOGIN
  // ============================================================

  const loginPasswordEl = document.getElementById('loginPassword');
  if (loginPasswordEl) {
    loginPasswordEl.type = 'text';
    loginPasswordEl.setAttribute('autocomplete', 'off');
    loginPasswordEl.style.webkitTextSecurity = 'none';
  }

  document.getElementById('adminLogin').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loginMsg');
    msg.classList.add('hidden');
    try {
      const data = await TeodoraAPI.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value,
        }),
      });
      if (data.user?.role !== 'admin') throw new Error('Acesso negado: usuário sem permissão de administrador.');
      TeodoraAPI.setSession(data.token, data.user);
      boot();
    } catch (err) {
      msg.textContent = err.message || 'Erro ao fazer login.';
      msg.classList.remove('hidden');
    }
  };

  // ============================================================
  // EXPOSE NA WINDOW (para handlers inline do HTML)
  // ============================================================

  window.navigateView         = navigateView;
  window.toggleSidebar        = toggleSidebar;
  window.showToast            = showToast;
  window.openStorePreview     = openStorePreview;
  window.closeStorePreview    = closeStorePreview;
  window.openNewProductForm   = openNewProductForm;
  window.openEditProduct      = openEditProduct;
  window.closeProductForm     = closeProductForm;
  window.handleSaveProduct    = handleSaveProduct;
  window.autoGenerateTitle    = autoGenerateTitle;
  window.calculateDiscount    = calculateDiscount;
  window.handleCatalogSearch          = handleCatalogSearch;
  window.handleCatalogCategoryChange  = handleCatalogCategoryChange;
  window.handleCatalogStatusChange    = handleCatalogStatusChange;
  window.handleCatalogPerPageChange   = handleCatalogPerPageChange;
  window.toggleProductStatus  = toggleProductStatus;
  window.deleteProduct        = deleteProduct;
  window.previewSpecificProduct = previewSpecificProduct;
  window.handleSaveCategory   = handleSaveCategory;
  window.handleSaveStoreSettings = handleSaveStoreSettings;
  window.handleSaveBox        = handleSaveBox;
  window.resetBoxForm         = resetBoxForm;
  window.selectProductBox     = selectProductBox;
  window.updateShippingWeights = updateShippingWeights;

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  boot();

})();
