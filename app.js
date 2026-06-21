const catalog = window.CHARACTER_CATALOG || { characters: [] };
const state = {
  query: "",
  category: "",
  tag: "",
  type: "",
  showVariants: false,
  sort: "order"
};

const els = {
  metaLine: document.querySelector("#metaLine"),
  searchInput: document.querySelector("#searchInput"),
  categorySelect: document.querySelector("#categorySelect"),
  tagSelect: document.querySelector("#tagSelect"),
  typeSelect: document.querySelector("#typeSelect"),
  variantToggle: document.querySelector("#variantToggle"),
  sortSelect: document.querySelector("#sortSelect"),
  clearButton: document.querySelector("#clearButton"),
  resultCount: document.querySelector("#resultCount"),
  activeFilters: document.querySelector("#activeFilters"),
  cards: document.querySelector("#cards"),
  dialog: document.querySelector("#detailDialog"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSub: document.querySelector("#detailSub"),
  detailBody: document.querySelector("#detailBody"),
  closeDialog: document.querySelector("#closeDialog")
};

const variantModel = buildVariantModel(catalog.characters);

function buildVariantModel(characters) {
  const representativesByCategory = new Map();
  const variantsByMainId = new Map();
  const mainByVariantId = new Map();

  characters.forEach(char => {
    if (char.category && char.name === char.category) {
      representativesByCategory.set(char.category, char);
    }
  });

  characters.forEach(char => {
    const main = representativesByCategory.get(char.category);
    if (!main || main.id === char.id) return;
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

function normalize(value) {
  return String(value || "").toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function optionList(select, values, allLabel) {
  select.innerHTML = "";
  select.append(new Option(allLabel, ""));
  values.forEach(value => select.append(new Option(value, value)));
}

function setupFilters() {
  const chars = catalog.characters;
  optionList(els.categorySelect, uniqueSorted(chars.map(c => c.category)), "すべて");
  optionList(els.tagSelect, uniqueSorted(chars.flatMap(c => asArray(c.tags))), "すべて");
  els.metaLine.textContent = `${catalog.count || chars.length}件 / ${catalog.generatedAt || ""} 生成`;
}

function matchesType(char) {
  if (state.type === "battle") return !char.isNotBattle;
  if (state.type === "nonBattle") return char.isNotBattle;
  if (state.type === "hidden") return char.isHidden;
  return true;
}

function searchText(char) {
  return normalize([
    char.name,
    char.promptName,
    char.category,
    char.group,
    char.summary,
    asArray(char.tags).join(" "),
    asArray(char.statuses).map(s => `${s.name} ${s.value}`).join(" ")
  ].join(" "));
}

function matchesCharacter(char, words) {
  if (state.category && char.category !== state.category) return false;
  if (state.tag && !asArray(char.tags).includes(state.tag)) return false;
  if (!matchesType(char)) return false;
  if (words.length && !words.every(word => searchText(char).includes(word))) return false;
  return true;
}

function groupMembers(char) {
  return [char, ...(variantModel.variantsByMainId.get(char.id) || [])];
}

function matchesGroup(char, words) {
  return groupMembers(char).some(member => matchesCharacter(member, words));
}

function filteredCharacters() {
  const q = normalize(state.query).trim();
  const words = q ? q.split(/\s+/) : [];
  let chars = catalog.characters.filter(char => {
    if (state.showVariants) return matchesCharacter(char, words);
    if (char.isVariant) return false;
    return matchesGroup(char, words);
  });

  chars = [...chars].sort((a, b) => {
    if (state.sort === "updated") return String(b.updated || "").localeCompare(String(a.updated || ""));
    if (state.sort === "name") return String(a.name || "").localeCompare(String(b.name || ""), "ja");
    return String(a.category || "").localeCompare(String(b.category || ""), "ja") ||
      Number(a.displayOrder || 999999) - Number(b.displayOrder || 999999) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ja");
  });
  return chars;
}

function badge(text, className = "") {
  const span = document.createElement("span");
  span.className = `badge ${className}`.trim();
  span.textContent = text;
  return span;
}

function renderCards() {
  const chars = filteredCharacters();
  els.resultCount.textContent = `${chars.length}件`;
  els.activeFilters.textContent = [
    state.query && `検索: ${state.query}`,
    state.category && `カテゴリ: ${state.category}`,
    state.tag && `タグ: ${state.tag}`,
    state.type && `種類: ${els.typeSelect.selectedOptions[0].textContent}`,
    state.showVariants && "派生も表示"
  ].filter(Boolean).join(" / ");

  els.cards.innerHTML = "";
  if (!chars.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "条件に合うキャラクターがありません。";
    els.cards.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  chars.forEach(char => {
    const card = document.createElement("article");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("h2");
    title.textContent = char.name || "(no name)";
    const category = document.createElement("span");
    category.className = "category";
    category.textContent = char.category || "未分類";
    head.append(title, category);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = char.summary || char.promptName || "説明なし";

    const badges = document.createElement("div");
    badges.className = "badges";
    badges.append(badge(char.isNotBattle ? "非戦闘" : "戦闘あり", char.isNotBattle ? "muted" : "accent"));
    if (char.isVariant) badges.append(badge("派生", "muted"));
    if (!char.isVariant && char.variantCount) badges.append(badge(`派生 ${char.variantCount}件`, "accent"));
    if (char.isHidden) badges.append(badge("非表示", "muted"));
    asArray(char.tags).slice(0, 5).forEach(tag => badges.append(badge(tag)));

    const actions = document.createElement("div");
    actions.className = "actions";
    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "secondary-button";
    detail.textContent = "詳細";
    detail.addEventListener("click", () => openDetail(char));
    const link = document.createElement("a");
    link.className = "primary-link";
    link.href = char.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "AIバトラーで開く";
    actions.append(detail, link);

    card.append(head, summary, badges, actions);
    fragment.append(card);
  });
  els.cards.append(fragment);
}

function section(title, text) {
  if (!text) return "";
  return `<h3>${escapeHtml(title)}</h3><pre>${escapeHtml(text)}</pre>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openDetail(char) {
  const main = char.isVariant ? variantModel.mainByVariantId.get(char.id) : char;
  const variants = variantModel.variantsByMainId.get(main.id) || [];
  const variantHtml = variants.length
    ? `<h3>派生</h3><div class="variant-list">${variants.map(variant => `
        <article class="variant-item ${variant.id === char.id ? "current" : ""}">
          <div>
            <strong>${escapeHtml(variant.name)}</strong>
            <span>${escapeHtml([variant.promptName, variant.updated && `更新: ${variant.updated}`].filter(Boolean).join(" / "))}</span>
          </div>
          <div class="variant-actions">
            <button class="secondary-button compact" type="button" data-detail-id="${escapeHtml(variant.id)}">詳細</button>
            <a class="primary-link compact" href="${escapeHtml(variant.url)}" target="_blank" rel="noreferrer">開く</a>
          </div>
        </article>
      `).join("")}</div>`
    : "";

  els.detailTitle.textContent = char.name || "(no name)";
  els.detailSub.textContent = [
    char.category,
    char.isVariant && main ? `代表: ${main.name}` : "",
    char.promptName,
    char.updated && `更新: ${char.updated}`
  ].filter(Boolean).join(" / ");
  const statuses = asArray(char.statuses);
  const tags = asArray(char.tags);
  const statusHtml = statuses.length
    ? `<h3>Status</h3><dl>${statuses.map(s => `<dt>${escapeHtml(s.name)}</dt><dd>${escapeHtml(s.value)}</dd>`).join("")}</dl>`
    : "";
  const tagsHtml = tags.length
    ? `<div class="badges detail-tags">${tags.map(tag => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  els.detailBody.innerHTML = `
    ${tagsHtml}
    <p class="detail-summary">${escapeHtml(char.summary || "")}</p>
    ${variantHtml}
    ${statusHtml}
    ${section("プロフィール", char.profile)}
    ${section("スキル", char.skill)}
    ${section("プロンプト", char.prompt)}
    <p class="local-path">${escapeHtml(char.localPath || "")}</p>
    <a class="primary-link wide" href="${escapeHtml(char.url)}" target="_blank" rel="noreferrer">AIバトラーで開く</a>
  `;
  els.detailBody.querySelectorAll("[data-detail-id]").forEach(button => {
    button.addEventListener("click", () => {
      const next = catalog.characters.find(item => item.id === button.dataset.detailId);
      if (next) openDetail(next);
    });
  });
  if (!els.dialog.open) els.dialog.showModal();
}

function bindEvents() {
  els.searchInput.addEventListener("input", event => {
    state.query = event.target.value;
    renderCards();
  });
  els.categorySelect.addEventListener("change", event => {
    state.category = event.target.value;
    renderCards();
  });
  els.tagSelect.addEventListener("change", event => {
    state.tag = event.target.value;
    renderCards();
  });
  els.typeSelect.addEventListener("change", event => {
    state.type = event.target.value;
    renderCards();
  });
  els.variantToggle.addEventListener("change", event => {
    state.showVariants = event.target.checked;
    renderCards();
  });
  els.sortSelect.addEventListener("change", event => {
    state.sort = event.target.value;
    renderCards();
  });
  els.clearButton.addEventListener("click", () => {
    Object.assign(state, { query: "", category: "", tag: "", type: "", showVariants: false, sort: "order" });
    els.searchInput.value = "";
    els.categorySelect.value = "";
    els.tagSelect.value = "";
    els.typeSelect.value = "";
    els.variantToggle.checked = false;
    els.sortSelect.value = "order";
    renderCards();
  });
  els.closeDialog.addEventListener("click", () => els.dialog.close());
}

setupFilters();
bindEvents();
renderCards();
