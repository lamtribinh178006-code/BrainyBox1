(() => {
  const store = window.BrainyBoxStore;
  const data = window.BrainyBoxData;
  const sessionKey = 'brainybox-admin-session';
  const DEMO_USER = 'admin';
  const DEMO_PASSWORD = 'brainybox-demo';
  const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
  const byId = (id) => document.getElementById(id);
  const view = () => byId('admin-view');
  let currentRoute = { name: 'overview', id: '' };
  let toastTimer;
  let categoryFilters = { query: '', categoryId: '', mode: '', showArchived: false };
  let orderFilters = { query: '', mode: 'all', sort: 'newest' };
  let inquiryFilters = { query: '', status: 'all', selectedId: '' };
  let unsavedDraft = false;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const safeUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : '';
    } catch {
      return '';
    }
  };
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const formatDate = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : 'Chưa chọn';
  const icon = (name, extra = '') => `<i class="ti ti-${name} ${extra}" aria-hidden="true"></i>`;
  const statusLabels = { new: 'Mới', confirmed: 'Đã xác nhận', handedOff: 'Đã bàn giao', complete: 'Hoàn tất', cancelled: 'Đã hủy', renting: 'Đang thuê', returned: 'Đã nhận lại', contacted: 'Đã liên hệ', closed: 'Đã đóng' };

  function toast(message, tone = 'success') {
    const node = byId('admin-toast');
    if (!node) return;
    node.textContent = message;
    node.className = `admin-toast is-visible${tone === 'error' ? ' admin-error' : ''}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('is-visible'), 3500);
  }

  function setGlobalAlert(message = '') {
    const node = byId('admin-global-alert');
    if (!node) return;
    node.hidden = !message;
    node.textContent = message;
  }

  function parseRoute() {
    const part = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const [name, id] = part.split('/');
    if (['overview', 'products', 'orders', 'b2b'].includes(name)) return { name, id: '' };
    if (name === 'product-editor') return { name, id: id || '' };
    if (name === 'categories') return { name: 'categories', id: '' };
    if (name === 'category-editor') return { name: 'category-editor', id: id || '' };
    if (name === 'order') return { name: 'order', id: id || '' };
    if (name === 'inquiry') return { name: 'inquiry', id: id || '' };
    return { name: 'overview', id: '' };
  }

  function currentHeading(route) {
    if (route.name === 'products' || route.name === 'product-editor' || route.name === 'categories' || route.name === 'category-editor') return 'Sản phẩm';
    if (route.name === 'orders' || route.name === 'order') return 'Đơn hàng';
    if (route.name === 'b2b' || route.name === 'inquiry') return 'Khách B2B';
    return 'Việc cần xử lý';
  }

  function setNavigation(route) {
    document.querySelectorAll('[data-route]').forEach((link) => {
      const active = (route.name === 'product-editor' || route.name === 'categories' || route.name === 'category-editor') ? 'products'
        : (route.name === 'order' ? 'orders' : route.name === 'inquiry' ? 'b2b' : route.name);
      if (link.dataset.route === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function renderShell() {
    const authenticated = sessionStorage.getItem(sessionKey) === '1';
    byId('admin-login').hidden = authenticated;
    byId('admin-app').hidden = !authenticated;
    if (!authenticated) return;

    currentRoute = parseRoute();
    byId('admin-page-heading').textContent = currentHeading(currentRoute);
    setNavigation(currentRoute);
    const uncountedStock = store?.getProducts().some((product) => store.getProductInventory(product).some((row) => !row.configured));
    setGlobalAlert(store?.getReadError?.() || (uncountedStock ? 'Dữ liệu tồn kho ban đầu chưa được kiểm kê. Nhập số lượng thực tế trước khi nhận đơn demo.' : ''));

    switch (currentRoute.name) {
      case 'products': renderProducts(); break;
      case 'product-editor': renderProductEditor(currentRoute.id); break;
      case 'categories': renderCategories(); break;
      case 'category-editor': renderCategoryEditor(currentRoute.id); break;
      case 'orders': renderOrders(); break;
      case 'order': renderOrder(currentRoute.id); break;
      case 'b2b': renderInquiries(); break;
      case 'inquiry': renderInquiry(currentRoute.id); break;
      default: renderOverview();
    }
  }

  function ensureStore() {
    if (!store) {
      view().innerHTML = '<section class="admin-empty-state"><div><h3>Không tải được dữ liệu quản trị</h3><p>Kiểm tra kết nối CDN và tải lại trang.</p></div></section>';
      return false;
    }
    return true;
  }

  function lineModeStatus(line) {
    return statusLabels[line.mode === 'rent' ? line.rentalStatus : line.purchaseStatus] || 'Chưa xác định';
  }

  function orderNextAction(order) {
    for (const line of order.lines) {
      if (line.mode === 'rent') {
        if (line.rentalStatus === 'new') return { label: 'Xác nhận thuê', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
        if (line.rentalStatus === 'confirmed') return { label: 'Giao đồ thuê', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
        if (line.rentalStatus === 'renting' && line.rentalDueDate) {
          const overdue = line.rentalDueDate < new Date().toISOString().slice(0, 10);
          return { label: overdue ? 'Quá hạn trả' : 'Theo dõi trả đồ', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
        }
        if (line.rentalStatus === 'returned' && line.deposit.held > line.deposit.refunded + line.deposit.retained) return { label: 'Đối soát cọc', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
      } else if (line.purchaseStatus === 'new') return { label: 'Xác nhận đơn', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
      else if (line.purchaseStatus === 'confirmed') return { label: 'Bàn giao món', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
    }
    return { label: 'Xem đơn', type: 'link', href: `#order/${encodeURIComponent(order.id)}` };
  }

  function getWorkQueue() {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [];
    store.getOrders().forEach((order) => {
      order.lines.forEach((line) => {
        if (line.mode === 'rent' && line.rentalStatus === 'renting' && line.rentalDueDate && line.rentalDueDate <= today) {
          tasks.push({ priority: line.rentalDueDate < today ? 0 : 1, task: line.rentalDueDate < today ? 'Quá hạn trả' : 'Đến hạn trả hôm nay', profile: `${order.id} · ${line.titleSnapshot}`, due: formatDate(line.rentalDueDate), amount: money.format(line.deposit.held), href: `#order/${encodeURIComponent(order.id)}` });
        }
        const unresolved = line.deposit?.held - line.deposit?.refunded - line.deposit?.retained;
        if (line.mode === 'rent' && line.returnedQuantity === line.quantity && unresolved > 0) tasks.push({ priority: 2, task: 'Cọc chờ xử lý', profile: `${order.id} · ${line.titleSnapshot}`, due: formatDateTime(order.createdAt), amount: money.format(unresolved), href: `#order/${encodeURIComponent(order.id)}` });
      });
      const hasNew = order.lines.some((line) => (line.mode === 'rent' ? line.rentalStatus : line.purchaseStatus) === 'new');
      if (hasNew) tasks.push({ priority: 3, task: 'Đơn mới cần xác nhận', profile: `${order.id} · ${order.customer?.name || order.customer?.firstName || 'Khách hàng'}`, due: formatDateTime(order.createdAt), amount: money.format(order.totals?.charges || 0), href: `#order/${encodeURIComponent(order.id)}` });
    });
    store.getInquiries().filter((item) => item.status === 'new').forEach((item) => tasks.push({ priority: 4, task: 'Yêu cầu B2B mới', profile: `${item.organization} · ${item.name}`, due: formatDateTime(item.createdAt), amount: '—', href: `#inquiry/${encodeURIComponent(item.id)}` }));
    return tasks.sort((a, b) => a.priority - b.priority);
  }

  function renderOverview() {
    if (!ensureStore()) return;
    const orders = store.getOrders();
    const inquiries = store.getInquiries();
    const today = new Date().toISOString().slice(0, 10);
    const newOrderCount = orders.filter((order) => order.lines.some((line) => (line.mode === 'rent' ? line.rentalStatus : line.purchaseStatus) === 'new')).length;
    const dueRentals = orders.reduce((count, order) => count + order.lines.filter((line) => line.mode === 'rent' && line.rentalStatus === 'renting' && line.rentalDueDate && line.rentalDueDate <= today).length, 0);
    const depositCount = orders.reduce((count, order) => count + order.lines.filter((line) => line.mode === 'rent' && line.deposit.held > line.deposit.refunded + line.deposit.retained && line.returnedQuantity === line.quantity).length, 0);
    const newInquiries = inquiries.filter((item) => item.status === 'new').length;
    const tasks = getWorkQueue();
    const queue = tasks.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Cần làm</th><th>Hồ sơ</th><th>Hạn / ngày nhận</th><th>Số tiền liên quan</th><th>Hành động</th></tr></thead><tbody>${tasks.map((task) => `<tr><td class="font-extrabold">${escapeHtml(task.task)}</td><td>${escapeHtml(task.profile)}</td><td class="text-[#707168]">${escapeHtml(task.due)}</td><td class="font-bold tabular-nums">${escapeHtml(task.amount)}</td><td><a class="font-extrabold text-[#405b31] underline underline-offset-4" href="${task.href}">Mở hồ sơ</a></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="admin-empty-state"><div><span class="mb-3 inline-grid size-10 place-items-center rounded-full bg-[#f0f0eb] text-[#66685f]">${icon('clipboard-check')}</span><h3>Chưa có việc nào cần xử lý</h3><p>Đơn demo từ trang thanh toán hoặc yêu cầu tư vấn B2B trên cửa hàng sẽ xuất hiện tại đây.</p><a class="admin-button mt-5" href="index.html#featured">Mở cửa hàng để tạo đơn</a></div></div>`;

    view().innerHTML = `
      <section class="admin-view-section" aria-labelledby="overview-title">
        <div class="admin-section-heading"><div><h1 id="overview-title">Việc cần xử lý</h1><p>Đơn cần xác nhận, đồ thuê cần nhận lại và yêu cầu cần phản hồi.</p></div><a class="admin-store-link" href="index.html">${icon('external-link')} Mở cửa hàng</a></div>
        <dl class="admin-stat-row" aria-label="Tình hình cần xử lý"><div><dt class="admin-stat-label">Đơn mới</dt><dd class="admin-stat-value">${newOrderCount}</dd></div><div><dt class="admin-stat-label">Thuê đến hạn/quá hạn</dt><dd class="admin-stat-value">${dueRentals}</dd></div><div><dt class="admin-stat-label">Cọc chờ xử lý</dt><dd class="admin-stat-value">${depositCount}</dd></div><div><dt class="admin-stat-label">Yêu cầu B2B mới</dt><dd class="admin-stat-value">${newInquiries}</dd></div></dl>
        <p class="mt-4 text-sm text-[#55574f]"><strong>${store.getProducts().length}</strong> sản phẩm trong danh mục <span class="mx-2 text-[#b8b8ae]">·</span><span class="font-bold text-[#70521e]">${store.getProducts().some((product) => store.getProductInventory(product).some((row) => !row.configured)) ? 'Tồn kho chưa kiểm kê' : 'Tồn kho đã thiết lập'}</span></p>
        <section class="mt-9" aria-labelledby="queue-title"><div class="mb-4 flex items-end justify-between gap-3"><div><h2 id="queue-title" class="font-[Fredoka,sans-serif] text-2xl font-semibold">Hàng đợi công việc</h2><p class="mt-1 text-sm text-[#707168]">Ưu tiên các việc có hạn trả, tồn kho và cọc cần đối soát.</p></div><a class="admin-secondary-link" href="#orders">Xem đơn hàng</a></div>${queue}</section>
        <aside class="admin-attention mt-4 flex items-start gap-3" aria-label="Thiết lập tồn kho"><span class="mt-0.5 text-[#9a651b]">${icon('alert-triangle')}</span><div class="min-w-0 flex-1"><h2 class="m-0 text-sm font-extrabold">Thiết lập số lượng tồn kho trước khi nhận đơn thuê/bán</h2><p class="mt-1 text-sm leading-5 text-[#707168]">Catalog có ${store.getProducts().length} sản phẩm, nhưng chưa có số lượng vật lý được kiểm kê. Admin sẽ không tự gán hàng sẵn có.</p></div><a class="shrink-0 text-sm font-extrabold text-[#405b31] underline underline-offset-4" href="#products">Mở Sản phẩm</a></aside>
        <footer class="mt-7 border-t border-[#e8e3d9] pt-4 text-xs text-[#707168]">Các số liệu chỉ được tính từ hồ sơ đã lưu trong trình duyệt hiện tại.</footer>
      </section>`;
  }

  function modeLabel(product) {
    if (product.purchaseAvailable && product.rentalPrice14d) return 'Mua đứt và cho thuê';
    if (product.purchaseAvailable) return 'Chỉ mua đứt';
    if (product.rentalPrice14d) return 'Chỉ cho thuê';
    return 'Không khả dụng';
  }

  function stockSummary(product) {
    const rows = store.getProductInventory(product);
    if (rows.some((row) => !row.configured)) return '<span class="admin-stock-unset"><span aria-hidden="true">●</span> Chưa kiểm kê</span>';
    const available = rows.reduce((sum, row) => sum + (row.availableToPromise || 0), 0);
    return `<span class="font-extrabold tabular-nums">${available} bộ có thể đặt</span>`;
  }

  function renderProducts() {
    if (!ensureStore()) return;
    const products = categoryFilters.showArchived ? store.getAllProducts() : store.getProducts();
    const query = categoryFilters.query.toLowerCase();
    const filtered = products.filter((product) => {
      const textMatch = `${product.title} ${product.brand}`.toLowerCase().includes(query);
      const categoryMatch = !categoryFilters.categoryId || product.activityCategoryId === categoryFilters.categoryId;
      const modeMatch = !categoryFilters.mode || (categoryFilters.mode === 'both' ? product.purchaseAvailable && product.rentalPrice14d : categoryFilters.mode === 'buy' ? product.purchaseAvailable && !product.rentalPrice14d : !product.purchaseAvailable && product.rentalPrice14d);
      return textMatch && categoryMatch && modeMatch;
    });
    view().innerHTML = `
      <section class="admin-view-section" aria-labelledby="products-title">
        <div class="admin-section-heading"><div><h1 id="products-title">Sản phẩm</h1><p><strong>${products.length} sản phẩm</strong> <span class="mx-2 text-[#b8b8ae]">·</span>Quản lý giá, hình thức bán và tồn kho</p></div><div class="flex flex-wrap gap-2"><button class="admin-button-secondary" data-action="manage-categories">${icon('category-2')} Quản lý danh mục</button><button class="admin-button" data-action="new-product">${icon('plus')} Thêm sản phẩm</button></div></div>
        <form id="product-filter-form" class="admin-toolbar" role="search"><div class="admin-toolbar-field"><label class="admin-field-label" for="product-search">Tìm sản phẩm</label><input id="product-search" class="field-control" type="search" value="${escapeHtml(categoryFilters.query)}" placeholder="Tìm tên sản phẩm hoặc thương hiệu" /></div><div class="admin-toolbar-field"><label class="admin-field-label" for="product-category-filter">Danh mục hoạt động</label><select id="product-category-filter" class="field-control"><option value="">Tất cả danh mục</option>${store.getCategories().map((category) => `<option value="${escapeHtml(category.id)}" ${categoryFilters.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.title)}</option>`).join('')}</select></div><div class="admin-toolbar-field"><label class="admin-field-label" for="product-mode-filter">Hình thức</label><select id="product-mode-filter" class="field-control"><option value="">Tất cả hình thức</option><option value="both" ${categoryFilters.mode === 'both' ? 'selected' : ''}>Mua đứt và cho thuê</option><option value="buy" ${categoryFilters.mode === 'buy' ? 'selected' : ''}>Chỉ mua đứt</option><option value="rent" ${categoryFilters.mode === 'rent' ? 'selected' : ''}>Chỉ cho thuê</option></select></div><label class="mb-2 flex items-center gap-2 text-sm font-bold"><input id="show-archived-products" type="checkbox" ${categoryFilters.showArchived ? 'checked' : ''} /> Hiện sản phẩm đã ẩn</label><button class="admin-button-secondary" type="submit">Lọc</button></form>
        <div class="admin-table-wrap"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e3d9] px-4 py-3 text-sm"><strong>${filtered.length ? `Tất cả sản phẩm · ${filtered.length}` : 'Không có sản phẩm phù hợp'}</strong><span class="text-xs font-semibold text-[#707168]">Tồn kho chưa nhập cho catalog ban đầu</span></div>
          <table class="admin-table min-w-[1040px]"><thead><tr><th>Sản phẩm</th><th>Danh mục hoạt động</th><th>Mua đứt</th><th>Thuê · 14 ngày</th><th>Tồn kho</th><th class="text-right">Thao tác</th></tr></thead><tbody>${filtered.length ? filtered.map((product) => {
            const image = safeUrl(product.image?.src);
            const buy = product.purchaseAvailable ? (product.buyPriceLabel ? escapeHtml(product.buyPriceLabel) : money.format(product.buyPrice)) : 'Không bán';
            const rent = product.rentalPrice14d ? money.format(product.rentalPrice14d) : 'Không cho thuê';
            const archived = store.isArchived(product.id);
            return `<tr class="${archived ? 'opacity-60' : ''}"><td><div class="flex items-center gap-3"><span class="admin-product-thumb">${image ? `<img src="${image}" alt="${escapeHtml(product.image?.alt || product.title)}" loading="lazy" width="52" height="52" />` : ''}</span><span class="min-w-0"><strong class="block truncate">${escapeHtml(product.title)}${archived ? ' · Đã ẩn' : ''}</strong><small class="mt-1 block truncate text-[#707168]">${escapeHtml(product.brand)} · ${escapeHtml(product.category)}</small></span></div></td><td class="text-[13px] leading-5">${escapeHtml(store.getCategories().find((category) => category.id === product.activityCategoryId)?.title || 'Chưa phân loại')}</td><td class="font-bold tabular-nums">${buy}</td><td>${product.rentalPrice14d ? `<strong class="block tabular-nums">${rent}</strong><small class="text-[#707168]">/ 14 ngày</small>` : '<span class="text-[#77786f]">Không cho thuê</span>'}</td><td>${stockSummary(product)}</td><td class="text-right"><button class="admin-text-button" data-action="edit-product" data-id="${escapeHtml(product.id)}" type="button">Sửa</button> <button class="admin-text-button ${archived ? '' : 'admin-text-button--danger'}" data-action="${archived ? 'restore-product' : 'archive-product'}" data-id="${escapeHtml(product.id)}" type="button">${archived ? 'Khôi phục' : 'Ẩn'}</button></td></tr>`;
          }).join('') : `<tr><td colspan="6"><div class="py-10 text-center text-sm text-[#707168]">Thử thay đổi cụm tìm kiếm hoặc bộ lọc.</div></td></tr>`}</tbody></table>
          <div class="flex justify-between gap-3 border-t border-[#e8e3d9] px-4 py-3 text-xs text-[#707168]"><span>Đang hiển thị toàn bộ <strong>${filtered.length} sản phẩm</strong></span><span class="hidden sm:inline">Số lượng còn trống sau khi kiểm kê</span></div></div>
        <p class="mt-3 text-xs leading-5 text-[#707168]">Nhóm hoạt động dùng cho phân loại; nhãn sản phẩm vẫn được quản lý riêng.</p>
      </section>`;
  }

  function parseVariantLines(value) {
    return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const parts = line.split('|').map((part) => part.trim());
      if (parts.length < 3) throw new Error(`Biến thể dòng ${index + 1} cần có dạng: mã | tên | giá.`);
      return { id: parts[0], label: parts[1], price: Number(parts[2].replace(/[ ,.₫]/g, '')) };
    });
  }

  function renderProductEditor(id) {
    if (!ensureStore()) return;
    const isNew = id === 'new';
    const product = isNew ? null : store.getProduct(id, true);
    if (!isNew && !product) {
      view().innerHTML = '<section class="admin-empty-state"><div><h3>Không tìm thấy sản phẩm</h3><p>Sản phẩm có thể đã bị xóa hoặc đường dẫn không còn hợp lệ.</p><a class="admin-button mt-5" href="#products">Quay lại sản phẩm</a></div></section>';
      return;
    }
    const categories = store.getCategories();
    const variants = product?.variants || [];
    const variantText = variants.map((variant) => `${variant.id} | ${variant.label} | ${variant.price}`).join('\n');
    const inventoryRows = variants.length ? variants : [{ id: '', label: 'Sản phẩm' }];
    const imageUrl = product?.image?.src || '';
    const productTitle = product?.title || '';
    view().innerHTML = `
      <section class="admin-view-section" aria-labelledby="product-editor-title">
        <div class="admin-breadcrumbs"><a href="#products">← Sản phẩm</a><span>/</span><span>${isNew ? 'Thêm sản phẩm' : escapeHtml(productTitle)}</span><a class="ml-auto admin-secondary-link" href="product.html?id=${encodeURIComponent(id === 'new' ? '' : id)}">${icon('external-link')} Mở cửa hàng</a></div>
        <div class="admin-section-heading"><div><h1 id="product-editor-title">${isNew ? 'Thêm sản phẩm' : 'Chỉnh sửa sản phẩm'}</h1><p>Cập nhật thông tin và hình thức kinh doanh. Thay đổi chỉ lưu trong trình duyệt này.</p></div>${!isNew ? `<span class="font-mono text-xs text-[#707168]">ID: ${escapeHtml(product.id)}</span>` : ''}</div>
        <form id="admin-product-form" class="admin-editor-grid" novalidate data-id="${escapeHtml(id)}">
          <div class="min-w-0">
            <section class="admin-form-section"><h2>Thông tin sản phẩm</h2><div class="admin-form-grid">
              <div class="admin-form-full"><label class="admin-field-label" for="editor-title">Tên sản phẩm *</label><input id="editor-title" class="field-control" name="title" required maxlength="160" value="${escapeHtml(product?.title || '')}" /></div>
              <div><label class="admin-field-label" for="editor-brand">Thương hiệu *</label><input id="editor-brand" class="field-control" name="brand" required maxlength="100" value="${escapeHtml(product?.brand || '')}" /></div>
              <div><label class="admin-field-label" for="editor-age">Độ tuổi khuyến nghị</label><input id="editor-age" class="field-control" name="ageRange" maxlength="80" value="${escapeHtml(product?.ageRange || '')}" /></div>
              <div><label class="admin-field-label" for="editor-activity-category">Danh mục hoạt động *</label><select id="editor-activity-category" class="field-control" name="activityCategoryId" required>${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${product?.activityCategoryId === category.id ? 'selected' : ''}>${escapeHtml(category.title)}</option>`).join('')}</select></div>
              <div><label class="admin-field-label" for="editor-category-label">Nhãn hiển thị</label><input id="editor-category-label" class="field-control" name="category" maxlength="120" value="${escapeHtml(product?.category || '')}" /><p class="admin-field-help">Nhãn ngắn trên thẻ sản phẩm; không thay danh mục hoạt động.</p></div>
              <div class="admin-form-full"><label class="admin-field-label" for="editor-description">Mô tả sản phẩm *</label><textarea id="editor-description" class="field-control min-h-28 resize-y" name="description" required maxlength="1800">${escapeHtml(product?.description || '')}</textarea></div>
            </div></section>
            <section class="admin-form-section"><h2>Hình thức kinh doanh</h2><div class="grid gap-3 sm:grid-cols-2"><label class="admin-check-row ${product?.purchaseAvailable === false ? 'opacity-60' : ''}"><input name="purchaseAvailable" type="checkbox" ${!product || product.purchaseAvailable !== false ? 'checked' : ''} ${product?.purchaseAvailable === false ? 'disabled' : ''} /><span><strong class="block text-sm">Mua đứt</strong><small class="text-[#707168]">Cho phép đặt mua</small></span>${product?.purchaseAvailable === false ? '<small class="ml-auto font-bold">Không áp dụng</small>' : ''}</label><label class="admin-check-row"><input name="rentalEnabled" type="checkbox" ${product?.rentalPrice14d ? 'checked' : ''} /><span><strong class="block text-sm">Cho thuê</strong><small class="text-[#707168]">Kỳ thuê cố định 14 ngày</small></span></label></div>
              <div class="admin-form-grid mt-4"><div><label class="admin-field-label" for="editor-buy-price">${product?.purchaseAvailable === false ? 'Giá trị tham khảo' : 'Giá mua đứt'} *</label><input id="editor-buy-price" class="field-control" name="buyPrice" type="number" min="1" step="1" required value="${product?.buyPrice || ''}" /><p class="admin-field-help">Giá số dùng cho phép tính; không nhập ký tự tiền tệ.</p></div><div><label class="admin-field-label" for="editor-buy-price-label">Nhãn giá hiển thị</label><input id="editor-buy-price-label" class="field-control" name="buyPriceLabel" maxlength="100" value="${escapeHtml(product?.buyPriceLabel || '')}" /><p class="admin-field-help">Chỉ đổi nhãn trên trang; không đổi giá trong phép tính đơn.</p></div><div><label class="admin-field-label" for="editor-rent-price">Phí thuê · 14 ngày</label><input id="editor-rent-price" class="field-control" name="rentalPrice14d" type="number" min="1" step="1" value="${product?.rentalPrice14d || ''}" ${product?.rentalPrice14d ? 'required' : 'disabled'} /><p class="admin-field-help">Bật Cho thuê để nhập phí theo một kỳ 14 ngày.</p></div><div><label class="admin-field-label" for="editor-deposit-reference">Giá trị tham khảo để tính cọc</label><input id="editor-deposit-reference" class="field-control" name="depositReferenceValue" type="number" min="1" step="1" value="${product?.depositReferenceValue || product?.buyPrice || ''}" ${product?.rentalPrice14d ? 'required' : 'disabled'} /><p class="admin-field-help">Cọc demo = 70% giá trị tham khảo, làm tròn 1.000 ₫.</p></div><div class="admin-form-full"><label class="admin-field-label" for="editor-price-note">Ghi chú giá</label><input id="editor-price-note" class="field-control" name="priceNote" maxlength="300" value="${escapeHtml(product?.priceNote || '')}" /></div><div class="admin-form-full"><label class="admin-field-label" for="editor-rental-note">Ghi chú thuê</label><input id="editor-rental-note" class="field-control" name="rentalNote" maxlength="240" value="${escapeHtml(product?.rentalNote || '')}" /></div></div>
              <div class="mt-4"><label class="admin-field-label" for="editor-variants">Biến thể và giá (mỗi dòng: mã | tên | giá)</label><textarea id="editor-variants" class="field-control min-h-24 resize-y font-mono text-xs" name="variants">${escapeHtml(variantText)}</textarea><p class="admin-field-help">Ví dụ: level-4 | Cấp 4 | 310000. Để trống nếu sản phẩm không có biến thể.</p></div>
            </section>
            <section class="admin-form-section"><div class="mb-3 flex items-center justify-between"><h2 class="m-0">Tồn kho</h2><span class="admin-stock-unset">${inventoryRows.some((variant) => !store.getInventory(product?.id || '', variant.id || '')?.configured) ? 'Chưa thiết lập' : 'Đã kiểm kê'}</span></div><p class="mb-4 text-sm leading-6 text-[#707168]">Nhập số lượng bộ vật lý sau khi kiểm kê. Hàng chưa cấu hình sẽ không được nhận đơn; không tự suy ra số lượng từ danh mục.</p><div class="admin-form-grid">${inventoryRows.map((variant) => { const stock = product ? store.getInventory(product.id, variant.id || '') : null; return `<div><label class="admin-field-label" for="stock-${escapeHtml(variant.id || 'base')}">Số lượng vật lý${variants.length ? ` · ${escapeHtml(variant.label)}` : ''}</label><input id="stock-${escapeHtml(variant.id || 'base')}" class="field-control" data-stock-variant="${escapeHtml(variant.id || '')}" type="number" min="0" step="1" placeholder="Nhập số lượng khi đã kiểm kê" value="${stock?.configured ? stock.physicalUnits : ''}" /><p class="admin-field-help">${stock?.configured ? `${stock.availableToPromise} bộ đang có thể đặt.` : 'Chưa có số lượng được xác nhận.'}</p></div>`; }).join('')}</div></section>
            <section class="admin-form-section"><h2>Hình ảnh sản phẩm</h2><div class="admin-form-grid"><div class="admin-form-full"><label class="admin-field-label" for="editor-image-url">URL ảnh chính *</label><input id="editor-image-url" class="field-control" name="imageSrc" type="url" required value="${escapeHtml(imageUrl)}" /><p class="admin-field-help">Chỉ nhận URL http/https. Dùng ảnh đúng sản phẩm trước khi công khai.</p></div><div class="admin-form-full"><label class="admin-field-label" for="editor-image-alt">Mô tả ảnh</label><input id="editor-image-alt" class="field-control" name="imageAlt" maxlength="300" value="${escapeHtml(product?.image?.alt || '')}" /></div></div></section>
            <div id="product-form-message" class="admin-inline-message" role="alert" hidden></div>
            <footer class="admin-sticky-actions"><a href="#products" class="admin-secondary-link">Hủy</a><button class="admin-button" type="submit">Lưu sản phẩm</button></footer>
          </div>
          <aside class="admin-preview"><div class="flex items-center justify-between border-b border-[#e8e3d9] px-4 py-3"><h2 class="m-0 text-sm font-extrabold">Xem trước ảnh</h2><span class="text-xs text-[#707168]">Ảnh chính</span></div><img id="product-preview-image" src="${safeUrl(imageUrl)}" alt="${escapeHtml(product?.image?.alt || '')}" width="600" height="450" /><div class="px-4 py-3"><strong id="product-preview-title" class="block text-sm">${escapeHtml(productTitle || 'Tên sản phẩm')}</strong><span id="product-preview-brand" class="mt-1 block text-xs text-[#707168]">${escapeHtml(product?.brand || 'Thương hiệu')} · ${escapeHtml(product?.ageRange || 'Độ tuổi')}</span></div></aside>
        </form>
      </section>`;
  }

  function renderCategories() {
    if (!ensureStore()) return;
    const categories = store.getCategories();
    view().innerHTML = `<section><div class="admin-section-heading"><div><div class="admin-breadcrumbs"><a href="#products">← Sản phẩm</a></div><h1>Quản lý danh mục</h1><p>Năm nhóm hoạt động đang liên kết với catalog.</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Danh mục hoạt động</th><th>Mô tả</th><th>Sản phẩm</th><th></th></tr></thead><tbody>${categories.map((category) => `<tr><td class="font-extrabold">${escapeHtml(category.title)}</td><td>${escapeHtml(category.description)}</td><td>${store.getProducts().filter((product) => product.activityCategoryId === category.id).length}</td><td class="text-right"><button class="admin-text-button" data-action="edit-category" data-id="${escapeHtml(category.id)}" type="button">Sửa</button></td></tr>`).join('')}</tbody></table></div><p class="mt-3 text-xs text-[#707168]">Danh mục đang được sản phẩm sử dụng không thể xóa; hãy chuyển sản phẩm sang nhóm khác trước khi thay đổi liên kết.</p></section>`;
  }

  function renderCategoryEditor(id) {
    const category = store.getCategories().find((item) => item.id === id);
    if (!category) { view().innerHTML = '<p>Không tìm thấy danh mục.</p>'; return; }
    view().innerHTML = `<section><div class="admin-breadcrumbs"><a href="#categories">← Danh mục</a><span>/</span><span>${escapeHtml(category.title)}</span></div><div class="admin-section-heading"><div><h1>Sửa danh mục</h1><p>Mã danh mục được giữ ổn định để các trang sản phẩm tiếp tục hoạt động.</p></div></div><form id="admin-category-form" class="admin-editor-grid"><div class="admin-form-stack"><input type="hidden" name="id" value="${escapeHtml(category.id)}" /><div><label class="admin-field-label" for="category-title">Tên danh mục *</label><input class="field-control" id="category-title" name="title" required maxlength="100" value="${escapeHtml(category.title)}" /></div><div><label class="admin-field-label" for="category-description">Mô tả</label><textarea class="field-control min-h-24" id="category-description" name="description" maxlength="220">${escapeHtml(category.description)}</textarea></div><div><label class="admin-field-label" for="category-image">URL ảnh</label><input class="field-control" id="category-image" name="image" type="url" value="${escapeHtml(category.image?.src || '')}" /></div><div id="category-form-message" class="admin-inline-message" role="alert" hidden></div><div class="flex gap-2"><a href="#categories" class="admin-secondary-link">Hủy</a><button type="submit" class="admin-button">Lưu danh mục</button></div></div><aside class="admin-preview">${safeUrl(category.image?.src) ? `<img src="${safeUrl(category.image.src)}" alt="${escapeHtml(category.image.alt || category.title)}" />` : ''}<div class="px-4 py-3"><strong>${escapeHtml(category.title)}</strong></div></aside></form></section>`;
  }

  function renderOrders() {
    if (!ensureStore()) return;
    const all = store.getOrders();
    const query = orderFilters.query.toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const filtered = all.filter((order) => {
      const text = `${order.id} ${order.customer?.email || ''} ${order.customer?.phone || ''} ${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.toLowerCase();
      const hasBuy = order.lines.some((line) => line.mode === 'buy');
      const hasRent = order.lines.some((line) => line.mode === 'rent');
      const hasDue = order.lines.some((line) => line.mode === 'rent' && line.rentalStatus === 'renting' && line.rentalDueDate === today);
      const hasOverdue = order.lines.some((line) => line.mode === 'rent' && line.rentalStatus === 'renting' && line.rentalDueDate && line.rentalDueDate < today);
      const hasDeposit = order.lines.some((line) => line.mode === 'rent' && line.returnedQuantity === line.quantity && line.deposit.held > line.deposit.refunded + line.deposit.retained);
      const modeMatch = orderFilters.mode === 'all' || (orderFilters.mode === 'buy' && hasBuy) || (orderFilters.mode === 'rent' && hasRent) || (orderFilters.mode === 'due' && hasDue) || (orderFilters.mode === 'overdue' && hasOverdue) || (orderFilters.mode === 'deposit' && hasDeposit);
      return text.includes(query) && modeMatch;
    }).sort((a, b) => orderFilters.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
    const filterTabs = [['all', 'Tất cả'], ['buy', 'Có món mua đứt'], ['rent', 'Có món thuê'], ['due', 'Đến hạn trả'], ['overdue', 'Quá hạn'], ['deposit', 'Cọc chờ xử lý']];
    const rows = filtered.map((order) => {
      const next = orderNextAction(order);
      const customer = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') || order.customer?.email || order.customer?.phone || 'Khách hàng';
      const items = order.lines.map((line) => `${line.titleSnapshot} · ${line.mode === 'rent' ? 'Thuê' : 'Mua đứt'} × ${line.quantity}`).join(' / ');
      return `<tr><td><strong class="block">${escapeHtml(order.id)}</strong><small class="text-[#707168]">${escapeHtml(formatDateTime(order.createdAt))}</small></td><td><strong class="block">${escapeHtml(customer)}</strong><small class="text-[#707168]">${escapeHtml(order.customer?.phone || order.customer?.email || '')}</small></td><td class="max-w-[19rem] text-[13px] leading-5">${escapeHtml(items)}</td><td><a class="font-extrabold text-[#405b31] underline underline-offset-4" href="#order/${encodeURIComponent(order.id)}">${escapeHtml(next.label)}</a></td><td class="text-right font-extrabold tabular-nums">${money.format(order.totals?.charges || 0)}<small class="block font-semibold text-[#707168]">Cọc: ${money.format(order.totals?.depositHeld || 0)}</small></td></tr>`;
    }).join('');
    view().innerHTML = `<section><div class="admin-section-heading"><div><h1>Đơn hàng <span class="ml-2 align-middle font-[Nunito,sans-serif] text-sm font-extrabold text-[#707168]">${all.length} đơn</span></h1><p>Tìm đơn mua đứt, thuê 14 ngày và các nghĩa vụ còn cần xử lý.</p></div><label class="flex items-center gap-2 text-sm font-bold">Sắp xếp<select id="order-sort" class="field-control min-h-10 w-auto"><option value="newest" ${orderFilters.sort === 'newest' ? 'selected' : ''}>Mới nhất</option><option value="oldest" ${orderFilters.sort === 'oldest' ? 'selected' : ''}>Cũ nhất</option></select></label></div><form id="order-search-form" class="admin-toolbar border-b border-[#e8e3d9] pb-4"><div class="admin-toolbar-field max-w-[420px]"><label for="order-search" class="sr-only">Tìm theo mã đơn, khách hàng hoặc liên hệ</label><input id="order-search" class="field-control" type="search" placeholder="Tìm mã đơn, khách hàng hoặc liên hệ" value="${escapeHtml(orderFilters.query)}" /></div><button type="submit" class="admin-button-secondary">Lọc</button></form><div class="admin-filter-tabs mt-3" role="group" aria-label="Lọc đơn hàng">${filterTabs.map(([id, label]) => `<button class="admin-filter-tab" data-action="order-filter" data-mode="${id}" aria-pressed="${orderFilters.mode === id}" type="button">${label}</button>`).join('')}</div><p class="my-4 text-sm font-semibold text-[#707168]">${filtered.length} đơn hàng phù hợp</p>${filtered.length ? `<div class="admin-table-wrap"><table class="admin-table min-w-[960px]"><thead><tr><th>Mã đơn / Ngày tạo</th><th>Khách hàng / Liên hệ</th><th>Mặt hàng</th><th>Cần xử lý tiếp</th><th class="text-right">Tổng tiền</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="admin-table-wrap"><div class="admin-empty-state"><div><span class="mb-3 inline-grid size-10 place-items-center rounded-full bg-[#f0f0eb] text-[#66685f]">${icon('receipt-off')}</span><h3>${all.length ? 'Không có đơn hàng phù hợp' : 'Chưa có đơn hàng nào'}</h3><p>${all.length ? 'Thử đổi bộ lọc hoặc cụm tìm kiếm.' : 'Đơn sẽ xuất hiện sau khi gửi biểu mẫu thanh toán hợp lệ. Hồ sơ demo chỉ lưu trong trình duyệt này.'}</p>${all.length ? '' : '<a href="index.html#featured" class="admin-button mt-5">Mở cửa hàng để tạo đơn demo</a>'}</div></div></div>`}<aside class="admin-attention mt-4 flex items-start justify-between gap-4"><p class="m-0 max-w-3xl text-sm leading-6 text-[#55574f]">Các bộ lọc giúp tìm đơn có mua đứt, món thuê, lịch trả và tiền cọc chưa xử lý. Nghĩa vụ trả đồ và hoàn cọc được theo dõi riêng trong chi tiết từng đơn.</p><a href="#overview" class="admin-secondary-link">Xem tổng quan</a></aside></section>`;
  }

  function renderOrder(orderId) {
    if (!ensureStore()) return;
    const order = store.getOrder(orderId);
    if (!order) { view().innerHTML = '<section class="admin-empty-state"><div><h3>Không tìm thấy đơn hàng</h3><p>Đơn hàng có thể đã thay đổi ở tab khác hoặc chưa được tạo.</p><a href="#orders" class="admin-button mt-5">Quay lại danh sách</a></div></section>'; return; }
    const customerName = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') || 'Khách hàng';
    const lines = order.lines.map((line) => {
      const image = safeUrl(line.imageSnapshot?.src);
      const status = lineModeStatus(line);
      const amount = line.unitPrice * line.quantity;
      const lineState = line.mode === 'rent' ? line.rentalStatus : line.purchaseStatus;
      const confirmAction = lineState === 'new' ? `<button class="admin-text-button" data-action="confirm-line" data-order-id="${escapeHtml(order.id)}" data-line-id="${escapeHtml(line.lineId)}" type="button">Xác nhận</button>` : '';
      const handoffAction = line.mode === 'buy' && lineState === 'confirmed' ? `<button class="admin-text-button" data-action="handoff-purchase" data-order-id="${escapeHtml(order.id)}" data-line-id="${escapeHtml(line.lineId)}" type="button">Bàn giao</button>` : '';
      const completeAction = line.mode === 'buy' && lineState === 'handedOff' ? `<button class="admin-text-button" data-action="complete-purchase" data-order-id="${escapeHtml(order.id)}" data-line-id="${escapeHtml(line.lineId)}" type="button">Hoàn tất</button>` : '';
      const cancelAction = ['new', 'confirmed'].includes(lineState) ? `<button class="admin-text-button admin-text-button--danger" data-action="cancel-line" data-order-id="${escapeHtml(order.id)}" data-line-id="${escapeHtml(line.lineId)}" type="button">Hủy dòng</button>` : '';
      return `<tr><td><div class="flex items-center gap-3">${image ? `<img class="size-12 rounded-lg object-cover" src="${image}" alt="${escapeHtml(line.imageSnapshot?.alt || line.titleSnapshot)}" width="48" height="48" />` : ''}<span><strong class="block">${escapeHtml(line.titleSnapshot)}</strong><small class="text-[#707168]">${escapeHtml(line.brandSnapshot)} · ID ${escapeHtml(line.productId)}</small></span></div></td><td class="font-bold">${line.mode === 'rent' ? 'Thuê · 14 ngày' : 'Mua đứt'}</td><td class="text-right tabular-nums">${line.quantity}</td><td class="text-right tabular-nums">${money.format(line.unitPrice)}</td><td class="text-right font-extrabold tabular-nums">${money.format(amount)}</td><td><strong>${escapeHtml(status)}</strong>${line.deposit.held ? `<small class="block text-[#707168]">Cọc ${money.format(line.deposit.held)}</small>` : ''}<div class="mt-1 flex flex-wrap gap-2">${confirmAction}${handoffAction}${completeAction}${cancelAction}</div></td></tr>`;
    }).join('');
    const rentalLines = order.lines.filter((line) => line.mode === 'rent');
    const rentalPanels = rentalLines.length ? rentalLines.map((line) => renderRentalPanel(order, line)).join('') : '<p class="text-sm text-[#707168]">Đơn này không có dòng thuê.</p>';
    view().innerHTML = `<section><div class="admin-breadcrumbs"><a href="#orders">Đơn hàng</a><span>/</span><span>Chi tiết</span><a href="#orders" class="ml-auto">← Quay lại danh sách</a></div><div class="admin-section-heading"><div><h1>Chi tiết đơn hàng</h1><p>Các trạng thái và khoản tiền được theo dõi theo từng dòng sản phẩm.</p></div><span class="admin-stock-unset">Mô phỏng · chưa thu tiền</span></div><div class="admin-alert mb-5 flex items-start gap-3 rounded-lg px-4 py-3 text-sm leading-5"><span class="mt-0.5">${icon('alert-triangle')}</span><p><strong>Bản ghi demo — chưa phải giao dịch thật.</strong> Hồ sơ và các thay đổi chỉ lưu trong trình duyệt hiện tại. Thanh toán/hoàn tiền chưa được thực hiện.</p></div><div class="admin-order-summary"><div><small class="text-[#707168]">Thông tin khách</small><p class="font-extrabold">${escapeHtml(customerName)}</p><p>${escapeHtml(order.customer?.phone || '')} ${order.customer?.email ? `· ${escapeHtml(order.customer.email)}` : ''}</p><p class="text-[#707168]">${escapeHtml(order.fulfillment === 'pickup' ? order.customer?.pickupPoint || 'Nhận tại điểm hẹn demo' : [order.customer?.address, order.customer?.ward, order.customer?.city, order.customer?.province].filter(Boolean).join(', '))}</p></div><div><small class="text-[#707168]">Thanh toán</small><p class="font-extrabold">Mô phỏng — chưa thu tiền</p><p class="text-[#707168]">${escapeHtml(order.payment?.method || 'online-demo')} · không có cổng thanh toán</p></div><div><small class="text-[#707168]">Phí sản phẩm</small><p class="font-extrabold tabular-nums">${money.format(order.totals?.charges || 0)}</p><p class="text-[#707168]">Cọc không bao gồm trong khoản này</p></div><div><small class="text-[#707168]">Cọc chờ xử lý</small><p class="font-extrabold tabular-nums">${money.format(order.totals?.depositHeld || 0)}</p><p class="text-[#707168]">Tách riêng, không phải doanh thu</p></div></div><section class="mt-6" aria-labelledby="order-lines-title"><div class="mb-3 flex items-end justify-between"><h2 id="order-lines-title" class="font-[Fredoka,sans-serif] text-xl font-semibold">Sản phẩm trong đơn</h2><span class="text-sm text-[#707168]">${order.lines.length} dòng · ${order.lines.reduce((sum, line) => sum + line.quantity, 0)} món</span></div><div class="admin-table-wrap"><table class="admin-table min-w-[780px]"><thead><tr><th>Sản phẩm</th><th>Hình thức</th><th class="text-right">SL</th><th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th><th>Trạng thái</th></tr></thead><tbody>${lines}</tbody></table></div></section><section class="admin-section-rule mt-8" aria-labelledby="rental-operations-title"><h2 id="rental-operations-title" class="font-[Fredoka,sans-serif] text-xl font-semibold">Nghĩa vụ thuê và đối soát cọc</h2>${rentalPanels}</section><section class="admin-section-rule mt-7" aria-labelledby="order-history-title"><h2 id="order-history-title" class="text-base font-extrabold">Lịch sử xử lý</h2><ol class="mt-3 space-y-2">${(order.history || []).map((event) => `<li class="flex gap-3 text-sm"><time class="shrink-0 text-[#707168]">${escapeHtml(formatDateTime(event.at))}</time><span><strong>${escapeHtml(event.type)}</strong>${event.note ? ` · ${escapeHtml(event.note)}` : ''}</span></li>`).join('')}${order.lines.flatMap((line) => line.history || []).map((event) => `<li class="flex gap-3 text-sm"><time class="shrink-0 text-[#707168]">${escapeHtml(formatDateTime(event.at))}</time><span><strong>${escapeHtml(event.type)}</strong> · ${escapeHtml(lineTitle(order, event, line))}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</span></li>`).join('')}</ol></section></section>`;
  }

  function lineTitle(order, event, line) { return line.titleSnapshot || ''; }

  function renderRentalPanel(order, line) {
    const unresolved = line.deposit.held - line.deposit.refunded - line.deposit.retained;
    const outstanding = line.quantity - line.returnedQuantity;
    const canHandoff = line.rentalStatus === 'confirmed';
    const canReturn = line.rentalStatus === 'renting' && outstanding > 0;
    const canResolve = line.returnedQuantity === line.quantity && unresolved > 0;
    return `<section class="mt-5 border-t border-[#e8e3d9] pt-5" data-rental-line="${escapeHtml(line.lineId)}"><div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 class="text-base font-extrabold">${escapeHtml(line.titleSnapshot)}</h3><p class="mt-1 text-sm text-[#707168]">${line.quantity} món · phí thuê ${money.format(line.unitRentalFee * line.quantity)} · cọc hoàn lại ${money.format(line.deposit.held)}</p></div><span class="admin-stock-unset">${escapeHtml(lineModeStatus(line))}</span></div><div class="admin-rental-grid"><div><form class="admin-handoff-form" data-line-id="${escapeHtml(line.lineId)}"><label class="admin-field-label" for="handoff-${escapeHtml(line.lineId)}">Ngày bàn giao</label><div class="flex flex-wrap items-end gap-2"><input id="handoff-${escapeHtml(line.lineId)}" class="field-control max-w-[230px]" name="handoffDate" type="date" value="${escapeHtml(line.rentalHandoffDate || '')}" ${!canHandoff ? 'disabled' : ''} required /><button class="admin-button" type="submit" ${!canHandoff ? 'disabled' : ''}>${line.rentalHandoffDate ? 'Đã xác nhận bàn giao' : 'Xác nhận giao đồ thuê'}</button></div><p class="admin-field-help">${line.rentalDueDate ? `Ngày trả dự kiến: <strong>${escapeHtml(formatDate(line.rentalDueDate))}</strong> · 14 ngày sau bàn giao.` : 'Ngày trả dự kiến chỉ được tính sau khi nhập và xác nhận ngày bàn giao.'}</p></form><div class="admin-section-rule mt-5"><div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 class="m-0 text-sm font-extrabold">Ghi nhận trả đồ</h4><span class="text-sm font-bold">Đã nhận ${line.returnedQuantity} / ${line.quantity} · còn ${outstanding}</span></div><form class="admin-return-form admin-form-grid" data-line-id="${escapeHtml(line.lineId)}"><div><label class="admin-field-label" for="return-qty-${escapeHtml(line.lineId)}">Số lượng nhận</label><input id="return-qty-${escapeHtml(line.lineId)}" class="field-control" name="quantity" type="number" min="1" max="${outstanding}" value="${outstanding > 0 ? 1 : ''}" required ${!canReturn ? 'disabled' : ''} /></div><div><label class="admin-field-label" for="return-destination-${escapeHtml(line.lineId)}">Tình trạng sau kiểm tra</label><select id="return-destination-${escapeHtml(line.lineId)}" class="field-control" name="destination" ${!canReturn ? 'disabled' : ''}><option value="available">Có sẵn</option><option value="inspection">Chờ kiểm tra</option></select></div><div class="admin-form-full"><button type="submit" class="admin-button-secondary" ${!canReturn ? 'disabled' : ''}>Ghi nhận trả đồ</button></div></form><p class="admin-field-help">Hàng “Chờ kiểm tra” không được cộng vào số có thể đặt cho đến khi xử lý xong.</p></div></div><div class="admin-detail-pane"><div class="flex items-center justify-between gap-3"><h4 class="m-0 text-sm font-extrabold">Đối soát cọc hoàn lại</h4><span class="text-xs text-[#707168]">Tách biệt với phí thuê</span></div><dl class="mt-3 space-y-2 border-y border-[#e2dfd8] py-3 text-sm"><div class="flex justify-between gap-3"><dt>Đã ghi nhận hoàn</dt><dd class="m-0 font-bold tabular-nums">${money.format(line.deposit.refunded)}</dd></div><div class="flex justify-between gap-3"><dt>Đã ghi nhận giữ lại</dt><dd class="m-0 font-bold tabular-nums">${money.format(line.deposit.retained)}</dd></div><div class="flex justify-between gap-3"><dt>Còn chờ xử lý</dt><dd class="m-0 font-extrabold tabular-nums text-[#79591c]">${money.format(unresolved)}</dd></div></dl><form class="admin-deposit-form admin-form-stack mt-4" data-line-id="${escapeHtml(line.lineId)}"><div class="admin-form-grid"><div><label class="admin-field-label" for="deposit-refund-${escapeHtml(line.lineId)}">Tổng tiền ghi nhận hoàn</label><input id="deposit-refund-${escapeHtml(line.lineId)}" class="field-control" name="refunded" type="number" min="0" max="${line.deposit.held}" step="1" value="${line.deposit.refunded}" ${!canResolve ? 'disabled' : ''} /></div><div><label class="admin-field-label" for="deposit-retain-${escapeHtml(line.lineId)}">Tổng tiền giữ lại</label><input id="deposit-retain-${escapeHtml(line.lineId)}" class="field-control" name="retained" type="number" min="0" max="${line.deposit.held}" step="1" value="${line.deposit.retained}" ${!canResolve ? 'disabled' : ''} /></div><div class="admin-form-full"><label class="admin-field-label" for="deposit-reason-${escapeHtml(line.lineId)}">Lý do giữ lại (bắt buộc nếu giữ cọc)</label><input id="deposit-reason-${escapeHtml(line.lineId)}" class="field-control" name="reason" value="${escapeHtml(line.deposit.reason)}" ${!canResolve ? 'disabled' : ''} /></div></div><button type="submit" class="admin-button-secondary w-full" ${!canResolve ? 'disabled' : ''}>Ghi nhận hoàn cọc</button></form><p class="admin-field-help">Thao tác chỉ ghi nhận trong demo; không chuyển khoản hoặc hoàn tiền thật.</p></div></div></section>`;
  }

  function renderInquiries() {
    if (!ensureStore()) return;
    const inquiries = store.getInquiries();
    const query = inquiryFilters.query.toLowerCase();
    const filtered = inquiries.filter((item) => `${item.organization} ${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(query) && (inquiryFilters.status === 'all' || item.status === inquiryFilters.status));
    if (!filtered.some((item) => item.id === inquiryFilters.selectedId)) inquiryFilters.selectedId = filtered[0]?.id || '';
    const selected = store.getInquiries().find((item) => item.id === inquiryFilters.selectedId);
    const rows = filtered.map((item) => `<button type="button" class="admin-inquiry-row ${item.id === inquiryFilters.selectedId ? 'is-selected' : ''}" data-action="select-inquiry" data-id="${escapeHtml(item.id)}"><span><strong class="block">${escapeHtml(item.organization)}</strong><small class="text-[#707168]">${escapeHtml(item.name)} · ${escapeHtml(item.email)}</small></span><time>${escapeHtml(formatDateTime(item.createdAt))}</time><span class="admin-status">${escapeHtml(statusLabels[item.status])}</span></button>`).join('');
    const details = selected ? `<div><h2 class="text-base font-extrabold">Chi tiết yêu cầu</h2><dl class="mt-4 space-y-3 text-sm"><div><dt class="text-[#707168]">Tổ chức</dt><dd class="mt-1 font-extrabold">${escapeHtml(selected.organization)}</dd></div><div><dt class="text-[#707168]">Người liên hệ</dt><dd class="mt-1 font-bold">${escapeHtml(selected.name)}</dd></div><div><dt class="text-[#707168]">Điện thoại</dt><dd class="mt-1"><a href="tel:${escapeHtml(selected.phone)}">${escapeHtml(selected.phone)}</a></dd></div><div><dt class="text-[#707168]">Email</dt><dd class="mt-1"><a href="mailto:${escapeHtml(selected.email)}">${escapeHtml(selected.email)}</a></dd></div><div><dt class="text-[#707168]">Ngày nhận</dt><dd class="mt-1">${escapeHtml(formatDateTime(selected.createdAt))}</dd></div></dl><form class="admin-inquiry-update-form mt-5" data-id="${escapeHtml(selected.id)}"><label class="admin-field-label" for="inquiry-notes">Ghi chú theo dõi</label><textarea id="inquiry-notes" class="field-control min-h-24 resize-y" name="note" maxlength="1200">${escapeHtml(selected.notes || '')}</textarea><label class="admin-field-label mt-4" for="inquiry-outcome">Kết quả khi đóng yêu cầu</label><input id="inquiry-outcome" class="field-control" name="outcome" value="${escapeHtml(selected.closedOutcome || '')}" placeholder="Nhập ghi chú trước khi đóng yêu cầu" /><div class="mt-4 flex flex-wrap gap-2">${selected.status === 'new' ? '<button class="admin-button" name="status" value="contacted" type="submit">Đánh dấu đã liên hệ</button>' : ''}${selected.status !== 'closed' ? '<button class="admin-button-secondary" name="status" value="closed" type="submit">Đóng yêu cầu</button>' : '<button class="admin-button-secondary" name="status" value="contacted" type="submit">Mở lại yêu cầu</button>'}<button class="admin-text-button" name="status" value="${escapeHtml(selected.status)}" type="submit">Lưu ghi chú</button></div></form><h3 class="mt-6 text-sm font-extrabold">Lịch sử trạng thái</h3><ol class="mt-2 space-y-2">${(selected.history || []).map((event) => `<li class="text-xs leading-5 text-[#707168]">${escapeHtml(formatDateTime(event.at))} · <strong>${escapeHtml(statusLabels[event.status] || event.status)}</strong>${event.note ? ` · ${escapeHtml(event.note)}` : ''}</li>`).join('')}</ol></div>` : '<div class="admin-empty-state min-h-[320px]"><div><h3>Chọn một yêu cầu</h3><p>Thông tin liên hệ, ghi chú và lịch sử trạng thái sẽ xuất hiện tại đây.</p></div></div>';
    view().innerHTML = `<section><div class="admin-section-heading"><div><h1>Yêu cầu B2B</h1><p>Theo dõi các đơn vị cần tư vấn và cập nhật trạng thái liên hệ.</p></div><a class="admin-secondary-link" href="index.html#b2b">Mở biểu mẫu tư vấn ${icon('external-link')}</a></div><div class="mb-4 flex flex-wrap items-center justify-between gap-4 border-y border-[#e8e3d9] py-3"><div class="flex flex-wrap items-center gap-2 text-sm"><strong class="text-[#707168]">Trạng thái:</strong><span>Mới</span><span aria-hidden="true">→</span><span>Đã liên hệ</span><span aria-hidden="true">→</span><span>Đã đóng</span></div><span class="text-xs text-[#707168]">Đóng yêu cầu cần ghi chú kết quả.</span></div><div class="admin-split-panel"><div class="min-w-0"><div class="admin-toolbar border-b border-[#e8e3d9] p-4"><div class="admin-toolbar-field"><label class="admin-field-label" for="inquiry-search">Tìm yêu cầu</label><input id="inquiry-search" class="field-control" type="search" value="${escapeHtml(inquiryFilters.query)}" placeholder="Tìm tổ chức, người liên hệ hoặc email" /></div><div class="admin-toolbar-field"><label class="admin-field-label" for="inquiry-status">Trạng thái</label><select id="inquiry-status" class="field-control"><option value="all">Tất cả trạng thái</option><option value="new" ${inquiryFilters.status === 'new' ? 'selected' : ''}>Mới</option><option value="contacted" ${inquiryFilters.status === 'contacted' ? 'selected' : ''}>Đã liên hệ</option><option value="closed" ${inquiryFilters.status === 'closed' ? 'selected' : ''}>Đã đóng</option></select></div><span class="self-end pb-3 text-xs font-bold text-[#707168]">${filtered.length} yêu cầu</span></div><div class="admin-inquiry-list"><div class="admin-inquiry-header"><span>Tổ chức / Người liên hệ</span><span>Ngày gửi</span><span>Trạng thái</span></div>${rows || `<div class="admin-empty-state min-h-[350px]"><div><h3>${inquiries.length ? 'Không có yêu cầu phù hợp' : 'Chưa có yêu cầu B2B được lưu'}</h3><p>${inquiries.length ? 'Thay đổi tìm kiếm hoặc trạng thái.' : 'Gửi biểu mẫu tư vấn trên cửa hàng bằng cùng trình duyệt để tạo hồ sơ demo.'}</p>${inquiries.length ? '' : '<a class="admin-secondary-link mt-3" href="index.html#b2b">Mở biểu mẫu tư vấn</a>'}</div></div>`}</div></div><aside class="admin-detail-pane">${details}</aside></div><footer class="mt-4 flex flex-wrap justify-between gap-2 text-xs text-[#707168]"><span>Yêu cầu B2B chỉ được lưu trong trình duyệt này.</span><span>Thông tin liên hệ chỉ để theo dõi yêu cầu tư vấn demo.</span></footer></section>`;
  }

  function renderInquiry(id) {
    inquiryFilters.selectedId = id;
    location.hash = '#b2b';
    renderInquiries();
  }

  function showMessage(node, message, error = true) {
    if (!node) return;
    node.hidden = !message;
    node.textContent = message;
    node.className = `admin-inline-message ${error ? 'admin-error' : 'admin-success'}`;
  }

  function showLogin() {
    byId('admin-login').hidden = false;
    byId('admin-app').hidden = true;
  }

  function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const fields = new FormData(form);
    const error = byId('admin-login-error');
    if (fields.get('username') !== DEMO_USER || fields.get('password') !== DEMO_PASSWORD) {
      error.hidden = false;
      error.textContent = 'Thông tin demo chưa đúng. Hãy dùng tài khoản và mật khẩu hiển thị bên dưới.';
      return;
    }
    try {
      sessionStorage.setItem(sessionKey, '1');
    } catch {
      error.hidden = false;
      error.textContent = 'Không thể mở phiên demo trong tab này. Cho phép sessionStorage rồi thử lại.';
      return;
    }
    error.hidden = true;
    form.reset();
    if (!location.hash) location.hash = '#overview';
    renderShell();
  }

  function logout() {
    try { sessionStorage.removeItem(sessionKey); } catch { /* Session may be unavailable in private mode. */ }
    location.hash = '';
    showLogin();
  }

  function renderViewForHash() {
    if (sessionStorage.getItem(sessionKey) === '1') renderShell();
  }

  function parseFormProduct(form) {
    const fields = new FormData(form);
    const variantsText = fields.get('variants') || '';
    const variants = parseVariantLines(variantsText);
    const inventory = {};
    form.querySelectorAll('[data-stock-variant]').forEach((input) => {
      inventory[input.dataset.stockVariant || 'base'] = input.value;
    });
    return {
      id: form.dataset.id === 'new' ? '' : form.dataset.id,
      title: fields.get('title'), brand: fields.get('brand'), ageRange: fields.get('ageRange'),
      activityCategoryId: fields.get('activityCategoryId'), category: fields.get('category'), description: fields.get('description'),
      purchaseAvailable: fields.has('purchaseAvailable'), rentalEnabled: fields.has('rentalEnabled'),
      buyPrice: fields.get('buyPrice'), buyPriceLabel: fields.get('buyPriceLabel'),
      rentalPrice14d: fields.get('rentalPrice14d'), depositReferenceValue: fields.get('depositReferenceValue'),
      priceNote: fields.get('priceNote'), rentalNote: fields.get('rentalNote'), variants, inventory,
      image: { src: fields.get('imageSrc'), alt: fields.get('imageAlt') },
    };
  }

  function handleClick(event) {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const id = action.dataset.id;
    const type = action.dataset.action;
    if (type === 'order-filter') { orderFilters.mode = action.dataset.mode; renderOrders(); return; }
    if (type === 'confirm-line' || type === 'handoff-purchase' || type === 'complete-purchase' || type === 'cancel-line') {
      const orderId = action.dataset.orderId;
      const lineId = action.dataset.lineId;
      if (type === 'cancel-line') {
        const confirmDialog = byId('admin-confirm-dialog');
        byId('admin-confirm-title').textContent = 'Hủy dòng sản phẩm?';
        byId('admin-confirm-message').textContent = 'Chỉ các món chưa bàn giao mới có thể hủy. Số lượng đã giữ chỗ sẽ được trả lại vào tồn kho.';
        byId('admin-confirm-action').onclick = (confirmEvent) => {
          confirmEvent.preventDefault();
          const result = store.cancelLine(orderId, lineId);
          confirmDialog.close();
          if (!result.ok) toast(result.message, 'error'); else toast('Đã hủy dòng và giải phóng số lượng đã giữ.');
          currentRoute.name === 'order' ? renderOrder(orderId) : renderOrders();
        };
        confirmDialog.showModal();
        return;
      }
      const result = type === 'confirm-line' ? store.confirmLine(orderId, lineId) : type === 'handoff-purchase' ? store.handoffPurchaseLine(orderId, lineId) : store.completePurchaseLine(orderId, lineId);
      if (!result.ok) toast(result.message, 'error'); else toast(type === 'confirm-line' ? 'Đã xác nhận dòng sản phẩm.' : type === 'handoff-purchase' ? 'Đã ghi nhận bàn giao và cập nhật tồn kho.' : 'Đã ghi nhận hoàn tất dòng mua.');
      currentRoute.name === 'order' ? renderOrder(orderId) : renderOrders();
      return;
    }
    if (type === 'inspection-available' || type === 'inspection-discard') {
      const product = store.getProduct(id, true);
      const variantId = action.dataset.variant || '';
      const stock = store.getInventory(id, variantId);
      const quantity = Number(action.dataset.quantity || stock?.inspection || 0);
      if (!quantity) { toast('Không có bộ nào đang chờ kiểm tra.', 'error'); return; }
      const outcome = type === 'inspection-available' ? 'available' : 'discard';
      const run = () => {
        const result = store.resolveInspection(id, variantId, quantity, outcome);
        if (!result.ok) toast(result.message, 'error'); else toast(outcome === 'available' ? 'Đã đưa các bộ đạt kiểm tra vào số có sẵn.' : 'Đã loại bỏ các bộ sau kiểm tra.');
        renderProductEditor(id);
      };
      if (outcome === 'available') run();
      else {
        const dialog = byId('admin-confirm-dialog');
        byId('admin-confirm-title').textContent = 'Loại bỏ sản phẩm sau kiểm tra?';
        byId('admin-confirm-message').textContent = `${quantity} bộ sẽ bị trừ khỏi tồn vật lý và không thể đặt lại.`;
        byId('admin-confirm-action').onclick = (confirmEvent) => { confirmEvent.preventDefault(); dialog.close(); run(); };
        dialog.showModal();
      }
      return;
    }
    if (type === 'new-product') location.hash = '#product-editor/new';
    if (type === 'edit-product') location.hash = `#product-editor/${encodeURIComponent(id)}`;
    if (type === 'manage-categories') location.hash = '#categories';
    if (type === 'edit-category') location.hash = `#category-editor/${encodeURIComponent(id)}`;
    if (type === 'order-filter') { orderFilters.mode = action.dataset.mode; renderOrders(); }
    if (type === 'select-inquiry') { inquiryFilters.selectedId = id; renderInquiries(); }
    if (type === 'archive-product' || type === 'restore-product') {
      const confirm = byId('admin-confirm-dialog');
      byId('admin-confirm-title').textContent = type === 'archive-product' ? 'Ẩn sản phẩm khỏi cửa hàng?' : 'Khôi phục sản phẩm?';
      byId('admin-confirm-message').textContent = type === 'archive-product' ? 'Sản phẩm sẽ không xuất hiện trong danh mục cửa hàng; đơn đã lưu vẫn giữ snapshot lịch sử.' : 'Sản phẩm sẽ xuất hiện lại trong catalog cửa hàng.';
      const confirmButton = byId('admin-confirm-action');
      confirmButton.onclick = (confirmEvent) => {
        confirmEvent.preventDefault();
        const result = type === 'archive-product' ? store.archiveProduct(id) : store.restoreProduct(id);
        confirm.close();
        if (!result.ok) toast(result.message, 'error');
        else { toast(type === 'archive-product' ? 'Đã lưu trạng thái ẩn sản phẩm.' : 'Đã khôi phục sản phẩm.'); location.hash = '#products'; }
      };
      confirm.showModal();
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (form.id === 'admin-product-form') {
      event.preventDefault();
      const message = byId('product-form-message');
      const title = form.elements.title;
      if (!title.value.trim() || !form.elements.brand.value.trim() || !form.elements.description.value.trim()) {
        showMessage(message, 'Nhập tên, thương hiệu và mô tả sản phẩm trước khi lưu.'); return;
      }
      if (!form.reportValidity()) return;
      let draft;
      try { draft = parseFormProduct(form); } catch (error) { showMessage(message, error.message); return; }
      const result = store.saveProduct(draft);
      if (!result.ok) { showMessage(message, result.message); return; }
      unsavedDraft = false;
      location.hash = '#products';
      toast('Đã lưu sản phẩm trong trình duyệt này.');
    }

    if (form.id === 'admin-category-form') {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const fields = new FormData(form);
      const result = store.saveCategory({ id: fields.get('id'), title: fields.get('title'), description: fields.get('description'), image: { src: fields.get('image'), alt: fields.get('title') } });
      if (!result.ok) { showMessage(byId('category-form-message'), result.message); return; }
      location.hash = '#categories';
      toast('Đã lưu danh mục.');
    }

    if (form.id === 'product-filter-form') {
      event.preventDefault();
      categoryFilters.query = byId('product-search').value.trim();
      categoryFilters.categoryId = byId('product-category-filter').value;
      categoryFilters.mode = byId('product-mode-filter').value;
      categoryFilters.showArchived = byId('show-archived-products').checked;
      renderProducts();
    }

    if (form.id === 'order-search-form') {
      event.preventDefault();
      orderFilters.query = byId('order-search').value.trim();
      renderOrders();
    }

    if (form.classList.contains('admin-handoff-form')) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const result = store.handoffRentalLine(currentRoute.id, form.dataset.lineId, form.elements.handoffDate.value);
      if (!result.ok) toast(result.message, 'error'); else toast('Đã ghi nhận bàn giao thuê và ngày trả dự kiến.');
      renderOrder(currentRoute.id);
    }

    if (form.classList.contains('admin-return-form')) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      form.dataset.operationId ||= `return-${crypto.randomUUID?.() || makeClientId()}`;
      const result = store.recordRentalReturn(currentRoute.id, form.dataset.lineId, { operationId: form.dataset.operationId, quantity: form.elements.quantity.value, destination: form.elements.destination.value });
      if (!result.ok) toast(result.message, 'error'); else toast('Đã ghi nhận số lượng trả và tình trạng kiểm tra.');
      renderOrder(currentRoute.id);
    }

    if (form.classList.contains('admin-deposit-form')) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const result = store.resolveDeposit(currentRoute.id, form.dataset.lineId, { refunded: form.elements.refunded.value, retained: form.elements.retained.value, reason: form.elements.reason.value });
      if (!result.ok) toast(result.message, 'error'); else toast('Đã lưu kết quả đối soát cọc trong trình duyệt.');
      renderOrder(currentRoute.id);
    }

    if (form.classList.contains('admin-inquiry-update-form')) {
      event.preventDefault();
      const submitter = event.submitter;
      const status = submitter?.value || 'contacted';
      const result = store.updateInquiry(form.dataset.id, { status, note: form.elements.note.value, outcome: form.elements.outcome.value });
      if (!result.ok) toast(result.message, 'error'); else { toast(status === 'closed' ? 'Đã đóng yêu cầu B2B.' : status === 'contacted' ? 'Đã cập nhật yêu cầu B2B.' : 'Đã lưu ghi chú.'); inquiryFilters.selectedId = form.dataset.id; }
      renderInquiries();
    }
  }

  function makeClientId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

  function handleChange(event) {
    if (event.target.id === 'order-sort') { orderFilters.sort = event.target.value; renderOrders(); }
    if (event.target.id === 'inquiry-status') { inquiryFilters.status = event.target.value; renderInquiries(); }
    if (event.target.id === 'inquiry-search') { inquiryFilters.query = event.target.value; inquiryFilters.selectedId = ''; renderInquiries(); }
    if (event.target.name === 'rentalEnabled') {
      const form = event.target.form;
      form.elements.rentalPrice14d.disabled = !event.target.checked;
      form.elements.depositReferenceValue.disabled = !event.target.checked;
      form.elements.rentalPrice14d.required = event.target.checked;
      form.elements.depositReferenceValue.required = event.target.checked;
    }
  }

  function handleInput(event) {
    const form = event.target.closest('#admin-product-form');
    if (form) {
      unsavedDraft = true;
      const previewImage = byId('product-preview-image');
      const previewTitle = byId('product-preview-title');
      const previewBrand = byId('product-preview-brand');
      if (event.target.name === 'imageSrc' && previewImage) {
        const url = safeUrl(event.target.value);
        previewImage.src = url || '';
      }
      if (event.target.name === 'title' && previewTitle) previewTitle.textContent = event.target.value || 'Tên sản phẩm';
      if (['brand', 'ageRange'].includes(event.target.name) && previewBrand) previewBrand.textContent = `${form.elements.brand.value || 'Thương hiệu'} · ${form.elements.ageRange.value || 'Độ tuổi'}`;
    }
  }

  function makeOverviewListeners() {
    document.querySelectorAll('[data-admin-logout]').forEach((button) => button.addEventListener('click', logout));
    const toggle = byId('admin-mobile-nav-toggle');
    const mobileNav = byId('admin-mobile-nav');
    toggle?.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      mobileNav.hidden = open;
    });
    mobileNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { mobileNav.hidden = true; toggle?.setAttribute('aria-expanded', 'false'); }));
  }

  function init() {
    byId('admin-login-form')?.addEventListener('submit', login);
    byId('toggle-password')?.addEventListener('click', () => {
      const input = byId('admin-password');
      const button = byId('toggle-password');
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(showing));
      button.setAttribute('aria-label', showing ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      button.innerHTML = icon(showing ? 'eye-off' : 'eye');
    });
    makeOverviewListeners();
    view().addEventListener('click', handleClick);
    view().addEventListener('submit', handleSubmit);
    view().addEventListener('change', handleChange);
    view().addEventListener('input', handleInput);
    window.addEventListener('hashchange', () => { unsavedDraft = false; renderShell(); });
    window.addEventListener('brainybox:store-change', () => window.setTimeout(() => renderShell(), 0));
    window.addEventListener('brainybox:store-external-change', () => {
      if (currentRoute.name === 'product-editor' && unsavedDraft) setGlobalAlert('Catalog đã thay đổi ở tab khác. Bản nháp của bạn vẫn còn trên màn hình; hãy tải lại trước khi lưu.');
      else renderShell();
    });
    window.addEventListener('brainybox:store-change', (event) => {
      if (event.detail?.source === 'local') setGlobalAlert('');
    });
    document.addEventListener('click', handlePageActions);
    if (!location.hash) location.hash = '#overview';
    if (sessionStorage.getItem(sessionKey) === '1') renderShell();
    else showLogin();
  }

  function handlePageActions(event) {
    if (event.target.id === 'admin-mobile-nav-toggle') return;
    if (event.target.id === 'refresh-cart-prices') return;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
