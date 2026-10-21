(() => {
  const STORE_KEY = 'brainybox-operations-v1';
  const CART_KEY = 'brainybox-cart';
  const SCHEMA_VERSION = 1;
  const seedData = window.BrainyBoxData;
  const seedProducts = (seedData?.products || []).map((item) => JSON.parse(JSON.stringify(item)));
  const seedCategories = (seedData?.activityCategories || []).map((item) => JSON.parse(JSON.stringify(item)));
  const seedById = new Map(seedProducts.map((item) => [item.id, item]));
  const categoryIds = new Set(seedCategories.map((item) => item.id));

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const makeId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const validInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  const cleanText = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
  const isSafeImageUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  };
  const skuKey = (productId, variantId = '') => `${productId}::${variantId || 'base'}`;
  const skuVariants = (product) => product?.variants?.length ? product.variants : [{ id: '', label: 'Sản phẩm' }];

  function initialInventory() {
    const inventory = {};
    seedProducts.forEach((product) => {
      skuVariants(product).forEach((variant) => {
        inventory[skuKey(product.id, variant.id)] = {
          productId: product.id,
          variantId: variant.id || null,
          configured: false,
          physicalUnits: 0,
          reservedSale: 0,
          reservedRental: 0,
          onRent: 0,
          inspection: 0,
        };
      });
    });
    return inventory;
  }

  function freshState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      updatedAt: null,
      catalog: { productsById: {}, newProductIds: [], archivedIds: [], categoriesById: {} },
      inventoryBySku: initialInventory(),
      orders: [],
      inquiries: [],
    };
  }

  function validateState(value) {
    return Boolean(value && value.schemaVersion === SCHEMA_VERSION
      && Number.isSafeInteger(value.revision)
      && value.catalog && typeof value.catalog.productsById === 'object'
      && Array.isArray(value.catalog.newProductIds)
      && Array.isArray(value.catalog.archivedIds)
      && value.inventoryBySku && typeof value.inventoryBySku === 'object'
      && Array.isArray(value.orders) && Array.isArray(value.inquiries));
  }

  function readPersistedState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { state: freshState(), error: null };
      const parsed = JSON.parse(raw);
      if (validateState(parsed)) return { state: parsed, error: null };
      return { state: freshState(), error: 'Không đọc được dữ liệu quản trị phiên bản hiện tại.' };
    } catch {
      return { state: freshState(), error: 'Không đọc được dữ liệu trong trình duyệt.' };
    }
  }

  let loaded = readPersistedState();
  let state = loaded.state;
  let storeReadError = loaded.error;

  function mergedProducts(includeArchived = false) {
    const result = seedProducts.map((seed) => {
      const override = state.catalog.productsById[seed.id] || {};
      const item = { ...clone(seed), ...clone(override), id: seed.id, slug: seed.id };
      if (seed.purchaseAvailable === false) item.purchaseAvailable = false;
      if (item.rentalPrice14d) {
        const reference = Number(item.depositReferenceValue || item.buyPrice);
        item.refundableDeposit = Math.round((reference * 0.7) / 1000) * 1000;
      } else {
        item.refundableDeposit = 0;
      }
      return item;
    });

    state.catalog.newProductIds.forEach((id) => {
      const product = state.catalog.productsById[id];
      if (product) result.push({ ...clone(product), id, slug: id });
    });

    return includeArchived ? result : result.filter((item) => !state.catalog.archivedIds.includes(item.id));
  }

  function mergedCategories() {
    return seedCategories.map((seed) => ({ ...clone(seed), ...(state.catalog.categoriesById[seed.id] || {}), id: seed.id }));
  }

  function hydrateCatalog() {
    if (!seedData) return;
    const all = mergedProducts(true);
    seedData.products = all.filter((product) => !state.catalog.archivedIds.includes(product.id));
    seedData.allProducts = all;
    seedData.product = seedData.products[0] || null;
    seedData.activityCategories = mergedCategories();
    window.dispatchEvent(new CustomEvent('brainybox:store-change', { detail: { revision: state.revision, source: 'local' } }));
  }

  function inventoryRecord(productId, variantId = '', source = state) {
    const record = source.inventoryBySku[skuKey(productId, variantId)];
    if (!record) return null;
    const availableToPromise = record.configured
      ? record.physicalUnits - record.reservedSale - record.reservedRental - record.onRent - record.inspection
      : null;
    return { ...clone(record), availableToPromise };
  }

  function recordEvent(target, type, note = '') {
    target.history ||= [];
    target.history.push({ id: makeId('evt'), type, at: nowIso(), note: cleanText(note, 800) });
  }

  function transaction(mutator, expectedRevision) {
    if (storeReadError) return { ok: false, reason: 'storage', message: storeReadError };
    const persisted = readPersistedState();
    if (persisted.error) return { ok: false, reason: 'storage', message: persisted.error };
    if (persisted.state.revision !== state.revision) {
      state = persisted.state;
      hydrateCatalog();
      return { ok: false, reason: 'stale', message: 'Dữ liệu đã được thay đổi ở tab khác. Hãy tải lại trước khi lưu.' };
    }
    if (expectedRevision !== undefined && expectedRevision !== state.revision) {
      return { ok: false, reason: 'stale', message: 'Dữ liệu đã được thay đổi ở tab khác. Hãy tải lại trước khi lưu.' };
    }

    const draft = clone(state);
    let result;
    try {
      result = mutator(draft);
    } catch (error) {
      return { ok: false, reason: 'validation', message: error?.message || 'Không thể hoàn tất thao tác này.' };
    }
    if (result?.ok === false) return result;

    draft.revision = state.revision + 1;
    draft.updatedAt = nowIso();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(draft));
    } catch {
      return { ok: false, reason: 'storage', message: 'Chưa lưu được trong trình duyệt. Nội dung bạn nhập vẫn được giữ trên màn hình.' };
    }

    state = draft;
    hydrateCatalog();
    return { ok: true, revision: state.revision, value: result?.value };
  }

  function findProduct(productId, includeArchived = false) {
    return mergedProducts(includeArchived).find((product) => product.id === productId) || null;
  }

  function inferVariant(product, item) {
    if (item.variantId && product.variants?.some((variant) => variant.id === item.variantId)) return item.variantId;
    if (!product.variants?.length) return '';
    const label = String(item.variant || '');
    return product.variants.find((variant) => label.includes(variant.label))?.id || product.variants[0].id;
  }

  function expectedUnitPrice(product, mode, variantId) {
    if (mode === 'rent') return Number(product.rentalPrice14d) || 0;
    return Number(product.variants?.find((variant) => variant.id === variantId)?.price || product.buyPrice) || 0;
  }

  function expectedDeposit(product) {
    if (!product.rentalPrice14d) return 0;
    return Math.round((Number(product.depositReferenceValue || product.buyPrice) * 0.7) / 1000) * 1000;
  }

  function datePlusDays(dateString, days) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    if (!year || !month || !day) return '';
    const date = new Date(year, month - 1, day + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function normalizeProduct(draft, existing, isNew) {
    const title = cleanText(draft.title, 160);
    const brand = cleanText(draft.brand, 100);
    const description = cleanText(draft.description, 1800);
    const activityCategoryId = cleanText(draft.activityCategoryId, 80);
    if (!title || !brand || !description) throw new Error('Tên, thương hiệu và mô tả sản phẩm là bắt buộc.');
    if (!categoryIds.has(activityCategoryId)) throw new Error('Hãy chọn một danh mục hoạt động hợp lệ.');

    const buyPrice = Number(draft.buyPrice);
    const purchaseAvailable = !isNew && existing?.purchaseAvailable === false
      ? false
      : Boolean(draft.purchaseAvailable);
    const rentalEnabled = Boolean(draft.rentalEnabled ?? draft.rentalPrice14d);
    const rentalPrice14d = rentalEnabled ? Number(draft.rentalPrice14d) : null;
    const depositReferenceValue = Number(draft.depositReferenceValue || buyPrice);
    if (!validInteger(buyPrice) || buyPrice <= 0) throw new Error('Giá trị tham khảo sản phẩm phải là số nguyên dương.');
    if (rentalEnabled && (!validInteger(rentalPrice14d) || rentalPrice14d <= 0)) throw new Error('Phí thuê 14 ngày phải là số nguyên dương.');
    if (rentalEnabled && (!validInteger(depositReferenceValue) || depositReferenceValue <= 0)) throw new Error('Giá trị tham khảo để tính cọc phải là số nguyên dương.');
    if (!purchaseAvailable && !rentalEnabled) throw new Error('Bật ít nhất một hình thức kinh doanh.');

    const imageSrc = cleanText(draft.image?.src || draft.imageSrc, 1200);
    if (!isSafeImageUrl(imageSrc)) throw new Error('URL ảnh phải bắt đầu bằng http:// hoặc https://.');
    const imageAlt = cleanText(draft.image?.alt || draft.imageAlt, 300);
    const original = existing || {};
    const variants = (Array.isArray(draft.variants) ? draft.variants : original.variants || []).map((variant, index) => {
      const price = Number(variant.price);
      if (!cleanText(variant.label, 80) || !validInteger(price) || price <= 0) throw new Error('Mỗi biến thể cần tên và giá hợp lệ.');
      return { id: cleanText(variant.id, 80) || `variant-${index + 1}`, label: cleanText(variant.label, 80), price };
    });
    const id = isNew ? cleanText(draft.id, 100) : existing.id;
    if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Mã sản phẩm chỉ gồm chữ thường, số và dấu gạch ngang.');

    return {
      id,
      slug: id,
      title,
      brand,
      category: cleanText(draft.category, 120),
      activityCategoryId,
      description,
      shortDescription: description,
      ageRange: cleanText(draft.ageRange, 80),
      image: { src: imageSrc, alt: imageAlt || `Ảnh ${title}` },
      gallery: Array.isArray(draft.gallery) && draft.gallery.length ? draft.gallery : (original.gallery || [{ src: imageSrc, alt: imageAlt || `Ảnh ${title}` }]),
      variants,
      purchaseAvailable,
      conditionLabel: cleanText(draft.conditionLabel, 120) || original.conditionLabel || 'Hàng mới theo danh mục dự án',
      buyPrice,
      buyPriceLabel: cleanText(draft.buyPriceLabel, 100) || null,
      priceNote: cleanText(draft.priceNote, 300),
      rentalPrice14d,
      rentalDays: rentalEnabled ? 14 : 0,
      rentalNote: cleanText(draft.rentalNote, 240),
      depositReferenceValue: rentalEnabled ? depositReferenceValue : null,
      refundableDeposit: rentalEnabled ? Math.round((depositReferenceValue * 0.7) / 1000) * 1000 : 0,
      available: true,
    };
  }

  function formValue(form, name) {
    const value = new FormData(form).get(name);
    return typeof value === 'string' ? value : '';
  }

  function getDraftInventory(draft, product, variantId, units) {
    const key = skuKey(product.id, variantId);
    const current = draft.inventoryBySku[key] || {
      productId: product.id, variantId: variantId || null, configured: false,
      physicalUnits: 0, reservedSale: 0, reservedRental: 0, onRent: 0, inspection: 0,
    };
    if (units === '' || units === null || units === undefined) {
      if (current.configured && current.reservedSale + current.reservedRental + current.onRent + current.inspection > current.physicalUnits) {
        throw new Error('Số lượng vật lý không thể nhỏ hơn các bộ đã đặt, đang thuê hoặc chờ kiểm tra.');
      }
      return current;
    }
    if (!validInteger(units)) throw new Error('Số lượng tồn phải là số nguyên từ 0 trở lên.');
    const physicalUnits = Number(units);
    const committed = current.reservedSale + current.reservedRental + current.onRent + current.inspection;
    if (physicalUnits < committed) throw new Error('Số lượng mới thấp hơn số bộ đã cam kết.');
    return { ...current, configured: true, physicalUnits };
  }

  function createOrderFromCart(cart, form) {
    if (!Array.isArray(cart) || cart.length === 0) return { ok: false, reason: 'validation', message: 'Giỏ hàng đang trống.' };
    const lines = [];
    const reservations = new Map();
    for (const item of cart) {
      let product = findProduct(item.productId);
      if (!product) product = mergedProducts().find((candidate) => candidate.title === item.title);
      if (!product) return { ok: false, reason: 'stale', message: `Không tìm thấy ${item.title || 'một sản phẩm'} trong danh mục hiện tại. Hãy kiểm tra lại giỏ hàng.` };
      const mode = item.mode === 'Thuê' || item.mode === 'rent' ? 'rent' : 'buy';
      const variantId = inferVariant(product, item);
      if (mode === 'buy' && !product.purchaseAvailable) return { ok: false, reason: 'validation', message: `${product.title} không hỗ trợ mua đứt.` };
      if (mode === 'rent' && !product.rentalPrice14d) return { ok: false, reason: 'validation', message: `${product.title} không hỗ trợ thuê.` };
      const quantity = Number.parseInt(item.quantity, 10) || 1;
      if (!validInteger(quantity) || quantity <= 0) return { ok: false, reason: 'validation', message: 'Số lượng sản phẩm không hợp lệ.' };
      const unitPrice = expectedUnitPrice(product, mode, variantId);
      const unitDeposit = mode === 'rent' ? expectedDeposit(product) : 0;
      if (Number(item.price) !== unitPrice || Number(item.deposit || 0) !== unitDeposit) {
        return { ok: false, reason: 'stale', message: `Giá hoặc tiền cọc của “${product.title}” đã thay đổi. Cập nhật giá giỏ hàng rồi kiểm tra lại trước khi đặt.` };
      }
      const key = skuKey(product.id, variantId);
      const reservationKey = `${key}::${mode}`;
      const current = inventoryRecord(product.id, variantId);
      if (!current?.configured) return { ok: false, reason: 'stock', message: `Chưa kiểm kê tồn kho cho “${product.title}”. Hãy thiết lập số lượng trong admin trước khi tạo đơn.` };
      const priorQty = [...reservations.entries()].filter(([candidateKey]) => candidateKey.startsWith(`${key}::`)).reduce((sum, [, reservation]) => sum + reservation.quantity, 0);
      const committed = current.reservedSale + current.reservedRental + current.onRent + current.inspection;
      if (current.physicalUnits - committed - priorQty < quantity) return { ok: false, reason: 'stock', message: `Không đủ số lượng còn sẵn cho “${product.title}”.` };
      const sameModeQty = reservations.get(reservationKey)?.quantity || 0;
      reservations.set(reservationKey, { productId: product.id, variantId, mode, quantity: sameModeQty + quantity });
      lines.push({
        lineId: makeId('line'), productId: product.id, variantId: variantId || null,
        titleSnapshot: product.title, brandSnapshot: product.brand, imageSnapshot: clone(product.image),
        mode, quantity, unitPrice, unitRentalFee: mode === 'rent' ? unitPrice : 0,
        rentalDays: mode === 'rent' ? 14 : null, unitDeposit, priceLabelSnapshot: product.buyPriceLabel || null,
        purchaseStatus: mode === 'buy' ? 'new' : null, rentalStatus: mode === 'rent' ? 'new' : null,
        reservedQuantity: quantity, handedOffQuantity: 0, returnedQuantity: 0, returnEvents: [],
        rentalHandoffDate: null, rentalDueDate: null,
        deposit: { held: unitDeposit * quantity, refunded: 0, retained: 0, reason: '', resolvedAt: null },
        history: [{ id: makeId('evt'), type: 'created', at: nowIso(), note: 'Đã lưu đơn demo từ checkout.' }],
      });
    }

    const chargeTotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const depositTotal = lines.reduce((sum, line) => sum + line.deposit.held, 0);
    const customer = {
      email: cleanText(formValue(form, 'email'), 180),
      phone: cleanText(formValue(form, 'phone'), 40),
      country: cleanText(formValue(form, 'country'), 80),
      firstName: cleanText(formValue(form, 'firstName'), 100),
      lastName: cleanText(formValue(form, 'lastName'), 100),
      address: cleanText(formValue(form, 'address'), 300),
      province: cleanText(formValue(form, 'province'), 120),
      ward: cleanText(formValue(form, 'ward'), 120),
      city: cleanText(formValue(form, 'city'), 120),
      postalCode: cleanText(formValue(form, 'postalCode'), 40),
      pickupPoint: cleanText(formValue(form, 'pickupPoint'), 160),
    };
    const sourceCartIds = cart.map((item) => item.cartLineId || `${item.productId || item.title}:${item.mode}:${item.variant || ''}:${item.quantity || 1}`);
    const sourceCartFingerprint = JSON.stringify(sourceCartIds.slice().sort());
    const order = {
      id: `BB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      createdAt: nowIso(),
      sourceCartFingerprint,
      fulfillment: formValue(form, 'fulfillment') === 'pickup' ? 'pickup' : 'delivery',
      customer,
      note: cleanText(formValue(form, 'note'), 1000),
      invoiceRequested: new FormData(form).has('invoice'),
      payment: { method: formValue(form, 'payment') || 'online-demo', status: 'simulated-unpaid' },
      status: 'new',
      lines,
      totals: { charges: chargeTotal, depositHeld: depositTotal, shipping: 0, totalDue: chargeTotal + depositTotal },
      history: [{ id: makeId('evt'), type: 'order-created', at: nowIso(), note: 'Đơn demo được ghi nhận trong trình duyệt này.' }],
    };

    return transaction((draft) => {
      const duplicate = draft.orders.find((candidate) => candidate.sourceCartFingerprint === sourceCartFingerprint);
      if (duplicate) return { ok: false, reason: 'duplicate', orderId: duplicate.id, message: `Đơn ${duplicate.id} đã được lưu; giỏ hàng chưa được xóa. Hãy kiểm tra đơn trước khi thử lại.` };
      for (const reservation of reservations.values()) {
        const record = draft.inventoryBySku[skuKey(reservation.productId, reservation.variantId)];
        const committed = record.reservedSale + record.reservedRental + record.onRent + record.inspection;
        if (!record.configured || record.physicalUnits - committed < reservation.quantity) {
          return { ok: false, reason: 'stock', message: 'Tồn kho vừa được thay đổi. Hãy tải lại giỏ hàng trước khi đặt.' };
        }
        if (reservation.mode === 'rent') record.reservedRental += reservation.quantity;
        else record.reservedSale += reservation.quantity;
      }
      draft.orders.unshift(order);
      return { value: clone(order) };
    });
  }

  const api = {
    key: STORE_KEY,
    getRevision: () => state.revision,
    getReadError: () => storeReadError,
    getSnapshot: () => clone(state),
    getProducts: () => mergedProducts(),
    getAllProducts: () => mergedProducts(true),
    getProduct: (id, includeArchived = false) => findProduct(id, includeArchived),
    getCategories: mergedCategories,
    getInventory: (productId, variantId = '') => inventoryRecord(productId, variantId),
    getProductInventory: (product) => skuVariants(product).map((variant) => ({ ...variant, ...(inventoryRecord(product.id, variant.id) || {}) })),
    getOrders: () => clone(state.orders),
    getOrder: (id) => clone(state.orders.find((order) => order.id === id) || null),
    getInquiries: () => clone(state.inquiries),
    getAvailable: (productId, variantId = '') => inventoryRecord(productId, variantId)?.availableToPromise ?? null,
    isArchived: (id) => state.catalog.archivedIds.includes(id),
    createOrderFromCart,

    refreshCartPrices() {
      try {
        const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        if (!Array.isArray(cart)) return { ok: false, reason: 'validation', message: 'Không thể đọc giỏ hàng.' };
        const updated = [];
        for (const item of cart) {
          const product = findProduct(item.productId) || mergedProducts().find((candidate) => candidate.title === item.title);
          if (!product) return { ok: false, reason: 'stale', message: `Không tìm thấy “${item.title}” trong danh mục.` };
          const mode = item.mode === 'Thuê' || item.mode === 'rent' ? 'rent' : 'buy';
          const variantId = inferVariant(product, item);
          if (mode === 'buy' && !product.purchaseAvailable) return { ok: false, reason: 'stale', message: `${product.title} hiện không hỗ trợ mua đứt.` };
          if (mode === 'rent' && !product.rentalPrice14d) return { ok: false, reason: 'stale', message: `${product.title} hiện không hỗ trợ thuê.` };
          updated.push({ ...item, productId: product.id, variantId: variantId || '', price: expectedUnitPrice(product, mode, variantId), deposit: mode === 'rent' ? expectedDeposit(product) : 0 });
        }
        localStorage.setItem(CART_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('brainybox:cart-change'));
        return { ok: true };
      } catch {
        return { ok: false, reason: 'storage', message: 'Chưa lưu được trong trình duyệt. Giỏ hàng cũ vẫn được giữ.' };
      }
    },

    saveProduct(draft, expectedRevision = state.revision) {
      const existing = draft.id ? findProduct(draft.id, true) : null;
      const isNew = !existing;
      const id = isNew ? (cleanText(draft.id, 100) || `${cleanText(draft.title, 80).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 5)}`) : draft.id;
      if (isNew && (findProduct(id, true) || state.catalog.newProductIds.includes(id))) return { ok: false, reason: 'validation', message: 'Mã sản phẩm đã tồn tại.' };
      try {
        const product = normalizeProduct({ ...draft, id }, existing, isNew);
        return transaction((next) => {
          next.catalog.productsById[id] = product;
          if (isNew) next.catalog.newProductIds.push(id);
          next.catalog.archivedIds = next.catalog.archivedIds.filter((archivedId) => archivedId !== id);
          const variants = skuVariants(product);
          for (const variant of variants) {
            const units = draft.inventory?.[variant.id || 'base'];
            next.inventoryBySku[skuKey(id, variant.id)] = getDraftInventory(next, product, variant.id, units);
          }
          return { value: product };
        }, expectedRevision);
      } catch (error) {
        return { ok: false, reason: 'validation', message: error.message };
      }
    },

    archiveProduct(id, expectedRevision = state.revision) {
      if (!findProduct(id, true)) return { ok: false, reason: 'validation', message: 'Không tìm thấy sản phẩm.' };
      return transaction((next) => {
        if (!next.catalog.archivedIds.includes(id)) next.catalog.archivedIds.push(id);
      }, expectedRevision);
    },

    restoreProduct(id, expectedRevision = state.revision) {
      return transaction((next) => {
        next.catalog.archivedIds = next.catalog.archivedIds.filter((archivedId) => archivedId !== id);
      }, expectedRevision);
    },

    saveCategory(draft, expectedRevision = state.revision) {
      const id = cleanText(draft.id, 80);
      const title = cleanText(draft.title, 100);
      if (!categoryIds.has(id) || !title) return { ok: false, reason: 'validation', message: 'Danh mục không hợp lệ.' };
      return transaction((next) => {
        next.catalog.categoriesById[id] = {
          title,
          description: cleanText(draft.description, 220),
          image: isSafeImageUrl(draft.image?.src) ? { src: draft.image.src, alt: cleanText(draft.image.alt, 300) } : seedCategories.find((category) => category.id === id).image,
        };
      }, expectedRevision);
    },

    setInventory(productId, variantId, units, expectedRevision = state.revision) {
      const product = findProduct(productId, true);
      if (!product) return { ok: false, reason: 'validation', message: 'Không tìm thấy sản phẩm.' };
      if (!validInteger(units)) return { ok: false, reason: 'validation', message: 'Số lượng phải là số nguyên từ 0 trở lên.' };
      return transaction((next) => {
        const key = skuKey(productId, variantId);
        const current = next.inventoryBySku[key];
        if (!current) return { ok: false, reason: 'validation', message: 'Không tìm thấy biến thể tồn kho.' };
        const committed = current.reservedSale + current.reservedRental + current.onRent + current.inspection;
        if (Number(units) < committed) return { ok: false, reason: 'validation', message: 'Số lượng không thể thấp hơn các bộ đã đặt, đang thuê hoặc chờ kiểm tra.' };
        current.configured = true;
        current.physicalUnits = Number(units);
      }, expectedRevision);
    },

    resolveInspection(productId, variantId, quantity, outcome, expectedRevision = state.revision) {
      if (!validInteger(quantity) || Number(quantity) <= 0 || !['available', 'discard'].includes(outcome)) return { ok: false, reason: 'validation', message: 'Số lượng hoặc kết quả kiểm tra không hợp lệ.' };
      return transaction((next) => {
        const record = next.inventoryBySku[skuKey(productId, variantId)];
        if (!record || Number(quantity) > record.inspection) return { ok: false, reason: 'validation', message: 'Số lượng vượt quá các bộ đang chờ kiểm tra.' };
        record.inspection -= Number(quantity);
        if (outcome === 'discard') record.physicalUnits -= Number(quantity);
      }, expectedRevision);
    },

    confirmLine(orderId, lineId, expectedRevision = state.revision) {
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line) return { ok: false, reason: 'validation', message: 'Không tìm thấy dòng sản phẩm.' };
        const statusKey = line.mode === 'rent' ? 'rentalStatus' : 'purchaseStatus';
        if (line[statusKey] !== 'new') return { ok: false, reason: 'validation', message: 'Chỉ đơn mới mới có thể xác nhận.' };
        line[statusKey] = 'confirmed';
        recordEvent(line, 'confirmed', 'Đã xác nhận dòng sản phẩm.');
        recordEvent(order, 'line-confirmed', line.titleSnapshot);
      }, expectedRevision);
    },

    handoffPurchaseLine(orderId, lineId, expectedRevision = state.revision) {
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || line.mode !== 'buy' || line.purchaseStatus !== 'confirmed') return { ok: false, reason: 'validation', message: 'Dòng mua cần được xác nhận trước khi bàn giao.' };
        const record = next.inventoryBySku[skuKey(line.productId, line.variantId)];
        if (!record || record.reservedSale < line.quantity || record.physicalUnits < line.quantity) return { ok: false, reason: 'stock', message: 'Tồn kho không khớp với số lượng đã đặt.' };
        record.reservedSale -= line.quantity;
        record.physicalUnits -= line.quantity;
        line.handedOffQuantity = line.quantity;
        line.reservedQuantity = 0;
        line.purchaseStatus = 'handedOff';
        recordEvent(line, 'purchase-handed-off', 'Đã ghi nhận bàn giao; tồn vật lý đã giảm.');
        recordEvent(order, 'purchase-handed-off', line.titleSnapshot);
      }, expectedRevision);
    },

    completePurchaseLine(orderId, lineId, expectedRevision = state.revision) {
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || line.mode !== 'buy' || line.purchaseStatus !== 'handedOff') return { ok: false, reason: 'validation', message: 'Chỉ có thể hoàn tất dòng mua đã được bàn giao.' };
        line.purchaseStatus = 'complete';
        recordEvent(line, 'purchase-complete', 'Đã ghi nhận hoàn tất dòng mua demo.');
        recordEvent(order, 'purchase-complete', line.titleSnapshot);
      }, expectedRevision);
    },

    handoffRentalLine(orderId, lineId, handoffDate, expectedRevision = state.revision) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(handoffDate) || !datePlusDays(handoffDate, 14)) return { ok: false, reason: 'validation', message: 'Chọn ngày bàn giao hợp lệ.' };
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || line.mode !== 'rent' || line.rentalStatus !== 'confirmed') return { ok: false, reason: 'validation', message: 'Dòng thuê cần được xác nhận trước khi bàn giao.' };
        const record = next.inventoryBySku[skuKey(line.productId, line.variantId)];
        if (!record || record.reservedRental < line.quantity) return { ok: false, reason: 'stock', message: 'Tồn kho thuê không khớp với số lượng đã đặt.' };
        record.reservedRental -= line.quantity;
        record.onRent += line.quantity;
        line.reservedQuantity = 0;
        line.handedOffQuantity = line.quantity;
        line.rentalHandoffDate = handoffDate;
        line.rentalDueDate = datePlusDays(handoffDate, 14);
        line.rentalStatus = 'renting';
        recordEvent(line, 'rental-handed-off', `Bàn giao ${handoffDate}; dự kiến trả ${line.rentalDueDate}.`);
        recordEvent(order, 'rental-handed-off', line.titleSnapshot);
      }, expectedRevision);
    },

    recordRentalReturn(orderId, lineId, operation, expectedRevision = state.revision) {
      const quantity = Number(operation.quantity);
      const operationId = cleanText(operation.operationId, 100) || makeId('return');
      if (!validInteger(quantity) || quantity <= 0 || !['available', 'inspection'].includes(operation.destination)) return { ok: false, reason: 'validation', message: 'Số lượng hoặc tình trạng trả không hợp lệ.' };
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || line.mode !== 'rent' || line.rentalStatus !== 'renting') return { ok: false, reason: 'validation', message: 'Chỉ có thể ghi nhận trả cho dòng đang thuê.' };
        if (line.returnEvents.some((event) => event.id === operationId)) return { ok: false, reason: 'validation', message: 'Lượt trả này đã được ghi nhận.' };
        const outstanding = line.quantity - line.returnedQuantity;
        if (quantity > outstanding) return { ok: false, reason: 'validation', message: `Chỉ còn ${outstanding} món cần nhận lại.` };
        const record = next.inventoryBySku[skuKey(line.productId, line.variantId)];
        if (!record || record.onRent < quantity) return { ok: false, reason: 'stock', message: 'Số lượng đang thuê không khớp. Hãy tải lại trước khi lưu.' };
        record.onRent -= quantity;
        if (operation.destination === 'inspection') record.inspection += quantity;
        line.returnedQuantity += quantity;
        line.returnEvents.push({ id: operationId, quantity, destination: operation.destination, at: nowIso() });
        if (line.returnedQuantity === line.quantity) line.rentalStatus = 'returned';
        recordEvent(line, 'rental-returned', `${quantity} món · ${operation.destination === 'available' ? 'Có sẵn' : 'Chờ kiểm tra'}.`);
        recordEvent(order, 'rental-returned', line.titleSnapshot);
      }, expectedRevision);
    },

    resolveDeposit(orderId, lineId, totals, expectedRevision = state.revision) {
      const refunded = Number(totals.refunded);
      const retained = Number(totals.retained);
      const reason = cleanText(totals.reason, 500);
      if (!validInteger(refunded) || !validInteger(retained)) return { ok: false, reason: 'validation', message: 'Số tiền phải là số nguyên không âm.' };
      if (retained > 0 && reason.length < 4) return { ok: false, reason: 'validation', message: 'Ghi rõ lý do giữ lại tiền cọc.' };
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || line.mode !== 'rent') return { ok: false, reason: 'validation', message: 'Không tìm thấy dòng thuê.' };
        if (line.returnedQuantity !== line.quantity) return { ok: false, reason: 'validation', message: 'Nhận lại đủ số lượng thuê trước khi đối soát cọc.' };
        if (refunded + retained > line.deposit.held) return { ok: false, reason: 'validation', message: 'Tổng hoàn và giữ lại không thể vượt quá tiền cọc đã ghi nhận.' };
        line.deposit.refunded = refunded;
        line.deposit.retained = retained;
        line.deposit.reason = retained > 0 ? reason : '';
        line.deposit.resolvedAt = refunded + retained === line.deposit.held ? nowIso() : null;
        recordEvent(line, 'deposit-reconciled', `Hoàn ${refunded}; giữ ${retained}${retained ? ` · ${reason}` : ''}.`);
        recordEvent(order, 'deposit-reconciled', line.titleSnapshot);
      }, expectedRevision);
    },

    cancelLine(orderId, lineId, expectedRevision = state.revision) {
      return transaction((next) => {
        const order = next.orders.find((item) => item.id === orderId);
        const line = order?.lines.find((item) => item.lineId === lineId);
        if (!line || (line.mode === 'rent' ? !['new', 'confirmed'].includes(line.rentalStatus) : !['new', 'confirmed'].includes(line.purchaseStatus))) return { ok: false, reason: 'validation', message: 'Chỉ có thể hủy dòng chưa bàn giao.' };
        const record = next.inventoryBySku[skuKey(line.productId, line.variantId)];
        if (record) {
          if (line.mode === 'rent') record.reservedRental = Math.max(0, record.reservedRental - line.reservedQuantity);
          else record.reservedSale = Math.max(0, record.reservedSale - line.reservedQuantity);
        }
        line.reservedQuantity = 0;
        if (line.mode === 'rent') line.rentalStatus = 'cancelled';
        else line.purchaseStatus = 'cancelled';
        recordEvent(line, 'cancelled', 'Đã hủy trước khi bàn giao; tồn đã được giải phóng.');
        recordEvent(order, 'line-cancelled', line.titleSnapshot);
      }, expectedRevision);
    },

    createInquiry(fields) {
      const organization = cleanText(fields.organization, 180);
      const name = cleanText(fields.name, 120);
      const phone = cleanText(fields.phone, 40);
      const email = cleanText(fields.email, 180);
      if (!organization || !name || !phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'validation', message: 'Hãy kiểm tra lại các thông tin liên hệ bắt buộc.' };
      const inquiry = { id: makeId('b2b'), createdAt: nowIso(), organization, name, phone, email, status: 'new', notes: '', closedOutcome: '', history: [{ id: makeId('evt'), status: 'new', at: nowIso(), note: 'Yêu cầu B2B được lưu từ biểu mẫu cửa hàng.' }] };
      return transaction((next) => { next.inquiries.unshift(inquiry); return { value: clone(inquiry) }; });
    },

    updateInquiry(id, changes, expectedRevision = state.revision) {
      const status = cleanText(changes.status, 40);
      const note = cleanText(changes.note, 1200);
      const outcome = cleanText(changes.outcome, 500);
      if (!['new', 'contacted', 'closed'].includes(status)) return { ok: false, reason: 'validation', message: 'Trạng thái yêu cầu không hợp lệ.' };
      return transaction((next) => {
        const inquiry = next.inquiries.find((item) => item.id === id);
        if (!inquiry) return { ok: false, reason: 'validation', message: 'Không tìm thấy yêu cầu B2B.' };
        if (status === 'closed' && !outcome) return { ok: false, reason: 'validation', message: 'Ghi chú kết quả trước khi đóng yêu cầu.' };
        inquiry.status = status;
        if (note) inquiry.notes = note;
        inquiry.closedOutcome = status === 'closed' ? outcome : '';
        inquiry.history.push({ id: makeId('evt'), status, at: nowIso(), note: status === 'closed' ? outcome : note });
      }, expectedRevision);
    },
  };

  window.BrainyBoxStore = api;
  hydrateCatalog();
  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY) return;
    const fresh = readPersistedState();
    state = fresh.state;
    storeReadError = fresh.error;
    hydrateCatalog();
    window.dispatchEvent(new CustomEvent('brainybox:store-external-change', { detail: { revision: state.revision, error: storeReadError } }));
  });
})();
