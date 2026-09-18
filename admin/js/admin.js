/* Painel admin Teodora */
(function () {
  const money = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const notify = (message, type = 'success') => {
    let outlet = document.getElementById('adminToastOutlet');
    if (!outlet) {
      outlet = document.createElement('div');
      outlet.id = 'adminToastOutlet';
      outlet.className = 'toast-outlet';
      document.body.appendChild(outlet);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    outlet.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  };
  const run = async (action, fallback = 'Nao foi possivel concluir a operacao.') => {
    try { return await action(); }
    catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        TeodoraAPI.clearSession();
        requireAdmin();
      }
      notify(err?.message || fallback, 'error');
      throw err;
    }
  };
  let categories = [];
  let editingId = null;

  function requireAdmin() {
    const user = TeodoraAPI.getUser();
    if (!TeodoraAPI.getToken() || !user || user.role !== 'admin') {
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('appShell').classList.add('hidden');
      return false;
    }
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('adminName').textContent = user.email || user.name;
    return true;
  }

  function showView(name) {
    ['dashboard', 'products', 'categories', 'orders', 'coupons', 'store', 'customers', 'audit', 'product-form'].forEach((v) => {
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('.sidebar nav button').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === name || (name === 'product-form' && b.dataset.view === 'products'));
    });
    const titles = {
      dashboard: ['Dashboard', 'Visão geral da operação'],
      products: ['Produtos', 'Catálogo que alimenta a loja'],
      categories: ['Categorias', 'Organização do menu e filtros'],
      orders: ['Pedidos', 'Pagamentos Mercado Pago'],
      coupons: ['Cupons', 'Promoções e regras de desconto'],
      store: ['Loja', 'Conteúdo, contatos e configurações'],
      customers: ['Clientes', 'Histórico e relacionamento'],
      audit: ['Auditoria', 'Alterações administrativas recentes'],
      'product-form': [editingId ? 'Editar produto' : 'Novo produto', 'Fotos, preço, frete e estoque'],
    };
    document.getElementById('viewTitle').textContent = titles[name][0];
    document.getElementById('viewSubtitle').textContent = titles[name][1];
    document.getElementById('btnNewProduct').classList.toggle('hidden', name !== 'products');
  }

  async function loadDashboard() {
    const data = await TeodoraAPI.api('/api/admin/dashboard');
    const el = document.getElementById('view-dashboard');
    el.innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Produtos</div><div class="value">${data.stats.products}</div></div>
        <div class="card"><div class="label">Ativos</div><div class="value">${data.stats.activeProducts}</div></div>
        <div class="card"><div class="label">Pedidos pendentes</div><div class="value">${data.stats.pendingOrders}</div></div>
        <div class="card"><div class="label">Aprovados</div><div class="value">${data.stats.approvedOrders}</div></div>
        <div class="card"><div class="label">Faturamento confirmado</div><div class="value">${money(data.stats.revenue)}</div></div>
        <div class="card ${data.stats.lowStock ? 'attention' : ''}"><div class="label">Estoque baixo</div><div class="value">${data.stats.lowStock}</div></div>
      </div>
      <div class="panel">
        <h2>Últimos pedidos</h2>
        <table>
          <thead><tr><th>ID</th><th>Cliente</th><th>Status</th><th>Total</th><th>Data</th></tr></thead>
          <tbody>
            ${(data.recentOrders || []).map((o) => `
              <tr>
                <td class="mono">${o.id.slice(0, 8)}…</td>
                <td>${escapeHtml(o.payer_name || o.payer_email || '—')}</td>
                <td><span class="badge status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
                <td>${money(o.total)}</td>
                <td>${o.created_at || ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="5">Nenhum pedido ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  async function loadCategories() {
    const data = await TeodoraAPI.api('/api/admin/categories');
    categories = data.categories || [];
    const el = document.getElementById('view-categories');
    el.innerHTML = `
      <div class="panel">
        <div class="panel-heading"><div><h2 id="catFormTitle">Nova categoria</h2><p>As categorias ativas alimentam menu, home e filtros da loja.</p></div></div>
        <form id="catForm" class="grid-form">
          <input type="hidden" name="id">
          <label>Slug<input name="slug" required placeholder="perfumes"></label>
          <label>Nome<input name="name" required placeholder="Perfumes"></label>
          <label>Ordem<input name="sort_order" type="number" value="0"></label>
          <label>Ativa
            <select name="active"><option value="1">Sim</option><option value="0">Não</option></select>
          </label>
          <label class="full">URL da imagem<input name="image_url" placeholder="https://..."></label>
          <div class="full form-actions"><button class="btn" type="submit">Salvar categoria</button><button class="btn secondary hidden" type="button" id="cancelCat">Cancelar edição</button></div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-heading"><div><h2>Lista</h2><p>${categories.length} categoria(s) cadastrada(s)</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Ordem</th><th>Slug</th><th>Nome</th><th>Ativa</th><th></th></tr></thead>
          <tbody>
            ${categories.map((c) => `
              <tr>
                <td>${c.sort_order}</td>
                <td><code>${escapeHtml(c.slug)}</code></td>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td><span class="badge ${c.active ? 'status-active' : ''}">${c.active ? 'Ativa' : 'Inativa'}</span></td>
                <td class="row-actions"><button class="btn secondary edit-cat" data-id="${c.id}">Editar</button><button class="btn danger del-cat" data-id="${c.id}">Excluir</button></td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="empty">Nenhuma categoria cadastrada.</td></tr>'}
          </tbody>
        </table></div>
      </div>
    `;
    const form = document.getElementById('catForm');
    const resetForm = () => {
      form.reset();
      form.elements.id.value = '';
      form.elements.sort_order.value = '0';
      form.elements.active.value = '1';
      document.getElementById('catFormTitle').textContent = 'Nova categoria';
      document.getElementById('cancelCat').classList.add('hidden');
    };
    document.getElementById('cancelCat').onclick = resetForm;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const id = fd.get('id');
      await run(() => TeodoraAPI.api(id ? `/api/admin/categories/${id}` : '/api/admin/categories', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          slug: fd.get('slug'),
          name: fd.get('name'),
          sort_order: Number(fd.get('sort_order') || 0),
          active: fd.get('active') === '1',
          image_url: fd.get('image_url') || null,
        }),
      }));
      notify(id ? 'Categoria atualizada.' : 'Categoria criada.');
      await loadCategories();
    };
    el.querySelectorAll('.edit-cat').forEach((btn) => {
      btn.onclick = () => {
        const c = categories.find((item) => item.id === Number(btn.dataset.id));
        if (!c) return;
        form.elements.id.value = c.id;
        form.elements.slug.value = c.slug;
        form.elements.name.value = c.name;
        form.elements.sort_order.value = c.sort_order;
        form.elements.active.value = c.active ? '1' : '0';
        form.elements.image_url.value = c.image_url || '';
        document.getElementById('catFormTitle').textContent = `Editar ${c.name}`;
        document.getElementById('cancelCat').classList.remove('hidden');
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    el.querySelectorAll('.del-cat').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir categoria?')) return;
        await run(() => TeodoraAPI.api(`/api/admin/categories/${btn.dataset.id}`, { method: 'DELETE' }));
        notify('Categoria excluída.');
        await loadCategories();
      };
    });
  }

  async function loadProducts(filters = {}) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.status) params.set('status', filters.status);
    const data = await TeodoraAPI.api(`/api/admin/products${params.size ? `?${params}` : ''}`);
    const el = document.getElementById('view-products');
    el.innerHTML = `
      <div class="panel">
        <div class="toolbar">
          <input id="productSearch" type="search" value="${escapeHtml(filters.q || '')}" placeholder="Buscar por produto ou marca">
          <select id="productCategory"><option value="">Todas as categorias</option>${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${filters.category === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
          <select id="productStatus"><option value="">Todos os status</option><option value="active" ${filters.status === 'active' ? 'selected' : ''}>Ativos</option><option value="inactive" ${filters.status === 'inactive' ? 'selected' : ''}>Inativos</option></select>
          <button class="btn secondary" id="applyProductFilters">Filtrar</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(data.products || []).map((p) => `
              <tr>
                <td>${p.image ? `<img class="product-thumb" src="${escapeHtml(TeodoraAPI.absoluteUrl(p.image))}" alt="">` : '<div class="product-thumb placeholder">Sem foto</div>'}</td>
                <td><strong>${escapeHtml(p.title)}</strong><div class="muted small">${escapeHtml(p.brandTag || '')}</div></td>
                <td>${escapeHtml(p.category)}</td>
                <td>${money(p.price)}</td>
                <td><span class="stock ${p.stock <= 5 ? 'low' : ''}">${p.stock}</span></td>
                <td><span class="badge ${p.active ? 'status-active' : ''}">${p.active ? 'Ativo' : 'Inativo'}</span></td>
                <td class="row-actions">
                  <button class="btn secondary edit-p" data-id="${p.id}">Editar</button>
                  <button class="btn danger del-p" data-id="${p.id}">Excluir</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7">Nenhum produto.</td></tr>'}
          </tbody>
        </table></div>
      </div>
    `;
    const applyFilters = () => loadProducts({
      q: document.getElementById('productSearch').value.trim(),
      category: document.getElementById('productCategory').value,
      status: document.getElementById('productStatus').value,
    });
    document.getElementById('applyProductFilters').onclick = applyFilters;
    document.getElementById('productSearch').onkeydown = (event) => {
      if (event.key === 'Enter') applyFilters();
    };
    el.querySelectorAll('.edit-p').forEach((btn) => {
      btn.onclick = () => openProductForm(Number(btn.dataset.id));
    });
    el.querySelectorAll('.del-p').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir produto?')) return;
        const result = await run(() => TeodoraAPI.api(`/api/admin/products/${btn.dataset.id}`, { method: 'DELETE' }));
        notify(result.archived ? 'Produto com histórico foi desativado.' : 'Produto excluído.');
        await loadProducts(filters);
      };
    });
  }

  function productFormHtml(p = {}) {
    const catOptions = categories.map((c) =>
      `<option value="${escapeHtml(c.slug)}" ${p.category === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
    const val = (value) => escapeHtml(value ?? '');
    const persistedVariants = (p.variants || []).filter((variant) => variant.id);
    const variantRow = (variant = {}) => `
      <div class="variant-row" data-variant-id="${variant.id || ''}">
        <input data-field="label" placeholder="Ex.: 100ml" value="${val(variant.label)}" required>
        <input data-field="sku" placeholder="SKU" value="${val(variant.sku)}">
        <input data-field="price" type="number" min="0.01" step="0.01" placeholder="Preço" value="${variant.price ?? ''}" required>
        <input data-field="old_price" type="number" min="0.01" step="0.01" placeholder="Preço antigo" value="${variant.oldPrice ?? ''}">
        <input data-field="stock" type="number" min="0" placeholder="Estoque" value="${variant.stock ?? 0}" required>
        <button class="btn danger remove-variant" type="button">Remover</button>
      </div>`;
    return `
      <div class="panel">
        <form id="productForm" class="grid-form">
          <div class="full form-section"><h2>Informações principais</h2><p>Dados exibidos no card e no topo da página do produto.</p></div>
          <label class="full">Título<input name="title" required minlength="3" value="${val(p.title)}"></label>
          <label>Marca<input name="brand_tag" value="${val(p.brandTag)}"></label>
          <label>Volume / apresentação<input name="volume" value="${val(p.volume)}"></label>
          <label>Categoria<select name="category_slug" required>${catOptions}</select></label>
          <label>Selo
            <select name="badge"><option value="">Sem selo</option>${['Mais Vendido','Lançamento','Edição Especial'].map((b) => `<option value="${b}" ${p.badge === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
          </label>
          <label>Preço<input name="price" type="number" step="0.01" required value="${p.price ?? ''}"></label>
          <label>Preço antigo<input name="old_price" type="number" step="0.01" value="${p.oldPrice ?? ''}"></label>
          <label>Estoque<input name="stock" type="number" min="0" value="${p.stock ?? 50}"></label>
          <label>Ativo<select name="active"><option value="1" ${p.active !== false ? 'selected' : ''}>Sim</option><option value="0" ${p.active === false ? 'selected' : ''}>Não</option></select></label>
          <div class="full form-section"><h2>Variantes</h2><p>Cadastre volumes, SKUs, preços e estoques independentes. Sem variantes, o produto usa os dados principais.</p></div>
          <div class="full" id="variantRows">${persistedVariants.map(variantRow).join('')}</div>
          <div class="full"><button class="btn secondary" type="button" id="addVariant">Adicionar variante</button></div>

          <div class="full form-section"><h2>Conteúdo e perfumaria</h2><p>Informações usadas nos filtros e na página detalhada.</p></div>
          <label>Família<select name="family">${['floral','amadeirado','oriental','cítrico','aromático'].map((v) => `<option value="${v}" ${p.family === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Concentração<select name="intensity">${[['edp','Eau de Parfum'],['edt','Eau de Toilette'],['parfum','Parfum'],['body-splash','Body splash']].map(([v,l]) => `<option value="${v}" ${p.intensity === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Ocasião<select name="occasion">${['dia','noite','festa'].map((v) => `<option value="${v}" ${p.occasion === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Sensação<select name="sensation">${['romantico','marcante','fresco','elegante'].map((v) => `<option value="${v}" ${p.sensation === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="full">Notas resumidas<textarea name="notes">${val(p.notes)}</textarea></label>
          <label class="full">Descrição<textarea name="description">${val(p.description)}</textarea></label>
          <label>Notas de saída<textarea name="pyramid_top">${val(p.pyramid?.top)}</textarea></label>
          <label>Notas de coração<textarea name="pyramid_heart">${val(p.pyramid?.heart)}</textarea></label>
          <label>Notas de fundo<textarea name="pyramid_base">${val(p.pyramid?.base)}</textarea></label>
          <label>Produtos similares (IDs)<textarea name="similar_ids" placeholder="2, 3, 8">${val((p.similarIds || []).join(', '))}</textarea></label>
          <label class="full">Ritual de uso<textarea name="ritual">${val(p.ritual)}</textarea></label>
          <label class="full">Ingredientes<textarea name="ingredients">${val(p.ingredients)}</textarea></label>

          <div class="full form-section"><h2>Entrega e imagem</h2><p>Medidas usadas no cálculo de frete.</p></div>
          <label>Peso (kg)<input name="weight_kg" type="number" min="0.001" step="0.001" value="${p.weightKg ?? 0.5}"></label>
          <label>Altura (cm)<input name="height_cm" type="number" min="0.1" step="0.1" value="${p.heightCm ?? 12}"></label>
          <label>Largura (cm)<input name="width_cm" type="number" min="0.1" step="0.1" value="${p.widthCm ?? 8}"></label>
          <label>Comprimento (cm)<input name="length_cm" type="number" min="0.1" step="0.1" value="${p.lengthCm ?? 8}"></label>
          <label class="full">URL da capa (opcional)<input name="cover_image" value="${val(p.image)}"></label>
          <div class="full form-actions sticky-actions">
            <button class="btn" type="submit">Salvar produto</button>
            <button class="btn secondary" type="button" id="cancelProduct">Cancelar</button>
          </div>
        </form>
      </div>
      ${p.id ? `
        <div class="panel">
          <div class="panel-heading"><div><h2>Fotos</h2><p>Envie JPG, PNG, WebP ou GIF de até 8 MB.</p></div></div>
          <div class="thumb-row" id="imageGallery"></div>
          <form id="uploadForm" style="margin-top:1rem;display:flex;gap:0.75rem;align-items:center">
            <input type="file" name="file" accept="image/*" required>
            <button class="btn secondary" type="submit">Enviar foto</button>
          </form>
        </div>
      ` : ''}
    `;
  }

  async function openProductForm(id = null) {
    editingId = id;
    if (!categories.length) {
      const data = await TeodoraAPI.api('/api/admin/categories');
      categories = data.categories || [];
    }
    let product = {};
    if (id) {
      const data = await TeodoraAPI.api(`/api/admin/products/${id}`);
      product = data.product || {};
    }
    showView('product-form');
    const el = document.getElementById('view-product-form');
    el.innerHTML = productFormHtml(product);

    document.getElementById('cancelProduct').onclick = () => {
      showView('products');
      loadProducts();
    };

    const bindVariantRemovers = () => {
      el.querySelectorAll('.remove-variant').forEach((button) => {
        button.onclick = () => button.closest('.variant-row').remove();
      });
    };
    document.getElementById('addVariant').onclick = () => {
      document.getElementById('variantRows').insertAdjacentHTML('beforeend', `
        <div class="variant-row">
          <input data-field="label" placeholder="Ex.: 100ml" required>
          <input data-field="sku" placeholder="SKU">
          <input data-field="price" type="number" min="0.01" step="0.01" placeholder="Preço" required>
          <input data-field="old_price" type="number" min="0.01" step="0.01" placeholder="Preço antigo">
          <input data-field="stock" type="number" min="0" placeholder="Estoque" value="0" required>
          <button class="btn danger remove-variant" type="button">Remover</button>
        </div>`);
      bindVariantRemovers();
    };
    bindVariantRemovers();

    document.getElementById('productForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title'),
        brand_tag: fd.get('brand_tag'),
        volume: fd.get('volume'),
        category_slug: fd.get('category_slug'),
        badge: fd.get('badge'),
        price: Number(fd.get('price')),
        old_price: fd.get('old_price') ? Number(fd.get('old_price')) : null,
        stock: Number(fd.get('stock') || 0),
        active: fd.get('active') === '1',
        weight_kg: Number(fd.get('weight_kg') || 0.5),
        height_cm: Number(fd.get('height_cm') || 12),
        width_cm: Number(fd.get('width_cm') || 8),
        length_cm: Number(fd.get('length_cm') || 8),
        family: fd.get('family'),
        intensity: fd.get('intensity'),
        occasion: fd.get('occasion'),
        sensation: fd.get('sensation'),
        notes: fd.get('notes'),
        description: fd.get('description'),
        ritual: fd.get('ritual'),
        ingredients: fd.get('ingredients'),
        pyramid_top: fd.get('pyramid_top'),
        pyramid_heart: fd.get('pyramid_heart'),
        pyramid_base: fd.get('pyramid_base'),
        similar_ids: String(fd.get('similar_ids') || '').split(',')
          .map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0),
        cover_image: fd.get('cover_image') || null,
        variants: [...e.target.querySelectorAll('.variant-row')].map((row) => ({
          id: row.dataset.variantId ? Number(row.dataset.variantId) : null,
          label: row.querySelector('[data-field="label"]').value.trim(),
          sku: row.querySelector('[data-field="sku"]').value.trim(),
          price: Number(row.querySelector('[data-field="price"]').value),
          old_price: row.querySelector('[data-field="old_price"]').value ? Number(row.querySelector('[data-field="old_price"]').value) : null,
          stock: Number(row.querySelector('[data-field="stock"]').value || 0),
          active: true,
        })),
      };
      if (editingId) {
        await run(() => TeodoraAPI.api(`/api/admin/products/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) }));
      } else {
        const created = await run(() => TeodoraAPI.api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) }));
        editingId = created.product.id;
      }
      notify('Produto salvo com sucesso.');
      openProductForm(editingId);
    };

    if (product.id) {
      renderImages(product);
      document.getElementById('uploadForm').onsubmit = async (e) => {
        e.preventDefault();
        const file = e.target.file.files[0];
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        await run(() => TeodoraAPI.apiForm(`/api/admin/products/${product.id}/images`, form));
        notify('Foto enviada.');
        openProductForm(product.id);
      };
    }
  }

  function renderImages(product) {
    const box = document.getElementById('imageGallery');
    const imgs = product.images || [];
    box.innerHTML = imgs.map((img) => `
      <div class="thumb">
        <img src="${escapeHtml(TeodoraAPI.absoluteUrl(img.url))}" alt="">
        ${img.is_cover ? '<div class="badge">Capa</div>' : ''}
        <div class="actions">
          <button data-cover="${img.id}">Capa</button>
          <button data-del="${img.id}">Excluir</button>
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted)">Nenhuma foto enviada.</p>';

    box.querySelectorAll('[data-cover]').forEach((btn) => {
      btn.onclick = async () => {
        await run(() => TeodoraAPI.api(`/api/admin/products/${product.id}/images/${btn.dataset.cover}`, { method: 'PATCH' }));
        notify('Imagem de capa atualizada.');
        openProductForm(product.id);
      };
    });
    box.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir esta foto?')) return;
        await run(() => TeodoraAPI.api(`/api/admin/products/${product.id}/images/${btn.dataset.del}`, { method: 'DELETE' }));
        notify('Foto excluída.');
        openProductForm(product.id);
      };
    });
  }

  async function loadOrders() {
    const data = await TeodoraAPI.api('/api/admin/orders');
    const el = document.getElementById('view-orders');
    el.innerHTML = `
      <div class="panel">
        <table>
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Frete</th><th>Total</th><th>MP</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(data.orders || []).map((o) => `
              <tr>
                <td><code>${o.id.slice(0, 8)}</code><div style="font-size:0.7rem;color:var(--muted)">${o.created_at || ''}</div></td>
                <td>${escapeHtml(o.payer_name || '—')}<div class="muted small">${escapeHtml(o.payer_email || '')}</div></td>
                <td>${(o.items || []).map((i) => `${i.quantity}× ${escapeHtml(i.title)}`).join('<br>')}</td>
                <td>${money(o.shipping_cost)}<div class="muted small">${escapeHtml((o.shipping_snapshot && o.shipping_snapshot.name) || '')}</div></td>
                <td>${money(o.total)}</td>
                <td class="small">${escapeHtml(o.mp_payment_id || '—')}<br>${escapeHtml(o.mp_status || '')}</td>
                <td>
                  <select class="status-sel" data-id="${o.id}">
                    ${['pending','approved','rejected','shipped','delivered','cancelled'].map((s) =>
                      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
                    ).join('')}
                  </select>
                </td>
                <td class="row-actions"><button class="btn secondary detail-order" data-id="${o.id}">Detalhes</button><button class="btn secondary save-st" data-id="${o.id}">Salvar</button></td>
              </tr>
            `).join('') || '<tr><td colspan="8">Nenhum pedido.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    el.querySelectorAll('.save-st').forEach((btn) => {
      btn.onclick = async () => {
        const sel = el.querySelector(`.status-sel[data-id="${btn.dataset.id}"]`);
        await run(() => TeodoraAPI.api(`/api/admin/orders/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        }));
        notify('Status do pedido atualizado.');
        await loadOrders();
      };
    });
    el.querySelectorAll('.detail-order').forEach((btn) => {
      btn.onclick = () => showOrderDetail(btn.dataset.id);
    });
  }

  async function showOrderDetail(orderId) {
    const data = await run(() => TeodoraAPI.api(`/api/admin/orders/${orderId}/detail`));
    if (!data) return;
    const o = data.order;
    const el = document.getElementById('view-orders');
    document.getElementById('orderDetailPanel')?.remove();
    el.insertAdjacentHTML('afterbegin', `
      <div class="panel order-detail" id="orderDetailPanel">
        <div class="panel-heading"><div><h2>Pedido ${escapeHtml(o.id.slice(0, 8))}</h2><p>${escapeHtml(o.payer_name || o.payer_email || '')}</p></div><button class="btn secondary" id="closeOrderDetail">Fechar</button></div>
        <div class="detail-grid">
          <div><strong>Total</strong><p>${money(o.total)}</p></div><div><strong>Pagamento</strong><p>${escapeHtml(o.mp_status || o.status)}</p></div><div><strong>Endereço</strong><p>${escapeHtml(o.payer_address || '—')}</p></div>
        </div>
        <h2>Itens</h2><ul>${(o.items || []).map((item) => `<li>${item.quantity}× ${escapeHtml(item.title)} ${item.variant_label ? `(${escapeHtml(item.variant_label)})` : ''} — ${money(item.unit_price)}</li>`).join('')}</ul>
        <form id="fulfillmentForm" class="grid-form">
          <label>Código de rastreio<input name="tracking_code" value="${escapeHtml(o.tracking_code || '')}"></label>
          <label>URL de rastreio<input name="tracking_url" value="${escapeHtml(o.tracking_url || '')}"></label>
          <label class="full">Observações internas<textarea name="admin_notes">${escapeHtml(o.admin_notes || '')}</textarea></label>
          <div class="full"><button class="btn" type="submit">Salvar expedição</button></div>
        </form>
        <h2>Histórico</h2><ul class="history-list">${(o.history || []).map((h) => `<li><span>${escapeHtml(h.new_status)}</span><small>${escapeHtml(h.created_at)} · ${escapeHtml(h.source)}</small></li>`).join('') || '<li>Sem alterações registradas.</li>'}</ul>
      </div>`);
    document.getElementById('closeOrderDetail').onclick = () => document.getElementById('orderDetailPanel').remove();
    document.getElementById('fulfillmentForm').onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      await run(() => TeodoraAPI.api(`/api/admin/orders/${orderId}/fulfillment`, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(fd)) }));
      notify('Dados de expedição atualizados.');
    };
  }

  async function loadCoupons() {
    const data = await TeodoraAPI.api('/api/admin/coupons');
    const coupons = data.coupons || [];
    const el = document.getElementById('view-coupons');
    el.innerHTML = `
      <div class="panel"><div class="panel-heading"><div><h2 id="couponFormTitle">Novo cupom</h2><p>O desconto é sempre revalidado pelo servidor.</p></div></div>
        <form id="couponForm" class="grid-form"><input type="hidden" name="id">
          <label>Código<input name="code" required></label><label>Tipo<select name="discount_type"><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></select></label>
          <label>Desconto<input name="discount_value" type="number" min="0.01" step="0.01" required></label><label>Pedido mínimo<input name="min_order" type="number" min="0" step="0.01" value="0"></label>
          <label>Limite de usos<input name="usage_limit" type="number" min="1"></label><label>Ativo<select name="active"><option value="1">Sim</option><option value="0">Não</option></select></label>
          <label>Início<input name="starts_at" type="datetime-local"></label><label>Fim<input name="ends_at" type="datetime-local"></label>
          <div class="full form-actions"><button class="btn" type="submit">Salvar cupom</button><button class="btn secondary hidden" id="cancelCoupon" type="button">Cancelar</button></div>
        </form></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Usos</th><th>Status</th><th></th></tr></thead><tbody>
        ${coupons.map((c) => `<tr><td><strong>${escapeHtml(c.code)}</strong></td><td>${c.discount_type === 'percent' ? `${c.discount_value}%` : money(c.discount_value)}</td><td>${money(c.min_order)}</td><td>${c.uses_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td><td>${c.active ? 'Ativo' : 'Inativo'}</td><td class="row-actions"><button class="btn secondary edit-coupon" data-id="${c.id}">Editar</button><button class="btn danger disable-coupon" data-id="${c.id}">Desativar</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    const form = document.getElementById('couponForm');
    const reset = () => { form.reset(); form.elements.id.value = ''; form.elements.min_order.value = '0'; document.getElementById('couponFormTitle').textContent = 'Novo cupom'; document.getElementById('cancelCoupon').classList.add('hidden'); };
    document.getElementById('cancelCoupon').onclick = reset;
    form.onsubmit = async (event) => {
      event.preventDefault(); const fd = new FormData(form); const id = fd.get('id');
      const payload = { code: fd.get('code'), discount_type: fd.get('discount_type'), discount_value: Number(fd.get('discount_value')), min_order: Number(fd.get('min_order') || 0), usage_limit: fd.get('usage_limit') ? Number(fd.get('usage_limit')) : null, starts_at: fd.get('starts_at') || null, ends_at: fd.get('ends_at') || null, active: fd.get('active') === '1' };
      await run(() => TeodoraAPI.api(id ? `/api/admin/coupons/${id}` : '/api/admin/coupons', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) })); notify('Cupom salvo.'); await loadCoupons();
    };
    el.querySelectorAll('.edit-coupon').forEach((button) => { button.onclick = () => { const c = coupons.find((x) => x.id === Number(button.dataset.id)); for (const key of ['id','code','discount_type','discount_value','min_order','usage_limit']) if (form.elements[key]) form.elements[key].value = c[key] ?? ''; for (const key of ['starts_at','ends_at']) form.elements[key].value = String(c[key] || '').replace(' ', 'T').slice(0, 16); form.elements.active.value = c.active ? '1' : '0'; document.getElementById('couponFormTitle').textContent = `Editar ${c.code}`; document.getElementById('cancelCoupon').classList.remove('hidden'); }; });
    el.querySelectorAll('.disable-coupon').forEach((button) => { button.onclick = async () => { await run(() => TeodoraAPI.api(`/api/admin/coupons/${button.dataset.id}`, { method: 'DELETE' })); notify('Cupom desativado.'); await loadCoupons(); }; });
  }

  async function loadStore() {
    const data = await TeodoraAPI.api('/api/admin/settings'); const s = data.settings || {}; const el = document.getElementById('view-store');
    el.innerHTML = `<div class="panel"><form id="storeForm" class="grid-form">
      <div class="full form-section"><h2>Hero da página inicial</h2></div><label>Chamada<input name="hero_eyebrow" value="${escapeHtml(s.hero_eyebrow || '')}"></label><label>Botão<input name="hero_button" value="${escapeHtml(s.hero_button || '')}"></label><label class="full">Título<textarea name="hero_title">${escapeHtml(s.hero_title || '')}</textarea></label><label class="full">Imagem<input name="hero_image" value="${escapeHtml(s.hero_image || '')}"></label>
      <div class="full form-section"><h2>Contato e redes</h2></div>${['whatsapp_url','instagram_url','facebook_url','youtube_url','pinterest_url'].map((key) => `<label>${key.replace('_url','').toUpperCase()}<input name="${key}" value="${escapeHtml(s[key] || '')}"></label>`).join('')}
      <label>Parcelas sem juros<input name="installments" type="number" min="1" max="12" value="${escapeHtml(s.installments || '6')}"></label><label class="full">Descrição do rodapé<textarea name="footer_description">${escapeHtml(s.footer_description || '')}</textarea></label>
      <div class="full sticky-actions"><button class="btn" type="submit">Salvar configurações</button></div></form></div>`;
    document.getElementById('storeForm').onsubmit = async (event) => { event.preventDefault(); await run(() => TeodoraAPI.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) })); notify('Configurações publicadas.'); };
  }

  async function loadCustomers() {
    const data = await TeodoraAPI.api('/api/admin/customers'); const el = document.getElementById('view-customers');
    el.innerHTML = `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Contato</th><th>Pedidos</th><th>Total confirmado</th><th>Cadastro</th></tr></thead><tbody>${(data.customers || []).map((c) => `<tr><td><strong>${escapeHtml(c.name || '—')}</strong></td><td>${escapeHtml(c.email || '')}<div class="muted small">${escapeHtml(c.phone || '')}</div></td><td>${c.orders_count}</td><td>${money(c.total_spent)}</td><td>${escapeHtml(c.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum cliente.</td></tr>'}</tbody></table></div></div>`;
  }

  async function loadAudit() {
    const [audit, movements] = await Promise.all([TeodoraAPI.api('/api/admin/audit'), TeodoraAPI.api('/api/admin/inventory-movements')]); const el = document.getElementById('view-audit');
    el.innerHTML = `<div class="panel"><h2>Alterações administrativas</h2><div class="table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Entidade</th><th>ID</th></tr></thead><tbody>${(audit.entries || []).map((entry) => `<tr><td>${escapeHtml(entry.created_at)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.entity_type)}</td><td>${escapeHtml(entry.entity_id || '')}</td></tr>`).join('') || '<tr><td colspan="4">Sem registros.</td></tr>'}</tbody></table></div></div><div class="panel"><h2>Movimentações de estoque</h2><div class="table-wrap"><table><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Saldo</th></tr></thead><tbody>${(movements.movements || []).map((m) => `<tr><td>${escapeHtml(m.created_at)}</td><td>${escapeHtml(m.title || '')}${m.variant_label ? `<div class="muted small">${escapeHtml(m.variant_label)}</div>` : ''}</td><td>${escapeHtml(m.movement_type)}</td><td>${m.quantity}</td><td>${m.balance_after}</td></tr>`).join('') || '<tr><td colspan="5">Sem movimentações.</td></tr>'}</tbody></table></div></div>`;
  }

  document.getElementById('adminLogin').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loginMsg');
    try {
      const data = await TeodoraAPI.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value,
        }),
      });
      if (data.user.role !== 'admin') throw new Error('Usuário sem permissão admin');
      TeodoraAPI.setSession(data.token, data.user);
      boot();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    }
  };

  document.getElementById('btnLogout').onclick = () => {
    TeodoraAPI.clearSession();
    location.reload();
  };

  document.getElementById('btnNewProduct').onclick = () => openProductForm(null);

  document.querySelectorAll('.sidebar nav button').forEach((btn) => {
    btn.onclick = async () => {
      const view = btn.dataset.view;
      showView(view);
      await run(async () => {
        if (view === 'dashboard') await loadDashboard();
        if (view === 'products') await loadProducts();
        if (view === 'categories') await loadCategories();
        if (view === 'orders') await loadOrders();
        if (view === 'coupons') await loadCoupons();
        if (view === 'store') await loadStore();
        if (view === 'customers') await loadCustomers();
        if (view === 'audit') await loadAudit();
      }).catch(() => {});
    };
  });

  async function boot() {
    if (!requireAdmin()) return;
    showView('dashboard');
    await run(async () => {
      await loadDashboard();
      const cats = await TeodoraAPI.api('/api/admin/categories');
      categories = cats.categories || [];
    }).catch(() => {});
  }

  boot();
})();
