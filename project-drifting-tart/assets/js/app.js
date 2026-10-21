(() => {
  let data = window.BrainyBoxData;
  const store = window.BrainyBoxStore;
  const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
  const cartStorageKey = 'brainybox-cart';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const safeImageUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };

  const readCart = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartStorageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  };

  const saveCart = (items) => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(items));
      window.dispatchEvent(new CustomEvent('brainybox:cart-change'));
      return true;
    } catch {
      return false;
    }
  };

  const byId = (id) => document.getElementById(id);
  const formatBuyPrice = (item) => item.buyPriceLabel || money.format(item.buyPrice);

  function renderCart() {
    const items = readCart();
    const count = items.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
    document.querySelectorAll('[data-cart-count]').forEach((node) => {
      node.textContent = String(count);
      node.setAttribute('aria-label', `${count} món trong giỏ hàng`);
    });

    const list = byId('cart-items');
    const empty = byId('cart-empty');
    const checkoutAction = document.querySelector('[data-cart-checkout]');
    if (checkoutAction) checkoutAction.classList.toggle('hidden', items.length === 0);
    if (list) {
      list.replaceChildren();
      items.slice(-3).reverse().forEach((item) => {
        const row = document.createElement('li');
        row.className = 'flex items-start justify-between gap-4 border-b border-[#e8e3d9] py-3 last:border-0';
        const description = document.createElement('span');
        description.className = 'font-bold';
        description.textContent = `${item.title}${item.variant ? ` · ${item.variant}` : ''} · ${item.mode}${item.term ? ` (${item.term})` : ''}`;
        const price = document.createElement('span');
        price.className = 'shrink-0 text-right text-sm font-extrabold text-[#526d3f]';
        price.textContent = item.deposit ? `${money.format(item.price)} + cọc ${money.format(item.deposit)}` : money.format(item.price);
        row.append(description, price);
        list.append(row);
      });
      if (empty) empty.hidden = items.length > 0;
    }
  }

  function addToCart(item) {
    const live = byId('product-stock-status') || byId('cart-live');
    const inventory = store?.getInventory(item.productId, item.variantId || '');
    if (inventory && (!inventory.configured || inventory.availableToPromise < 1)) {
      if (live) live.textContent = inventory.configured ? 'Sản phẩm hiện không còn số lượng có thể đặt.' : 'Tồn kho chưa được kiểm kê; hãy liên hệ BrainyBox hoặc thiết lập số lượng trong admin.';
      return { ok: false, reason: inventory.configured ? 'stock' : 'unconfigured' };
    }
    const items = readCart();
    items.push({ ...item, cartLineId: item.cartLineId || `cart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, quantity: 1 });
    if (!saveCart(items)) {
      if (live) live.textContent = 'Chưa lưu được trong trình duyệt. Sản phẩm vẫn được giữ trên trang.';
      return { ok: false, reason: 'storage' };
    }
    renderCart();
    if (live) live.textContent = `${item.title} đã được thêm vào giỏ hàng.`;
    const dialog = byId('cart-dialog');
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    return { ok: true };
  }

  function initNavigation() {
    const toggle = document.querySelector('[data-menu-toggle]');
    const menu = byId('mobile-navigation');
    if (toggle && menu) {
      toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isExpanded));
        menu.hidden = isExpanded;
      });
      menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          menu.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    document.querySelectorAll('[data-cart-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = byId('cart-dialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      });
    });
    document.querySelectorAll('[data-cart-close]').forEach((button) => {
      button.addEventListener('click', () => byId('cart-dialog')?.close());
    });
    document.querySelectorAll('[data-cart-close-link]').forEach((link) => {
      link.addEventListener('click', () => byId('cart-dialog')?.close());
    });

    const dialog = byId('cart-dialog');
    if (dialog) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    renderCart();
  }

  function renderProductCard(product) {
    const title = escapeHtml(product.title);
    const image = safeImageUrl(product.image?.src);
    const alt = escapeHtml(product.image?.alt || `Ảnh ${product.title}`);
    const category = escapeHtml(product.category);
    const brand = escapeHtml(product.brand);
    const description = escapeHtml(product.shortDescription);
    const ageRange = escapeHtml(product.ageRange);
    const priceNote = escapeHtml(product.priceNote);
    return `
      <article class="product-card min-w-0">
        <a class="group flex h-full flex-col text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#526d3f]" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="Xem chi tiết ${title}">
          <span class="media-frame relative block aspect-[4/3] shrink-0">
            ${image ? `<img src="${escapeHtml(image)}" alt="${alt}" loading="lazy" width="600" height="450" style="width:100%;height:100%;object-fit:cover;" />` : ''}
            <span class="absolute left-3 top-3 rounded-full bg-[#fffefa]/95 px-3 py-1 text-xs font-extrabold text-[#526d3f]">${brand}</span>
          </span>
          <span class="flex flex-1 flex-col p-4 sm:p-5">
            <span class="block text-[0.68rem] font-extrabold uppercase tracking-wide text-[#707168]">${category}</span>
            <span class="display-font mt-1 block text-lg font-semibold leading-tight text-[#34352f]">${title}</span>
            <span class="mt-2 line-clamp-3 min-h-14 text-sm leading-5 text-[#707168]">${description}</span>
            <span class="mt-2 block text-xs font-bold text-[#707168]">${ageRange}</span>
            <span class="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-t border-[#e8e3d9] pt-3">
              <span class="text-sm font-extrabold text-[#34352f]">${product.purchaseAvailable ? 'Mua' : 'Giá tham khảo'} ${escapeHtml(formatBuyPrice(product))}</span>
              ${product.rentalPrice14d ? `<span class="text-sm font-extrabold text-[#526d3f]">Thuê ${money.format(product.rentalPrice14d)}<span class="font-semibold text-[#707168]"> / 14 ngày</span></span>` : '<span class="text-xs font-bold text-[#707168]">Chỉ bán đứt</span>'}
            </span>
            ${priceNote ? `<span class="mt-2 block text-[0.7rem] leading-4 text-[#707168]">${priceNote}</span>` : ''}
            <span class="mt-4 flex items-center justify-between text-sm font-extrabold text-[#526d3f]">Xem chi tiết <span aria-hidden="true">→</span></span>
          </span>
        </a>
      </article>`;
  }

  function renderHomepage() {
    if (!data) return;
    const categoryGrid = byId('category-grid');
    if (categoryGrid) {
      categoryGrid.innerHTML = data.activityCategories.map((category) => {
        const src = safeImageUrl(category.image?.src);
        return `
          <a class="category-card group min-w-0 overflow-hidden rounded-2xl border border-[#e8e3d9] bg-[#fffefa] no-underline transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#526d3f]" href="category.html?id=${encodeURIComponent(category.id)}">
            <span class="media-frame block aspect-[4/3]">
              ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(category.image?.alt || category.title)}" loading="lazy" width="480" height="360" style="width:100%;height:100%;object-fit:cover;" />` : ''}
            </span>
            <span class="block p-4 sm:p-5">
              <span class="display-font block text-lg font-semibold leading-tight text-[#34352f]">${escapeHtml(category.title)}</span>
              <span class="mt-1 block text-sm font-semibold text-[#707168]">${escapeHtml(category.description)}</span>
              <span class="mt-4 inline-flex items-center gap-2 text-sm font-extrabold text-[#526d3f]">Xem sản phẩm <span aria-hidden="true">→</span></span>
            </span>
          </a>`;
      }).join('');
    }

    const productGrid = byId('product-grid');
    if (productGrid) productGrid.innerHTML = data.products.map(renderProductCard).join('');

    document.querySelectorAll('[data-catalog-count]').forEach((node) => {
      node.textContent = `${data.products.length} sản phẩm`;
    });

    const form = byId('b2b-form');
    if (form && !form.dataset.bound) {
      form.dataset.bound = 'true';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const fields = Object.fromEntries(new FormData(form).entries());
        const result = store?.createInquiry(fields);
        const response = byId('b2b-response');
        if (!result?.ok) {
          if (response) response.textContent = result?.message || 'Chưa lưu được yêu cầu trong trình duyệt này. Thông tin bạn nhập vẫn được giữ.';
          return;
        }
        if (response) response.textContent = 'Yêu cầu demo đã được lưu trong trình duyệt này. BrainyBox chưa nhận hoặc phản hồi yêu cầu thật.';
        form.reset();
      });
    }
  }

  function renderCategoryPage() {
    const page = byId('activity-category-page');
    if (!page || !data) return;

    const categoryId = new URLSearchParams(window.location.search).get('id');
    const category = data.activityCategories.find((item) => item.id === categoryId);
    const sidebar = byId('activity-category-links');
    const title = byId('activity-category-title');
    const description = byId('activity-category-description');
    const count = byId('activity-category-count');
    const productGrid = byId('activity-product-grid');
    const notFound = byId('activity-category-not-found');

    if (sidebar) {
      sidebar.innerHTML = data.activityCategories.map((item) => {
        const active = item.id === categoryId;
        return `<a class="rounded-xl border px-3 py-3 text-sm font-extrabold no-underline transition hover:border-[#cdd9c0] hover:text-[#405b31] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#526d3f] ${active ? 'border-[#526d3f] bg-[#eef3e8] text-[#405b31]' : 'border-[#e8e3d9] bg-[#fffefa] text-[#34352f]'}" href="category.html?id=${encodeURIComponent(item.id)}" ${active ? 'aria-current="page"' : ''}>${item.title}</a>`;
      }).join('');
    }

    if (!category) {
      document.title = 'Không tìm thấy danh mục — BrainyBox';
      if (title) title.textContent = 'Không tìm thấy danh mục';
      if (description) description.textContent = 'Danh mục này không có hoặc đường dẫn đã thay đổi. Hãy chọn một danh mục hoạt động khác.';
      if (count) count.textContent = '0 sản phẩm';
      if (productGrid) productGrid.replaceChildren();
      if (notFound) notFound.hidden = false;
      return;
    }

    const products = data.products.filter((item) => item.activityCategoryId === category.id);
    document.title = `${category.title} — BrainyBox`;
    if (title) title.textContent = category.title;
    if (description) description.textContent = category.description;
    if (count) count.textContent = `${products.length} sản phẩm`;
    if (productGrid) productGrid.innerHTML = products.map(renderProductCard).join('');
    if (notFound) notFound.hidden = true;

    const breadcrumb = byId('activity-category-breadcrumb');
    if (breadcrumb) breadcrumb.textContent = category.title;
  }

  function initProductPage() {
    if (!data || !byId('product-purchase')) return;
    const productId = new URLSearchParams(window.location.search).get('id');
    const product = productId ? data.products.find((item) => item.id === productId) : data.product;
    const form = byId('product-purchase');
    if (!product) {
      document.title = 'Sản phẩm không khả dụng — BrainyBox';
      if (byId('product-title')) byId('product-title').textContent = 'Sản phẩm không khả dụng';
      if (byId('product-description')) byId('product-description').textContent = 'Sản phẩm này đã được ẩn hoặc không còn trong danh mục.';
      if (form) form.hidden = true;
      return;
    }
    const modeInputs = form.querySelectorAll('input[name="purchase-mode"]');
    const rentInput = form.querySelector('input[name="purchase-mode"][value="rent"]');
    const rentOption = byId('rent-mode-option');
    const buyOption = form.querySelector('label:has(input[name="purchase-mode"][value="buy"])');
    const buyInput = form.querySelector('input[name="purchase-mode"][value="buy"]');
    const termChoices = byId('rental-terms');
    const price = byId('current-price');
    const deposit = byId('deposit-amount');
    const depositNotice = byId('deposit-notice');
    const mainImage = byId('main-product-image');
    const cta = byId('add-product-to-cart');
    const rentalAvailable = Boolean(product.rentalPrice14d);

    const setText = (id, value) => {
      const node = byId(id);
      if (node && value) node.textContent = value;
    };

    document.title = `${product.title} — BrainyBox`;
    setText('product-title', product.title);
    setText('product-brand', product.brand);
    setText('product-category', product.category);
    setText('product-category-label', product.category);
    setText('product-description', product.description);
    setText('product-condition', product.conditionLabel);
    setText('product-age', product.ageRange);
    setText('product-buy-option-price', formatBuyPrice(product));
    setText('product-rent-option-price', rentalAvailable ? money.format(product.rentalPrice14d) : 'Không cho thuê');
    setText('product-rent-period', rentalAvailable ? '/ 14 ngày' : '');
    setText('product-price-note', product.priceNote);
    if (byId('product-price-note')) byId('product-price-note').hidden = !product.priceNote;

    const variantField = byId('product-variant-field');
    const variantSelect = byId('product-variant');
    if (variantField && variantSelect && product.variants?.length) {
      variantField.hidden = false;
      variantSelect.replaceChildren(...product.variants.map((variant) => {
        const option = document.createElement('option');
        option.value = variant.id;
        option.textContent = `${variant.label} · ${money.format(variant.price)}`;
        return option;
      }));
    }

    const currentBuyPrice = () => product.variants?.find((variant) => variant.id === variantSelect?.value)?.price || product.buyPrice;
    const currentVariantId = () => variantSelect?.value || '';
    const purchaseAvailable = product.purchaseAvailable !== false;
    if (rentOption) rentOption.hidden = !rentalAvailable;
    if (rentInput) rentInput.disabled = !rentalAvailable;
    if (buyOption) buyOption.hidden = !purchaseAvailable;
    if (buyInput) buyInput.disabled = !purchaseAvailable;
    if (!rentalAvailable && buyInput) buyInput.checked = true;
    if (!purchaseAvailable && rentalAvailable && rentInput) rentInput.checked = true;

    if (mainImage) {
      mainImage.src = product.image.src;
      mainImage.alt = product.image.alt;
    }

    const gallery = byId('product-gallery');
    if (gallery) {
      gallery.replaceChildren();
      const images = (product.gallery && product.gallery.length ? product.gallery : [product.image]).slice(0, 3);
      images.forEach((image, index) => {
        const button = document.createElement('button');
        button.className = 'gallery-thumb overflow-hidden rounded-xl border-2 border-transparent bg-[#fffefa] p-0';
        button.type = 'button';
        button.dataset.gallerySrc = image.src;
        button.dataset.galleryAlt = image.alt;
        button.setAttribute('aria-label', `Xem ảnh ${index + 1} của ${product.title}`);
        button.setAttribute('aria-pressed', String(index === 0));
        const thumbnail = document.createElement('img');
        thumbnail.src = image.src;
        thumbnail.alt = '';
        thumbnail.width = 360;
        thumbnail.height = 240;
        thumbnail.loading = 'lazy';
        thumbnail.style.cssText = 'width:100%;height:5rem;object-fit:cover;';
        button.append(thumbnail);
        button.addEventListener('click', () => {
          if (!mainImage) return;
          mainImage.src = image.src;
          mainImage.alt = image.alt;
          gallery.querySelectorAll('[data-gallery-src]').forEach((thumb) => thumb.setAttribute('aria-pressed', String(thumb === button)));
        });
        gallery.append(button);
      });
    }

    function currentMode() {
      return form.querySelector('input[name="purchase-mode"]:checked')?.value || 'buy';
    }

    function updateSelection() {
      const renting = currentMode() === 'rent' && rentalAvailable;
      if (termChoices) termChoices.hidden = !renting;
      if (depositNotice) depositNotice.hidden = !renting;
      const amount = renting ? product.rentalPrice14d : currentBuyPrice();
      const buyOptionPrice = byId('product-buy-option-price');
      if (buyOptionPrice && product.variants?.length) buyOptionPrice.textContent = money.format(currentBuyPrice());
      if (price) {
        price.textContent = money.format(amount);
        price.setAttribute('aria-label', renting ? `${money.format(amount)} cho kỳ thuê 14 ngày` : money.format(amount));
      }
      if (deposit) deposit.textContent = money.format(product.refundableDeposit);
      if (cta) {
        cta.textContent = renting ? 'Thuê món này' : 'Mua đứt món này';
        const inventory = store?.getInventory(product.id, currentVariantId());
        const canOrder = Boolean(inventory?.configured && inventory.availableToPromise > 0);
        cta.disabled = !canOrder;
        cta.classList.toggle('action-disabled', !canOrder);
        const stockStatus = byId('product-stock-status');
        if (stockStatus) stockStatus.textContent = !inventory?.configured
          ? 'Số lượng chưa được kiểm kê. Đơn demo chỉ mở sau khi quản trị viên nhập tồn.'
          : inventory.availableToPromise > 0
            ? `${inventory.availableToPromise} bộ có thể đặt trong bản demo.`
            : 'Hiện không còn bộ nào có thể đặt.';
      }
    }

    modeInputs.forEach((input) => input.addEventListener('change', updateSelection));
    if (variantSelect && product.variants?.length) variantSelect.addEventListener('change', updateSelection);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const renting = currentMode() === 'rent' && rentalAvailable;
      const inventory = store?.getInventory(product.id, currentVariantId());
      if (!inventory?.configured || inventory.availableToPromise < 1) {
        const status = byId('product-stock-status');
        if (status) status.textContent = !inventory?.configured ? 'Tồn kho chưa được kiểm kê; hãy cập nhật trong admin trước khi đặt.' : 'Sản phẩm hiện không còn số lượng có thể đặt.';
        return;
      }
      addToCart({
        productId: product.id,
        variantId: currentVariantId(),
        title: product.title,
        mode: renting ? 'Thuê' : 'Mua đứt',
        term: renting ? '14 ngày' : '',
        variant: variantSelect?.selectedOptions[0]?.textContent || '',
        price: renting ? product.rentalPrice14d : currentBuyPrice(),
        deposit: renting ? product.refundableDeposit : 0,
      });
    });
    updateSelection();
  }

  function initCheckoutPage() {
    const checkout = byId('checkout-layout');
    const form = byId('checkout-form');
    if (!checkout || !form) return;

    const items = readCart();
    const emptyState = byId('checkout-empty');
    if (!items.length) {
      checkout.hidden = true;
      if (emptyState) emptyState.hidden = false;
      return;
    }

    const itemList = byId('checkout-items');
    const deliveryFields = byId('checkout-delivery-fields');
    const pickupFields = byId('checkout-pickup-fields');
    const pickupPoint = byId('checkout-pickup-point');
    const deliveryInputs = deliveryFields?.querySelectorAll('input, select, textarea') || [];
    let subtotal = 0;
    let deposits = 0;

    if (itemList) {
      itemList.replaceChildren();
      items.forEach((item) => {
        const quantity = Math.max(1, Number.parseInt(item.quantity, 10) || 1);
        const unitPrice = Math.max(0, Number(item.price) || 0);
        const unitDeposit = Math.max(0, Number(item.deposit) || 0);
        const lineSubtotal = unitPrice * quantity;
        const lineDeposit = unitDeposit * quantity;
        subtotal += lineSubtotal;
        deposits += lineDeposit;

        const product = data?.products?.find((candidate) => candidate.id === item.productId)
          || data?.products?.find((candidate) => candidate.title === item.title);
        const row = document.createElement('li');
        row.className = 'flex gap-3 py-4 first:pt-0';
        if (product?.image?.src) {
          const image = document.createElement('img');
          image.className = 'size-[4.5rem] shrink-0 rounded-xl border border-[#e8e3d9] bg-white object-cover';
          image.src = product.image.src;
          image.alt = product.image.alt || `Ảnh ${item.title}`;
          image.width = 96;
          image.height = 96;
          row.append(image);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'brand-mark size-[4.5rem] shrink-0';
          fallback.setAttribute('aria-hidden', 'true');
          fallback.textContent = 'B';
          row.append(fallback);
        }

        const details = document.createElement('div');
        details.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'text-sm font-extrabold leading-5';
        title.textContent = `${item.title || product?.title || 'Sản phẩm BrainyBox'}${item.variant ? ` · ${item.variant}` : ''}`;
        const mode = document.createElement('p');
        mode.className = 'mt-1 text-xs font-semibold text-[#707168]';
        mode.textContent = `${item.mode || 'Mua đứt'}${item.term ? ` · ${item.term}` : ''} · SL ${quantity}`;
        details.append(title, mode);
        if (lineDeposit > 0) {
          const deposit = document.createElement('p');
          deposit.className = 'mt-1 text-xs font-semibold text-[#526d3f]';
          deposit.textContent = `Cọc hoàn lại: ${money.format(lineDeposit)}`;
          details.append(deposit);
        }
        const amount = document.createElement('strong');
        amount.className = 'shrink-0 pt-0.5 text-right text-sm font-extrabold';
        amount.textContent = money.format(lineSubtotal);
        row.append(details, amount);
        itemList.append(row);
      });
    }

    if (byId('checkout-subtotal')) byId('checkout-subtotal').textContent = money.format(subtotal);
    if (byId('checkout-deposit')) byId('checkout-deposit').textContent = money.format(deposits);
    if (byId('checkout-deposit-row')) byId('checkout-deposit-row').hidden = deposits === 0;
    if (byId('checkout-deposit-note')) byId('checkout-deposit-note').hidden = deposits === 0;
    if (byId('checkout-total')) byId('checkout-total').textContent = money.format(subtotal + deposits);

    const updateFulfillment = () => {
      const pickupSelected = form.querySelector('input[name="fulfillment"]:checked')?.value === 'pickup';
      if (deliveryFields) deliveryFields.hidden = pickupSelected;
      deliveryInputs.forEach((input) => { input.disabled = pickupSelected; });
      if (pickupFields) pickupFields.hidden = !pickupSelected;
      if (pickupPoint) {
        pickupPoint.disabled = !pickupSelected;
        pickupPoint.required = pickupSelected;
      }
      const shipping = byId('checkout-shipping');
      if (shipping) shipping.hidden = pickupSelected;
    };

    form.querySelectorAll('input[name="fulfillment"]').forEach((input) => input.addEventListener('change', updateFulfillment));
    updateFulfillment();

    const error = byId('checkout-error');
    const refreshCartButton = byId('refresh-cart-prices');
    refreshCartButton?.addEventListener('click', () => {
      const refreshed = store?.refreshCartPrices();
      if (!refreshed?.ok) {
        if (error) { error.hidden = false; error.textContent = refreshed?.message || 'Chưa cập nhật được giá giỏ hàng.'; }
        return;
      }
      window.location.reload();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const response = byId('checkout-response');
      const submitButton = form.querySelector('button[type="submit"]');
      if (!form.reportValidity()) {
        response?.classList.remove('notice-live--shown');
        return;
      }
      if (!store) {
        if (error) { error.hidden = false; error.textContent = 'Không tải được dữ liệu quản trị demo. Vui lòng tải lại trang.'; }
        return;
      }
      if (submitButton) submitButton.disabled = true;
      if (error) { error.hidden = true; error.textContent = ''; }
      if (response) { response.classList.remove('notice-live--shown'); response.textContent = ''; }
      const result = store.createOrderFromCart(readCart(), form);
      if (!result.ok) {
        if (error) { error.hidden = false; error.textContent = result.message; }
        if (refreshCartButton) refreshCartButton.classList.toggle('hidden', result.reason !== 'stale');
        if (submitButton) submitButton.disabled = false;
        return;
      }
      const cleared = saveCart([]);
      renderCart();
      if (response) {
        response.textContent = cleared
          ? `Đơn demo ${result.value.id} đã được lưu trong trình duyệt này. Chưa có khoản tiền nào được thu hoặc hoàn.`
          : `Đơn demo ${result.value.id} đã được lưu, nhưng chưa thể xóa giỏ trong trình duyệt. Hãy kiểm tra đơn trước khi đặt lại.`;
        response.classList.add('notice-live--shown');
      }
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Đơn demo đã được ghi nhận'; }
    });
  }

  function initReveal() {
    document.documentElement.classList.add('has-js');
    const targets = document.querySelectorAll('[data-reveal]');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          instance.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach((target) => observer.observe(target));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    renderHomepage();
    renderCategoryPage();
    initProductPage();
    initCheckoutPage();
    initReveal();
  });
})();
