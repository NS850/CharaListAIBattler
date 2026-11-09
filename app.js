const catalog = window.CHARACTER_CATALOG || { characters: []};

const els = {
resultCount: document.querySelector("#resultCount"),
cards: document.querySelector("#cards"),
dialog: document.querySelector("#detailDialog"),
detailTitle: document.querySelector("#detailTitle"),
detailSub: document.querySelector("#detailSub"),
detailBody: document.querySelector("#detailBody"),
closeDialog: document.querySelector("#closeDialog")
};

const variantModel = buildVariantModel(catalog.characters);

function buildVariantModel(characters) {
const byName = new Map();
const variantsByMainId = new Map();
const mainByVariantId = new Map();

characters.forEach(char => {
if (char.name &&!byName.has(char.name)) byName.set(char.name, char);
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
char.mainId = char.isVariant? mainByVariantId.get(char.id).id: char.id;
});

return { variantsByMainId, mainByVariantId};
}

function asArray(value) {
if (!value) return [];
return Array.isArray(value)? value: [value];
}

// 一覧に出るのは公開分のみ。非表示キャラは単独では出ず、
// 基準キャラの派生として詳細からだけ選べる。
function listedCharacters() {
return catalog.characters
.filter(char =>!char.isHidden)
.sort((a, b) =>
String(a.category || "").localeCompare(String(b.category || ""), "ja") ||
Number(a.displayOrder || 999999) - Number(b.displayOrder || 999999) ||
String(a.name || "").localeCompare(String(b.name || ""), "ja")
);
}

const GROUP_ORDER = ["ペンギン", "ハーピィ", "兎"];

function createCard(char) {
  const card = document.createElement("article");
  card.className = "card";
  card.title = "AIバトラーで開く";
  card.addEventListener("click", () => window.open(char.url, "_blank", "noreferrer"));
  const title = document.createElement("h2");
  title.textContent = char.name || "(no name)";
  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "secondary-button compact";
  detail.textContent = "詳細";
  detail.addEventListener("click", event => {
    event.stopPropagation();
    openDetail(char);
  });
  card.append(title, detail);
  return card;
}

function renderCards() {
  const chars = listedCharacters();
  els.resultCount.textContent = `${chars.length}件`;
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
    label.textContent = groupName;
    const icon = document.createElement("span");
    icon.className = "group-toggle-icon";
    icon.textContent = "▼";
    toggle.append(label, icon);
    toggle.addEventListener("click", () => {
      const open = section.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    const grid = document.createElement("div");
    grid.className = "cards group-body";
    members.forEach(char => grid.append(createCard(char)));
    section.append(toggle, grid);
    fragment.append(section);
  });
  const rest = chars.filter(char => !groupedIds.has(char.id));
  if (rest.length) {
    const grid = document.createElement("div");
    grid.className = "cards rest";
    rest.forEach(char => grid.append(createCard(char)));
    fragment.append(grid);
  }
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
const main = char.isVariant? variantModel.mainByVariantId.get(char.id): char;
const variants = variantModel.variantsByMainId.get(main.id) || [];
const variantHtml = variants.length
? `<h3>派生</h3><div class="variant-list">${variants.map(variant => `
<article class="variant-item ${variant.id === char.id? "current": ""}">
<div>
<strong>${escapeHtml(variant.name)}</strong>
<span>${escapeHtml([variant.isHidden && "非表示", variant.promptName, variant.updated && `更新: ${variant.updated}`].filter(Boolean).join(" / "))}</span>
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
char.isVariant && main? `代表: ${main.name}`: "",
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
els.closeDialog.addEventListener("click", () => els.dialog.close());
}

bindEvents();
renderCards();
