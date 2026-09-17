/* Painel admin Teodora */
(function () {
  const money = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
    ['dashboard', 'products', 'categories', 'orders', 'product-form'].forEach((v) => {
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
      </div>
      <div class="panel">
        <h2>Últimos pedidos</h2>
        <table>
          <thead><tr><th>ID</th><th>Cliente</th><th>Status</th><th>Total</th><th>Data</th></tr></thead>
          <tbody>
            ${(data.recentOrders || []).map((o) => `
              <tr>
                <td class="mono">${o.id.slice(0, 8)}…</td>
                <td>${o.payer_name || o.payer_email || '—'}</td>
                <td><span class="badge">${o.status}</span></td>
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
        <h2>Nova categoria</h2>
        <form id="catForm" class="grid-form">
          <label>Slug<input name="slug" required placeholder="perfumes"></label>
          <label>Nome<input name="name" required placeholder="Perfumes"></label>
          <label>Ordem<input name="sort_order" type="number" value="0"></label>
          <label>Ativa
            <select name="active"><option value="1">Sim</option><option value="0">Não</option></select>
          </label>
          <div class="full"><button class="btn" type="submit">Salvar categoria</button></div>
        </form>
      </div>
      <div class="panel">
        <h2>Lista</h2>
        <table>
          <thead><tr><th>Ordem</th><th>Slug</th><th>Nome</th><th>Ativa</th><th></th></tr></thead>
          <tbody>
            ${categories.map((c) => `
              <tr>
                <td>${c.sort_order}</td>
                <td>${c.slug}</td>
                <td>${c.name}</td>
                <td>${c.active ? 'Sim' : 'Não'}</td>
                <td><button class="btn secondary del-cat" data-id="${c.id}">Excluir</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('catForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await TeodoraAPI.api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({
          slug: fd.get('slug'),
          name: fd.get('name'),
          sort_order: Number(fd.get('sort_order') || 0),
          active: fd.get('active') === '1',
        }),
      });
      loadCategories();
    };
    el.querySelectorAll('.del-cat').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir categoria?')) return;
        await TeodoraAPI.api(`/api/admin/categories/${btn.dataset.id}`, { method: 'DELETE' });
        loadCategories();
      };
    });
  }

  async function loadProducts() {
    const data = await TeodoraAPI.api('/api/admin/products');
    const el = document.getElementById('view-products');
    el.innerHTML = `
      <div class="panel">
        <table>
          <thead><tr><th>Foto</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(data.products || []).map((p) => `
              <tr>
                <td><img src="${TeodoraAPI.absoluteUrl(p.image)}" alt="" style="width:48px;height:48px;object-fit:cover;border:1px solid var(--line)"></td>
                <td><strong>${p.title}</strong><div style="color:var(--muted);font-size:0.75rem">${p.brandTag || ''}</div></td>
                <td>${p.category}</td>
                <td>${money(p.price)}</td>
                <td>${p.stock}</td>
                <td>${p.active ? 'Ativo' : 'Inativo'}</td>
                <td style="white-space:nowrap">
                  <button class="btn secondary edit-p" data-id="${p.id}">Editar</button>
                  <button class="btn danger del-p" data-id="${p.id}">Excluir</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7">Nenhum produto.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    el.querySelectorAll('.edit-p').forEach((btn) => {
      btn.onclick = () => openProductForm(Number(btn.dataset.id));
    });
    el.querySelectorAll('.del-p').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Excluir produto?')) return;
        await TeodoraAPI.api(`/api/admin/products/${btn.dataset.id}`, { method: 'DELETE' });
        loadProducts();
      };
    });
  }

  function productFormHtml(p = {}) {
    const catOptions = categories.map((c) =>
      `<option value="${c.slug}" ${p.category === c.slug ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    return `
      <div class="panel">
        <form id="productForm" class="grid-form">
          <label class="full">Título<input name="title" required value="${p.title || ''}"></label>
          <label>Marca<input name="brand_tag" value="${p.brandTag || ''}"></label>
          <label>Volume<input name="volume" value="${p.volume || ''}"></label>
          <label>Categoria<select name="category_slug">${catOptions}</select></label>
          <label>Badge<input name="badge" value="${p.badge || ''}"></label>
          <label>Preço<input name="price" type="number" step="0.01" required value="${p.price ?? ''}"></label>
          <label>Preço antigo<input name="old_price" type="number" step="0.01" value="${p.oldPrice ?? ''}"></label>
          <label>Estoque<input name="stock" type="number" value="${p.stock ?? 50}"></label>
          <label>Ativo<select name="active"><option value="1" ${p.active !== false ? 'selected' : ''}>Sim</option><option value="0" ${p.active === false ? 'selected' : ''}>Não</option></select></label>
          <label>Peso (kg)<input name="weight_kg" type="number" step="0.001" value="${p.weightKg ?? 0.5}"></label>
          <label>Altura (cm)<input name="height_cm" type="number" step="0.1" value="${p.heightCm ?? 12}"></label>
          <label>Largura (cm)<input name="width_cm" type="number" step="0.1" value="${p.widthCm ?? 8}"></label>
          <label>Comprimento (cm)<input name="length_cm" type="number" step="0.1" value="${p.lengthCm ?? 8}"></label>
          <label>Família<input name="family" value="${p.family || 'floral'}"></label>
          <label>Intensidade<input name="intensity" value="${p.intensity || 'edp'}"></label>
          <label>Ocasião<input name="occasion" value="${p.occasion || 'dia'}"></label>
          <label>Sensação<input name="sensation" value="${p.sensation || 'romantico'}"></label>
          <label class="full">Notas<textarea name="notes">${p.notes || ''}</textarea></label>
          <label class="full">Descrição<textarea name="description">${p.description || ''}</textarea></label>
          <label class="full">URL capa (opcional)<input name="cover_image" value="${p.image || ''}"></label>
          <div class="full" style="display:flex;gap:0.5rem">
            <button class="btn" type="submit">Salvar produto</button>
            <button class="btn secondary" type="button" id="cancelProduct">Cancelar</button>
          </div>
        </form>
      </div>
      ${p.id ? `
        <div class="panel">
          <h2>Fotos</h2>
          <div class="thumb-row" id="image thr"></div>
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
      const all = await TeodoraAPI.api('/api/admin/products');
      product = (all.products || []).find((x) => x.id === id) || {};
    }
    showView('product-form');
    const el = document.getElementById('view-product-form');
    el.innerHTML = productFormHtml(product);

    document.getElementById('cancelProduct').onclick = () => {
      showView('products');
      loadProducts();
    };

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
        cover_image: fd.get('cover_image') || null,
      };
      if (editingId) {
        await TeodoraAPI.api(`/api/admin/products/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const created = await TeodoraAPI.api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
        editingId = created.product.id;
      }
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
        await TeodoraAPI.apiForm(`/api/admin/products/${product.id}/images`, form);
        openProductForm(product.id);
      };
    }
  }

  function renderImages(product) {
    const box = document.getElementById('imageGallery');
    const imgs = product.images || [];
    box.innerHTML = imgs.map((img) => `
      <div class="thumb">
        <img src="${TeodoraAPI.absoluteUrl(img.url)}" alt="">
        ${img.is_cover ? '<div class="badge">Capa</div>' : ''}
        <div class="actions">
          <button data-cover="${img.id}">Capa</button>
          <button data-del="${img.id}">Excluir</button>
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted)">Nenhuma foto enviada.</p>';

    box.querySelectorAll('[data-cover]').forEach((btn) => {
      btn.onclick = async () => {
        await TeodoraAPI.api(`/api/admin/products/${product.id}/images/${btn.dataset.cover}`, { method: 'PATCH' });
        openProductForm(product.id);
      };
    });
    box.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        await TeodoraAPI.api(`/api/admin/products/${product.id}/images/${btn.dataset.del}`, { method: 'DELETE' });
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
                <td>${o.payer_name || '—'}<div style="font-size:0.75rem;color:var(--muted)">${o.payer_email || ''}</div></td>
                <td>${(o.items || []).map((i) => `${i.quantity}× ${i.title}`).join('<br>')}</td>
                <td>${money(o.shipping_cost)}<div style="font-size:0.7rem;color:var(--muted)">${(o.shipping_snapshot && o.shipping_snapshot.name) || ''}</div></td>
                <td>${money(o.total)}</td>
                <td style="font-size:0.75rem">${o.mp_payment_id || '—'}<br>${o.mp_status || ''}</td>
                <td>
                  <select class="status-sel" data-id="${o.id}">
                    ${['pending','approved','rejected','shipped','delivered','cancelled'].map((s) =>
                      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
                    ).join('')}
                  </select>
                </td>
                <td><button class="btn secondary save-st" data-id="${o.id}">Salvar</button></td>
              </tr>
            `).join('') || '<tr><td colspan="8">Nenhum pedido.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    el.querySelectorAll('.save-st').forEach((btn) => {
      btn.onclick = async () => {
        const sel = el.querySelector(`.status-sel[data-id="${btn.dataset.id}"]`);
        await TeodoraAPI.api(`/api/admin/orders/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        loadOrders();
      };
    });
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
      if (view === 'dashboard') await loadDashboard();
      if (view === 'products') await loadProducts();
      if (view === 'categories') await loadCategories();
      if (view === 'orders') await loadOrders();
    };
  });

  async function boot() {
    if (!requireAdmin()) return;
    showView('dashboard');
    await loadDashboard();
    const cats = await TeodoraAPI.api('/api/admin/categories');
    categories = cats.categories || [];
  }

  boot();
})();
