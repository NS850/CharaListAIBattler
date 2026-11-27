const catalog = window.CHARACTER_CATALOG || { characters: [] };

const els = {
  resultCount: document.querySelector("#resultCount"),
  resultAnnounce: document.querySelector("#resultAnnounce"),
  cards: document.querySelector("#cards"),
  searchBlock: document.querySelector(".search-block"),
  search: document.querySelector("#search"),
  clearSearch: document.querySelector("#clearSearch"),
  series: document.querySelector("#series")
};

let resultAnnounceTimer;

function announceResult(text) {
  clearTimeout(resultAnnounceTimer);
  resultAnnounceTimer = setTimeout(() => {
    if (els.resultAnnounce.textContent !== text) els.resultAnnounce.textContent = text;
  }, 300);
}

function runViewTransition(update) {
  if (typeof document.startViewTransition === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

const variantModel = buildVariantModel(catalog.characters);

function buildVariantModel(characters) {
  const byName = new Map();
  const variantsByMainId = new Map();
  const mainByVariantId = new Map();

  characters.forEach(char => {
    if (char.name && !byName.has(char.name)) byName.set(char.name, char);
  });

  // 1) フォルダ派生: フォルダ名（category）と同名のキャラを基準にする。
  // 基準キャラ自身が別フォルダにいてもよい（例: ローレ本体は未分類側）。
  characters.forEach(char => {
    if (!char.category) return;
    const main = byName.get(char.category);
    if (!main || main.id === char.id) return;
    mainByVariantId.set(char.id, main);
  });

  // 2) 括弧付き派生: 「基準名（〜）」「基準名(〜)」の形で、基準名のキャラが実在するもの。
  characters.forEach(char => {
    if (mainByVariantId.has(char.id)) return;
    const match = String(char.name || "").match(/^(.+?)\s*[（(].+[）)]\s*$/);
    if (!match) return;
    const main = byName.get(match[1].trim());
    if (!main || main.id === char.id) return;
    mainByVariantId.set(char.id, main);
  });

  // 派生の派生は最終的な基準へ寄せる（循環時はその場で止める）。
  function ultimateMain(char) {
    let current = char;
    const seen = new Set([current.id]);
    while (mainByVariantId.has(current.id)) {
      const next = mainByVariantId.get(current.id);
      if (seen.has(next.id)) break;
      seen.add(next.id);
      current = next;
    }
    return current;
  }

  characters.forEach(char => {
    if (!mainByVariantId.has(char.id)) return;
    const main = ultimateMain(char);
    if (main.id === char.id) {
      mainByVariantId.delete(char.id);
      return;
    }
    mainByVariantId.set(char.id, main);
    if (!variantsByMainId.has(main.id)) variantsByMainId.set(main.id, []);
    variantsByMainId.get(main.id).push(char);
  });

  variantsByMainId.forEach(variants => {
    variants.sort((a, b) =>
      Number(a.displayOrder || 999999) - Number(b.displayOrder || 999999) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ja")
    );
  });

  characters.forEach(char => {
    const variants = variantsByMainId.get(char.id) || [];
    char.variantCount = variants.length;
    char.isVariant = mainByVariantId.has(char.id);
    char.mainId = char.isVariant ? mainByVariantId.get(char.id).id : char.id;
  });

  return { variantsByMainId, mainByVariantId };
}

const SECTION_LABELS = {
  character: "キャラクター",
  situation: "シチュエーション・場所・クエスト",
  other: "敵・その他"
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);
const GROUP_ORDER = ["ペンギン", "ハーピィ", "兎"];
let query = "";
let series = null;
const listed = catalog.characters.filter(char => char.catalogListed);
const compareCharacters = (a, b) =>
  Number(a.displayOrder ?? 999999) - Number(b.displayOrder ?? 999999) ||
  String(a.name || "").localeCompare(String(b.name || ""), "ja");

function normalize(value) {
  return String(value ?? "")
    .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase().replace(/\s/g, "");
}

const searchTargets = new Map(catalog.characters.map(char => [char.id,
  [char.name, char.promptName, SECTION_LABELS[char.section], char.group, char.category,
    ...(char.statuses || []).flatMap(status => [status.name, status.value]),
    ...(char.products || []).map(product => product.name)].map(normalize)
]));
function matches(char, needle) {
  return searchTargets.get(char.id).some(target => target.includes(needle));
}

function renderSeriesButtons() {
  els.series.replaceChildren();
  [null, ...GROUP_ORDER].forEach(group => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "variant-toggle series-button";
    button.setAttribute("aria-pressed", String(series === group));
    button.textContent = group ? `${group} ${listed.filter(char => char.group === group).length}` : "すべて";
    button.addEventListener("click", () => {
      series = series === group ? null : group;
      renderCards();
    });
    els.series.append(button);
  });
}

// --- 派生パネル（全幅方式） ---
// 派生リストは行の子要素にしない。行の中で広げると、
// grid の同じ段にある他の行が引っ張られて伸びてしまうため、
// パネルは grid の独立した子として「その行がいる段の末尾」の直後に
// 全幅（grid-column: 1 / -1）で差し込む。検索時のみ複数を開ける。
let openVariant = null; // { panel, card, toggle }
const searchPanels = new Set(); // { panel, card, toggle }

function positionSearchPanels() {
  const panels = Array.from(searchPanels);
  panels.forEach(({ panel }) => panel.remove());
  // 全パネルを外してから行末を測り、同じ行末への挿入順も保つ。
  const anchors = panels.map(({ card }) => rowEndCard(card));
  panels.slice().reverse().forEach(({ panel }, index) => {
    anchors[panels.length - 1 - index].after(panel);
  });
}

function closeVariantPanel() {
  if (!openVariant) return;
  openVariant.panel.remove();
  openVariant.toggle.setAttribute("aria-expanded", "false");
  openVariant.card.classList.remove("open");
  openVariant = null;
}

// 行がいる段の末尾の行を返す（offsetTop が同じ行＝同じ段）。
// パネルが開いている状態では段がずれるので、必ず閉じた状態で測ること。
function rowEndCard(card) {
  const grid = card.parentElement;
  if (!grid) return card;
  const cards = Array.from(grid.children).filter(el => el.classList.contains("row"));
  const top = card.offsetTop;
  let anchor = card;
  cards.forEach(c => {
    if (c.offsetTop === top) anchor = c;
  });
  return anchor;
}

function buildVariantPanel(char, variants, searchHit = false) {
  const panel = document.createElement("div");
  panel.className = "variant-panel";
  const header = document.createElement("div");
  header.className = "variant-panel-head";
  header.textContent = `${char.name || "(no name)"} の派生${searchHit ? `（検索ヒット ${variants.length}件）` : ""}`;
  panel.append(header);
  const list = document.createElement("div");
  list.className = "variant-list";
  variants.forEach(variant => {
    const row = document.createElement("div");
    row.className = "variant-row";
    const vName = document.createElement("span");
    vName.textContent = variant.name || "(no name)";
    row.append(vName);
    if (variant.isHidden) {
      const badge = document.createElement("span");
      badge.className = "hidden-badge";
      badge.textContent = "非表示";
      row.append(badge);
    }
    row.addEventListener("click", event => {
      event.stopPropagation();
      window.open(variant.url, "_blank", "noreferrer");
    });
    list.append(row);
  });
  panel.append(list);
  return panel;
}

function toggleVariantPanel(card, toggle, panel) {
  if (query.length > 0) {
    const current = Array.from(searchPanels).find(entry => entry.panel === panel);
    if (current) {
      panel.remove();
      searchPanels.delete(current);
    } else {
      searchPanels.add({ panel, card, toggle });
    }
    toggle.setAttribute("aria-expanded", String(!current));
    card.classList.toggle("open", Array.from(searchPanels).some(entry => entry.card === card));
    positionSearchPanels();
    return;
  }
  const isThis = openVariant && openVariant.panel === panel;
  closeVariantPanel();
  if (isThis) return;
  rowEndCard(card).after(panel);
  toggle.setAttribute("aria-expanded", "true");
  card.classList.add("open");
  openVariant = { panel, card, toggle };
}

// 画面幅が変わって行の組み替えが起きたら、開いているパネルを現在の行末へ移す。
window.addEventListener("resize", () => {
  if (searchPanels.size) positionSearchPanels();
  if (!openVariant) return;
  const { panel, card } = openVariant;
  panel.remove();
  rowEndCard(card).after(panel);
});

function createRow(char, showSection = false, searchMatches = null) {
  const row = document.createElement("div");
  row.className = "row";
  // 名前は実リンク（キーボードでも辿れる）。行の余白クリックでも対戦ページへ。
  // リンクやトグル自身のクリックは二重に開かないよう行側では拾わない
  row.addEventListener("click", event => {
    if (event.target.closest("a, button")) return;
    window.open(char.url, "_blank", "noreferrer");
  });

  const name = document.createElement("a");
  name.className = "name";
  name.href = char.url;
  name.target = "_blank";
  name.rel = "noreferrer";
  name.textContent = char.name || "(no name)";
  const identity = document.createElement("div");
  identity.className = "row-identity";
  identity.append(name);
  if (showSection) {
    const detail = document.createElement("span");
    detail.className = "row-detail";
    detail.textContent = SECTION_LABELS[char.section];
    identity.append(detail);
  }
  row.append(identity);

  const variants = variantModel.variantsByMainId.get(char.id) || [];
  if (variants.length) {
    const hits = searchMatches?.matchedVariants || [];
    const panel = buildVariantPanel(char, hits.length ? hits : variants, hits.length > 0);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "variant-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.textContent = `派生 ${variants.length}件`;
    const icon = document.createElement("span");
    icon.className = "variant-toggle-icon";
    icon.textContent = "▼";
    toggle.append(label, icon);
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      toggleVariantPanel(row, toggle, panel);
    });
    row.append(toggle);
    if (hits.length) {
      searchPanels.add({ panel, card: row, toggle });
      toggle.setAttribute("aria-expanded", "true");
      row.classList.add("open");
    }
  }

  return row;
}

function renderCards() {
  if (activeView === "places") return renderPlaces();
  if (activeView === "sketches") return renderSketches();
  if (activeView === "shop") return renderShop();
  if (activeView === "gallery") return renderGallery();
  closeVariantPanel();
  const searching = query.length > 0;
  const needle = normalize(query);
  searchPanels.forEach(({ panel }) => panel.remove());
  searchPanels.clear();
  const searchMatches = new Map();
  let chars = listed.filter(char => {
    if (series && char.group !== series) return false;
    if (!searching) return true;
    const matchedVariants = (variantModel.variantsByMainId.get(char.id) || [])
      .filter(variant => matches(variant, needle));
    const matchedProducts = (char.products || [])
      .filter(product => normalize(product.name).includes(needle));
    searchMatches.set(char.id, { matchedVariants, matchedProducts });
    return matches(char, needle) || matchedVariants.length > 0 || matchedProducts.length > 0;
  });
  chars = chars.slice().sort((a, b) =>
    (!searching && series ? SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) : 0) ||
    compareCharacters(a, b));
  els.clearSearch.hidden = !searching;
  // Keep the focused series control in place while updating its state.
  els.series.querySelectorAll("button").forEach((button, index) => {
    button.setAttribute("aria-pressed", String(series === [null, ...GROUP_ORDER][index]));
  });
  const count = document.createElement("b");
  count.textContent = String(chars.length);
  els.resultCount.replaceChildren(count, searching ? " 件ヒット" : " 件");
  announceResult(searching ? `${chars.length} 件ヒット` : `${chars.length} 件`);
  els.cards.replaceChildren();
  if (!chars.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "見つかりませんでした。";
    els.cards.append(empty);
    return;
  }
  if (searching || series) {
    const grid = document.createElement("div");
    grid.className = "rows rest";
    chars.forEach(char => grid.append(createRow(char, !!series, searchMatches.get(char.id))));
    els.cards.append(grid);
    positionSearchPanels();
    return;
  }
  SECTION_ORDER.forEach((key, index) => {
    const members = chars.filter(char => char.section === key);
    const section = document.createElement("section");
    section.className = index === 0 ? "group open" : "group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "group-toggle";
    toggle.setAttribute("aria-expanded", String(index === 0));
    const label = document.createElement("span");
    label.className = "group-name";
    label.textContent = SECTION_LABELS[key];
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${members.length}件`;
    const icon = document.createElement("span");
    icon.className = "group-toggle-icon";
    icon.textContent = "▼";
    toggle.append(label, count, icon);
    const grid = document.createElement("div");
    grid.className = "rows group-body";
    grid.style.display = index === 0 ? "grid" : "none";
    toggle.addEventListener("click", () => {
      closeVariantPanel();
      const open = section.classList.toggle("open");
      grid.style.display = open ? "grid" : "none";
      toggle.setAttribute("aria-expanded", String(open));
    });
    members.forEach(char => grid.append(createRow(char)));
    section.append(toggle, grid);
    els.cards.append(section);
  });
}

// 場所はキャラクターのパネル状態から独立させる。
const placeData = catalog.places || { groups: [], places: [] };
let activeView = "characters";
let openPlace = null;

function closePlacePanel() {
  if (!openPlace) return;
  openPlace.panel.remove();
  openPlace.toggle.setAttribute("aria-expanded", "false");
  openPlace.card.classList.remove("open");
  openPlace = null;
}

function placeText(tag, text, className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}

function characterLink(char) {
  const link = placeText("a", char.name);
  link.href = char.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

function buildPlacePanel(place) {
  const panel = document.createElement("div");
  panel.className = "variant-panel place-panel";
  panel.id = `place-panel-${place.id}`;
  panel.append(placeText("h3", place.name));
  if (place.description) panel.append(placeText("p", place.description, "place-description"));
  panel.append(placeText("h4", "関連キャラクター"));
  const list = document.createElement("ul");
  (place.relatedCharacters || []).forEach(char => {
    const item = document.createElement("li");
    item.append(characterLink(char));
    list.append(item);
  });
  panel.append(list);
  return panel;
}

function createPlaceCard(place) {
  const card = document.createElement("article");
  card.className = "row place-card";
  card.dataset.placeId = place.id;
  const toggle = placeText("button", place.name, "place-name");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", `place-panel-${place.id}`);
  card.append(toggle);
  const chips = document.createElement("div");
  chips.className = "place-chips";
  (place.relatedCharacters || []).forEach(char => {
    const link = characterLink(char);
    link.className = "place-chip";
    link.addEventListener("click", event => event.stopPropagation());
    chips.append(link);
  });
  card.append(chips);
  card.addEventListener("click", event => {
    if (event.target.closest("a")) return;
    const wasOpen = openPlace?.card === card;
    closePlacePanel();
    if (wasOpen) return;
    const panel = buildPlacePanel(place);
    rowEndCard(card).after(panel);
    toggle.setAttribute("aria-expanded", "true");
    card.classList.add("open");
    openPlace = { card, panel, toggle };
  });
  return card;
}

function renderPlaces() {
  closePlacePanel();
  els.cards.replaceChildren();
  const needle = normalize(query);
  const places = placeData.places.filter(place =>
    [place.name, ...(place.relatedCharacters || []).map(char => char.name)]
      .some(value => normalize(value).includes(needle)));
  els.resultCount.textContent = `${places.length} 地点`;
  announceResult(`${places.length} 地点`);
  els.clearSearch.hidden = !query.length;
  placeData.groups.forEach(group => {
    const members = places.filter(place => place.group === group);
    if (!members.length) return;
    const section = document.createElement("section");
    section.className = "group";
    section.append(placeText("h2", group, "place-group-name"));
    const grid = document.createElement("div");
    grid.className = "rows place-grid";
    members.forEach(place => grid.append(createPlaceCard(place)));
    section.append(grid);
    els.cards.append(section);
  });
  if (!places.length) els.cards.append(placeText("p", "見つかりませんでした。", "empty"));
}

function createSketchWork(entry, featured) {
  const work = document.createElement("article");
  work.className = featured ? "sketch-work sketch-featured" : "sketch-work";
  const figure = document.createElement("figure");
  figure.className = "sketch-figure";
  const image = document.createElement("img");
  image.alt = `テッサのスケッチ（${entry.date}）`;
  if (featured) image.setAttribute("fetchpriority", "high");
  else image.loading = "lazy";
  image.src = entry.img;
  figure.append(image);

  const meta = document.createElement("div");
  meta.className = "sketch-meta";
  const link = placeText("a", "バトル結果を見る", "sketch-link");
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  meta.append(placeText("span", entry.date, "sketch-date"), link);
  work.append(figure, meta);
  return work;
}

function renderSketches() {
  const sketches = catalog.sketches || [];
  els.cards.replaceChildren();
  els.resultCount.replaceChildren(placeText("b", sketches.length), " 点");
  announceResult(`${sketches.length} 点`);
  const credit = placeText("p", "画像生成: Stable Diffusion XL / Animagine XL / P-H3-Image", "gen-credit");
  if (!sketches.length) {
    els.cards.append(placeText("p", "まだスケッチがありません。", "empty"), credit);
    return;
  }

  const [featured, ...rest] = sketches;
  els.cards.append(createSketchWork(featured, true));
  if (rest.length) {
    const grid = document.createElement("div");
    grid.className = "sketch-grid";
    rest.forEach(entry => grid.append(createSketchWork(entry, false)));
    els.cards.append(grid);
  }
  els.cards.append(credit);
}

const galleryLightbox = document.querySelector("#galleryLightbox");
const lightboxClose = galleryLightbox.querySelector("button");
const lightboxImage = galleryLightbox.querySelector("img");
const lightboxTitle = galleryLightbox.querySelector("p");

lightboxClose.addEventListener("click", () => galleryLightbox.close());
galleryLightbox.addEventListener("click", event => {
  if (event.target === galleryLightbox) galleryLightbox.close();
});

function renderGallery() {
  const items = window.GALLERY_ITEMS || [];
  els.resultCount.replaceChildren(placeText("b", items.length), "件");
  announceResult(`${items.length}件`);

  const grid = placeText("div", "", "gallery-grid");
  for (const { file, title, tags, credit, date, candidate } of items) {
    const card = placeText("article", "", candidate ? "gallery-card candidate" : "gallery-card");
    const image = document.createElement("img");
    image.alt = title;
    image.setAttribute("fetchpriority", "low");
    image.src = `images/gallery/${file}`;
    const trigger = placeText("button", "", "gallery-image-button");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.append(image);
    trigger.addEventListener("click", () => {
      lightboxImage.src = image.src;
      lightboxImage.alt = title;
      lightboxTitle.textContent = title;
      galleryLightbox.setAttribute("aria-label", title);
      trigger.focus({ preventScroll: true });
      galleryLightbox.showModal();
    });

    const body = placeText("div", "", "gallery-card-body");
    const time = placeText("time", date, "gallery-date");
    time.dateTime = date;
    body.append(
      placeText("h3", title),
      placeText("div", tags.join(" / "), "gallery-tags"),
      placeText("div", `制作: ${credit}`, "gallery-credit"),
      time
    );
    card.append(trigger, body);
    grid.append(card);
  }
  els.cards.replaceChildren(grid);
}

function createShopIcon(item, size, alt = "") {
  if (!item.image) {
    const placeholder = placeText("div", "", "shop-product-img-empty");
    placeholder.setAttribute("aria-hidden", "true");
    return placeholder;
  }
  const image = document.createElement("img");
  image.alt = alt;
  image.width = size;
  image.height = size;
  image.loading = "lazy";
  image.src = item.image;
  return image;
}

function formatShopPrice(price) {
  return `${Number(price || 0).toLocaleString("ja-JP")} G`;
}

function renderShop() {
  const shop = catalog.characters.find(char => char.name === "ハーピィ雑貨店");
  const products = shop?.products || [];
  const inventory = shop?.inventory || [];
  const inventoryRows = inventory.filter(item => !item.onShelf);
  els.cards.replaceChildren();
  els.resultCount.replaceChildren(placeText("b", products.length), " 件");
  announceResult(`${products.length} 件`);
  const credit = placeText("p", "商品アイコン: GPT Image", "gen-credit");
  if (!products.length && !inventoryRows.length) {
    els.cards.append(placeText("p", "商品がありません。", "empty"), credit);
    return;
  }

  const header = placeText("div", "", "shop-header");
  const title = placeText("h2", "", "shop-title");
  const titleLink = characterLink(shop);
  titleLink.className = "shop-title-link";
  title.append(titleLink);
  header.append(title);

  const buyout = catalog.characters.find(char => char.name === "ハーピィ出張買取サービス");
  if (buyout) {
    const sublink = placeText("p", "", "shop-sublink");
    sublink.append(characterLink(buyout));
    header.append(sublink);
  }

  const grid = placeText("div", "", "shop-grid");
  products.forEach(product => {
    const article = placeText("article", "", "shop-product");
    article.append(createShopIcon(product, 96, product.name));
    article.append(
      placeText("div", product.name, "shop-product-name"),
      placeText("div", formatShopPrice(product.price), "shop-product-price")
    );
    grid.append(article);
  });
  els.cards.append(header, grid);
  if (inventoryRows.length) els.cards.append(createShopInventory(inventoryRows));
  els.cards.append(credit);
}

function createShopInventory(inventory) {
  const section = placeText("section", "", "shop-inventory");
  const heading = placeText("h3", "在庫 ", "shop-inventory-heading");
  heading.append(placeText("span", `${inventory.length}件`, "shop-inventory-count"));
  const list = placeText("ul", "", "shop-inventory-list");
  list.setAttribute("role", "list");
  inventory.forEach(item => {
    const row = placeText("li", "", "shop-inventory-row");
    const details = placeText("div", "", "shop-inventory-details");
    const meta = placeText("div", "", "shop-inventory-meta");
    meta.append(
      placeText("span", formatShopPrice(item.price), "shop-inventory-price"),
      placeText("span", item.stockDate)
    );
    details.append(placeText("div", item.name, "shop-inventory-name"), meta);
    row.append(createShopIcon(item, 48), details);
    list.append(row);
  });
  section.append(heading, list);
  return section;
}

window.addEventListener("resize", () => {
  if (!openPlace) return;
  const { card, panel } = openPlace;
  panel.remove();
  rowEndCard(card).after(panel);
});
document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    runViewTransition(() => {
      closePlacePanel();
      closeVariantPanel();
      searchPanels.forEach(({ panel }) => panel.remove());
      searchPanels.clear();
      activeView = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach(control =>
        control.setAttribute("aria-pressed", String(control.dataset.view === activeView)));
      els.series.hidden = activeView !== "characters";
      els.searchBlock.hidden = activeView !== "characters" && activeView !== "places";
      if (!els.searchBlock.hidden) {
        const label = activeView === "places" ? "地点名・関連キャラクターで検索" : "名前・特徴で検索";
        els.search.placeholder = label;
        els.search.setAttribute("aria-label", label);
      }
      renderCards();
    });
  });
});

els.search.addEventListener("input", () => {
  query = els.search.value;
  renderCards();
});
els.clearSearch.addEventListener("click", () => {
  query = "";
  els.search.value = "";
  renderCards();
  els.search.focus();
});
renderSeriesButtons();
renderCards();
