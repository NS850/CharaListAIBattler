const catalog = window.CHARACTER_CATALOG || { characters: [] };

const els = {
  resultCount: document.querySelector("#resultCount"),
  resultAnnounce: document.querySelector("#resultAnnounce"),
  cards: document.querySelector("#cards"),
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

// --- 商品パネル（ハーピィ雑貨店の陳列、2026-11-10 追加） ---
// 派生パネルと同じ全幅方式・排他開閉をそのまま使う（toggleVariantPanel 共用）。
// 商品データは gen_site.js が店の skill から生成し data.js の products に入る。
function buildProductPanel(char, products = char.products || [], searchHit = false) {
  const panel = document.createElement("div");
  panel.className = "variant-panel product-panel";
  const header = document.createElement("div");
  header.className = "variant-panel-head";
  header.textContent = `${char.name || "(no name)"} の商品${searchHit ? `（検索ヒット ${products.length}件）` : ""}`;
  panel.append(header);
  const list = document.createElement("div");
  list.className = "product-list";
  products.forEach(product => {
    const row = document.createElement("div");
    row.className = "product-row";
    if (product.image) {
      const img = document.createElement("img");
      img.className = "product-img";
      img.src = product.image;
      img.alt = product.name || "";
      img.width = 48;
      img.height = 48;
      img.loading = "lazy";
      row.append(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "product-img product-img-empty";
      ph.setAttribute("aria-hidden", "true");
      row.append(ph);
    }
    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = product.name || "(no name)";
    const price = document.createElement("span");
    price.className = "product-price";
    price.textContent = `${Number(product.price || 0).toLocaleString("ja-JP")} G`;
    row.append(name, price);
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

  const products = Array.isArray(char.products) ? char.products : [];
  if (products.length) {
    const hits = searchMatches?.matchedProducts || [];
    const panel = buildProductPanel(char, hits.length ? hits : products, hits.length > 0);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "variant-toggle product-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.textContent = `商品 ${products.length}件`;
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
  if (place.products?.length) {
    panel.append(placeText("h4", "商品"));
    const products = buildProductPanel(place).querySelector(".product-list");
    panel.append(products);
  }
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
  if (place.products?.length) {
    const strip = document.createElement("div");
    strip.className = "place-products";
    place.products.filter(product => product.image).forEach(product => {
      const img = document.createElement("img");
      img.src = product.image;
      img.alt = product.name || "";
      img.width = 40;
      img.height = 40;
      img.loading = "lazy";
      strip.append(img);
    });
    card.append(strip);
  }
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
      els.series.hidden = activeView === "places";
      const label = activeView === "places" ? "地点名・関連キャラクターで検索" : "名前・特徴で検索";
      els.search.placeholder = label;
      els.search.setAttribute("aria-label", label);
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
