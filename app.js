const catalog = window.CHARACTER_CATALOG || { characters: [] };

const els = {
  resultCount: document.querySelector("#resultCount"),
  cards: document.querySelector("#cards")
};

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

// 一覧に出るのは公開分のみ。非表示キャラは単独では出ず、
// 基準キャラの派生としてだけ選べる。
function listedCharacters() {
  return catalog.characters
    .filter(char => !char.isHidden)
    .sort((a, b) =>
      String(a.category || "").localeCompare(String(b.category || ""), "ja") ||
      Number(a.displayOrder || 999999) - Number(b.displayOrder || 999999) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ja")
    );
}

const GROUP_ORDER = ["ペンギン", "ハーピィ", "兎"];

// --- 派生パネル（全幅方式） ---
// 派生リストは行の子要素にしない。行の中で広げると、
// grid の同じ段にある他の行が引っ張られて伸びてしまうため、
// パネルは grid の独立した子として「その行がいる段の末尾」の直後に
// 全幅（grid-column: 1 / -1）で差し込む。同時に開けるパネルは1つだけ。
let openVariant = null; // { panel, card, toggle }

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

function buildVariantPanel(char, variants) {
  const panel = document.createElement("div");
  panel.className = "variant-panel";
  const header = document.createElement("div");
  header.className = "variant-panel-head";
  header.textContent = `${char.name || "(no name)"} の派生`;
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
  if (!openVariant) return;
  const { panel, card } = openVariant;
  panel.remove();
  rowEndCard(card).after(panel);
});

function createRow(char) {
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
  row.append(name);

  const variants = variantModel.variantsByMainId.get(char.id) || [];
  if (variants.length) {
    const panel = buildVariantPanel(char, variants);
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
  }
  return row;
}

function renderCards() {
  const chars = listedCharacters();
  els.resultCount.innerHTML = "";
  const countNum = document.createElement("b");
  countNum.textContent = String(chars.length);
  els.resultCount.append(countNum, " 件");
  els.cards.innerHTML = "";
  if (!chars.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "キャラクターがありません。";
    els.cards.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const groupedIds = new Set();
  GROUP_ORDER.forEach((groupName, index) => {
    const members = chars.filter(char => char.group === groupName);
    if (!members.length) return;
    members.forEach(char => groupedIds.add(char.id));
    // グループは開閉式。先頭のグループだけ開いておく
    const isFirst = index === 0;
    const section = document.createElement("section");
    section.className = isFirst ? "group open" : "group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "group-toggle";
    toggle.setAttribute("aria-expanded", String(isFirst));
    const label = document.createElement("span");
    label.className = "group-name";
    label.textContent = groupName;
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${members.length}件`;
    const icon = document.createElement("span");
    icon.className = "group-toggle-icon";
    icon.textContent = "▼";
    toggle.append(label, count, icon);
    const grid = document.createElement("div");
    grid.className = "rows group-body";
    // CSSのキャッシュが古くても開閉が効くよう、表示はインラインでも制御する
    grid.style.display = isFirst ? "grid" : "none";
    toggle.addEventListener("click", () => {
      const open = section.classList.toggle("open");
      grid.style.display = open ? "grid" : "none";
      toggle.setAttribute("aria-expanded", String(open));
    });
    members.forEach(char => grid.append(createRow(char)));
    section.append(toggle, grid);
    fragment.append(section);
  });

  const rest = chars.filter(char => !groupedIds.has(char.id));
  if (rest.length) {
    const grid = document.createElement("div");
    grid.className = "rows rest";
    rest.forEach(char => grid.append(createRow(char)));
    fragment.append(grid);
  }

  els.cards.append(fragment);
}

renderCards();
