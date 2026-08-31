(function() {
  "use strict";
  const MODAL_CONTAINER_SEL = '[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';
  const NEVER_CLICK_SEL = 'a[href],.global-nav,header,nav,[role="banner"],[role="navigation"]';
  function scanButtons() {
    return collectButtons().map((b) => b.meta);
  }
  function pickCloseButton(buttons) {
    const inModal = buttons.filter((b) => b.inModal);
    for (const btn of inModal) {
      const isClose = /^(dismiss|close|cancel)$/i.test(btn.aria) || /artdeco-modal__dismiss/i.test(btn.cls) || /dismiss/i.test(btn.cls) || btn.text === "×" || btn.text === "✕" || btn.text === "✖";
      if (isClose) return btn;
    }
    return inModal.find((b) => b.w < 50 && b.h < 50) ?? null;
  }
  function clickModalClose() {
    const collected = collectButtons();
    const target = pickCloseButton(collected.map((c) => c.meta));
    if (!target) return false;
    const hit = collected.find((c) => c.meta === target);
    if (!hit) return false;
    hit.el.click();
    return true;
  }
  function collectButtons(root = document) {
    var _a;
    const out = [];
    for (const node of Array.from(root.querySelectorAll("*"))) {
      const shadow = node.shadowRoot;
      if (shadow) out.push(...collectButtons(shadow));
    }
    for (const node of Array.from(root.querySelectorAll('button,[role="button"]'))) {
      const el = node;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.top >= 800) continue;
      if (el.closest(NEVER_CLICK_SEL)) continue;
      out.push({
        el,
        meta: {
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
          aria: el.getAttribute("aria-label") ?? "",
          text: ((_a = el.textContent) == null ? void 0 : _a.trim().slice(0, 30)) ?? "",
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          inModal: !!el.closest(MODAL_CONTAINER_SEL)
        }
      });
    }
    return out;
  }
  function tryExec$1(command, value) {
    var _a;
    try {
      return ((_a = document.execCommand) == null ? void 0 : _a.call(document, command, false, value)) ?? false;
    } catch {
      return false;
    }
  }
  const EDITABLE_SELECTORS = [
    "div.msg-form__contenteditable[contenteditable]",
    '[role="textbox"][contenteditable]',
    '[contenteditable="true"]'
  ];
  const SEND_SELECTORS = [
    "button.msg-form__send-button",
    'button[type="submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="שלח"]'
  ];
  const UNAMBIGUOUS_SEND_SELECTORS = [
    "button.msg-form__send-button",
    'button[aria-label*="Send"]',
    'button[aria-label*="שלח"]'
  ];
  function queryDeep$1(selector, root = document) {
    const found = Array.from(root.querySelectorAll(selector));
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = el.shadowRoot;
      if (shadow) found.push(...queryDeep$1(selector, shadow));
    }
    return found;
  }
  function countDeep(selector) {
    try {
      return queryDeep$1(selector).length;
    } catch {
      return 0;
    }
  }
  function findComposeBox() {
    for (const sel of EDITABLE_SELECTORS) {
      const matches = queryDeep$1(sel);
      const laidOut = matches.find((el) => el.getBoundingClientRect().width > 50);
      if (laidOut) return laidOut;
      if (matches.length > 0) return matches[0];
    }
    return null;
  }
  function boxText$1(el) {
    return (el.innerText ?? el.textContent ?? "").trim();
  }
  function focusAtEnd$1(el) {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function getComposeUrl() {
    const anchors = queryDeep$1('a[href*="/messaging/compose/"]');
    if (anchors.length === 0) return null;
    const visible = anchors.find((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
    return (visible ?? anchors[0]).href || null;
  }
  function composeDiag() {
    return {
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      msgForm: countDeep("div.msg-form__contenteditable[contenteditable]"),
      textbox: countDeep('[role="textbox"][contenteditable]'),
      anyEditable: countDeep('[contenteditable="true"]')
    };
  }
  function typeIntoCompose(text) {
    const el = findComposeBox();
    if (!el) return { ok: false, length: 0 };
    focusAtEnd$1(el);
    tryExec$1("insertText", text);
    if (!boxText$1(el).includes(text.trim().slice(0, 24))) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      );
    }
    const landed = boxText$1(el);
    return { ok: landed.includes(text.trim().slice(0, 24)), length: landed.length };
  }
  function clearDraft() {
    let cleared = 0;
    for (const sel of EDITABLE_SELECTORS) {
      for (const el of queryDeep$1(sel)) {
        if (boxText$1(el) === "") continue;
        el.focus();
        tryExec$1("selectAll");
        tryExec$1("delete");
        if (boxText$1(el) !== "") {
          el.textContent = "";
          el.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
          );
        }
        cleared++;
      }
    }
    return { cleared };
  }
  async function clickSend() {
    const target = SEND_SELECTORS.flatMap((sel) => queryDeep$1(sel)).find(
      (el) => el.getBoundingClientRect().width > 0
    ) ?? UNAMBIGUOUS_SEND_SELECTORS.flatMap((sel) => queryDeep$1(sel))[0];
    if (!target) return { clicked: false, emptied: false };
    target.click();
    const clicked = true;
    const box = findComposeBox();
    if (!box) return { clicked, emptied: true };
    for (let i = 0; i < 10; i++) {
      if (boxText$1(box) === "") return { clicked, emptied: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { clicked, emptied: boxText$1(box) === "" };
  }
  async function closeOverlays() {
    for (let i = 0; i < 5; i++) {
      for (const type of ["keydown", "keyup"]) {
        document.dispatchEvent(
          new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })
        );
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  function queryDeep(selector, root = document) {
    const found = Array.from(root.querySelectorAll(selector));
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = el.shadowRoot;
      if (shadow) found.push(...queryDeep(selector, shadow));
    }
    return found;
  }
  function tryExec(command, value) {
    var _a;
    try {
      return ((_a = document.execCommand) == null ? void 0 : _a.call(document, command, false, value)) ?? false;
    } catch {
      return false;
    }
  }
  const EDITOR_SELECTOR = [
    ".comments-comment-box .ql-editor",
    ".comments-comment-texteditor .ql-editor",
    '.comments-comment-box [contenteditable="true"][role="textbox"]'
  ].join(", ");
  function findEditor() {
    return queryDeep(EDITOR_SELECTOR)[0] ?? null;
  }
  function isCommentLabel(label) {
    const t = label.trim();
    if (!t) return false;
    if (/^\d/.test(t)) return false;
    if (t === "תגובה" || t.startsWith("תגובה ")) return true;
    if (/^comment(\s|$)/i.test(t)) return true;
    return false;
  }
  function findCommentButton() {
    const withAriaLabel = queryDeep("button[aria-label]").filter(
      (btn) => isCommentLabel(btn.getAttribute("aria-label") ?? "")
    );
    if (withAriaLabel.length > 0) return withAriaLabel[0];
    return queryDeep("button").find((btn) => isCommentLabel(btn.textContent ?? "")) ?? null;
  }
  function commentDiag() {
    const editor = findEditor();
    const commentButtonFound = editor ? false : findCommentButton() !== null;
    return {
      editorFound: editor !== null,
      commentButtonFound,
      href: location.href,
      readyState: document.readyState
    };
  }
  function revealCommentBox() {
    const button = findCommentButton();
    if (!button) return { clicked: false };
    button.click();
    return { clicked: true };
  }
  function boxText(el) {
    return (el.innerText ?? el.textContent ?? "").trim();
  }
  function focusAtEnd(el) {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function typeIntoComment(text) {
    const el = findEditor();
    if (!el) return { ok: false, length: 0 };
    focusAtEnd(el);
    tryExec("insertText", text);
    if (!boxText(el).includes(text.trim().slice(0, 24))) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      );
    }
    const landed = boxText(el);
    return { ok: landed.includes(text.trim().slice(0, 24)), length: landed.length };
  }
  function allActionables(root = document) {
    const out = Array.from(
      root.querySelectorAll('button, a, [role="button"]')
    );
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = el.shadowRoot;
      if (shadow) out.push(...allActionables(shadow));
    }
    return out;
  }
  function inSidebar(el) {
    var _a;
    let p = el;
    while (p) {
      if (p.tagName === "ASIDE") return true;
      const cls = typeof p.className === "string" ? p.className : "";
      if (/similar|browsemap|pymk|discovery/i.test(cls)) return true;
      const root = (_a = p.getRootNode) == null ? void 0 : _a.call(p);
      p = p.parentElement ?? (root == null ? void 0 : root.host) ?? null;
    }
    return false;
  }
  function clickConnect(slug) {
    const isConnect = (el) => {
      const t = (el.textContent ?? "").trim();
      const a = el.getAttribute("aria-label") ?? "";
      const href = (el.getAttribute("href") ?? "").toLowerCase();
      if (href.includes("custom-invite")) return !(slug && !href.includes(`vanityname=${slug}`));
      if (/invite\b.*\bto connect/i.test(a) || /^connect$/i.test(a)) return true;
      if (/^(connect|התחבר)$/i.test(t)) return true;
      return false;
    };
    const cands = allActionables().filter(isConnect);
    const slugMatch = cands.find(
      (el) => (el.getAttribute("href") ?? "").toLowerCase().includes(`vanityname=${slug}`)
    );
    const mainCard = cands.find((el) => !inSidebar(el));
    const target = slugMatch ?? mainCard ?? cands[0];
    if (!target) return false;
    target.click();
    return true;
  }
  function clickMore() {
    const more = allActionables().find(
      (el) => /^more$/i.test((el.textContent ?? "").trim()) || /^more actions$/i.test(el.getAttribute("aria-label") ?? "")
    );
    if (!more) return false;
    more.click();
    return true;
  }
  const SEND_PATTERNS = [/^send\b/i, /send without/i, /^שלח/, /שלח ללא/];
  const SKIP_PATTERN = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;
  const INVITE_COPY = /invitation|invite|הזמנה/i;
  function clickInviteSend() {
    const dialogs = allDialogs();
    const isSend = (el) => {
      const t = (el.textContent ?? "").trim();
      const a = el.getAttribute("aria-label") ?? "";
      return SEND_PATTERNS.some((p) => p.test(t) || p.test(a));
    };
    const isUnskippedPrimary = (el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      const label = `${(el.textContent ?? "").trim()} ${el.getAttribute("aria-label") ?? ""}`;
      return /artdeco-button--primary/.test(cls) && !SKIP_PATTERN.test(label);
    };
    for (const dialog of dialogs) {
      const send = allActionables(dialog).find(isSend);
      if (send) {
        send.click();
        return true;
      }
    }
    for (const dialog of dialogs) {
      if (!INVITE_COPY.test(dialog.textContent ?? "")) continue;
      const primary = allActionables(dialog).find(isUnskippedPrimary);
      if (primary) {
        primary.click();
        return true;
      }
    }
    return false;
  }
  function allDialogs(root = document) {
    const out = Array.from(
      root.querySelectorAll('[role="dialog"], .artdeco-modal')
    );
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = el.shadowRoot;
      if (shadow) out.push(...allDialogs(shadow));
    }
    return out;
  }
  function isFollowOnly() {
    const actionables = allActionables();
    const hasFollow = actionables.some(
      (el) => /^follow$/i.test((el.textContent ?? "").trim()) || /^follow\b/i.test(el.getAttribute("aria-label") ?? "")
    );
    const hasConnect = actionables.some(
      (el) => /^connect$/i.test((el.textContent ?? "").trim()) || /\bto connect$/i.test(el.getAttribute("aria-label") ?? "")
    );
    return hasFollow && !hasConnect;
  }
  function detectProfileState() {
    const labels = [];
    const walk = (root) => {
      var _a;
      for (const node of Array.from(root.querySelectorAll('button,[role="button"],a,span'))) {
        const el = node;
        const text2 = (el.textContent ?? "").trim();
        const aria = ((_a = el.getAttribute) == null ? void 0 : _a.call(el, "aria-label")) ?? "";
        labels.push(`${text2} ${aria}`.toLowerCase());
      }
      for (const node of Array.from(root.querySelectorAll("*"))) {
        const shadow = node.shadowRoot;
        if (shadow) walk(shadow);
      }
    };
    walk(document);
    const text = labels.join(" || ");
    if (/pending|invitation sent|withdraw invitation|ממתין/.test(text)) return "pending";
    if (/remove (your )?connection|הסר חיבור|הסרת חיבור/.test(text)) return "connected";
    return "connectable";
  }
  function extractCompany() {
    const html = document.documentElement.innerHTML;
    const patterns = [
      /urn:li:fsd_company:(\d+)/,
      /"voyagerCompanyId"\s*:\s*(\d+)/,
      /voyagerCompanyId=(\d+)/,
      /"companyId"\s*:\s*(\d+)/
    ];
    let companyId = null;
    for (const p of patterns) {
      const m = html.match(p);
      if (m) {
        companyId = m[1];
        break;
      }
    }
    const h1 = document.querySelector("h1");
    const og = document.querySelector('meta[property="og:title"]');
    const resolvedName = h1 && h1.textContent && h1.textContent.trim() || (og == null ? void 0 : og.getAttribute("content")) || null;
    return { companyId, resolvedName, url: location.href.split("?")[0] };
  }
  function topCompanyResults() {
    const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const a of links) {
      const url = a.href.split("?")[0];
      if (!/linkedin\.com\/company\/[^/?#]+\/?$/.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const card = a.closest("li") ?? a.parentElement;
      const text = (card ? card.textContent : a.textContent) ?? "";
      const name = text.split("\n").map((s) => s.trim()).filter(Boolean)[0] || null;
      out.push({ companyUrl: url, name });
      if (out.length >= 5) break;
    }
    return out;
  }
  const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;
  const clean = (s) => (s || "").replace(BIDI_MARKS, "").replace(/\s+/g, " ").trim();
  const ABOUT_HEADERS = ["about", "אודות"];
  const EXPERIENCE_HEADERS = ["experience", "ניסיון"];
  const SKILLS_HEADERS = ["skills", "כישורים", "מיומנויות"];
  const EDUCATION_HEADERS = ["education", "השכלה"];
  function findSection(headers) {
    for (const section of Array.from(document.querySelectorAll("section"))) {
      const h2 = section.querySelector("h2");
      if (h2 && headers.includes(clean(h2.textContent).toLowerCase())) {
        return section;
      }
    }
    return null;
  }
  function readProfileAbout() {
    var _a;
    const section = findSection(ABOUT_HEADERS);
    if (!section) return null;
    const paragraphs = Array.from(section.querySelectorAll("p")).map((p) => clean(p.textContent)).filter(Boolean);
    let text = paragraphs.length ? paragraphs.reduce((a, b) => b.length > a.length ? b : a) : "";
    if (!text) {
      const h2Text = clean((_a = section.querySelector("h2")) == null ? void 0 : _a.textContent);
      text = clean(section.textContent).replace(h2Text, "").trim();
    }
    return text ? text.slice(0, 2e3) : null;
  }
  function leafLines(root) {
    const lines = [];
    const seen = /* @__PURE__ */ new Set();
    const walk = (el) => {
      const children = Array.from(el.children);
      if (children.length) {
        for (const child of children) walk(child);
        return;
      }
      const text = clean(el.textContent);
      if (!text || seen.has(text)) return;
      seen.add(text);
      lines.push({ text, bold: !!el.closest("h3, strong, b") });
    };
    walk(root);
    return lines;
  }
  const EMPLOYMENT_SUFFIX = /\s*[·•]\s*(Full-time|Part-time|Contract|Internship|Freelance|Self[- ]employed|Seasonal|Temporary|משרה מלאה|משרה חלקית|חוזה|פרילנס)\b.*$/i;
  function entryDescription(li, title) {
    const paragraphs = Array.from(li.querySelectorAll("p")).map((p) => clean(p.textContent)).filter((t) => t && t !== title && !/\d{4}/.test(t.slice(0, 24)));
    if (!paragraphs.length) return null;
    const best = paragraphs.reduce((a, b) => b.length > a.length ? b : a);
    return best ? best.slice(0, 1500) : null;
  }
  function readProfileExperience() {
    var _a, _b, _c;
    const section = findSection(EXPERIENCE_HEADERS);
    if (!section) return [];
    const results = [];
    for (const li of Array.from(section.querySelectorAll("li"))) {
      if ((_a = li.parentElement) == null ? void 0 : _a.closest("li")) continue;
      const lines = leafLines(li);
      if (!lines.length) continue;
      const titleIdx = lines.findIndex((l) => l.bold);
      const title = (_b = titleIdx >= 0 ? lines[titleIdx] : lines[0]) == null ? void 0 : _b.text;
      if (!title) continue;
      const after = lines.slice((titleIdx >= 0 ? titleIdx : 0) + 1);
      const rawCompany = ((_c = after.find((l) => !/\d{4}/.test(l.text))) == null ? void 0 : _c.text) ?? null;
      const company = rawCompany ? rawCompany.replace(EMPLOYMENT_SUFFIX, "").trim() || null : null;
      const dateLine = lines.find((l) => /\d{4}/.test(l.text)) ?? null;
      results.push({
        title,
        company,
        dateRange: (dateLine == null ? void 0 : dateLine.text) ?? null,
        description: entryDescription(li, title)
      });
      if (results.length >= 5) break;
    }
    return results;
  }
  function readProfileSkills() {
    var _a, _b;
    const section = findSection(SKILLS_HEADERS);
    if (!section) return [];
    const skills = [];
    const seen = /* @__PURE__ */ new Set();
    for (const li of Array.from(section.querySelectorAll("li"))) {
      if ((_a = li.parentElement) == null ? void 0 : _a.closest("li")) continue;
      const name = (_b = leafLines(li)[0]) == null ? void 0 : _b.text;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      skills.push(name);
      if (skills.length >= 30) break;
    }
    return skills;
  }
  function readProfileEducation() {
    var _a;
    const section = findSection(EDUCATION_HEADERS);
    if (!section) return [];
    const rows = [];
    for (const li of Array.from(section.querySelectorAll("li"))) {
      if ((_a = li.parentElement) == null ? void 0 : _a.closest("li")) continue;
      const lines = leafLines(li);
      if (!lines.length) continue;
      const school = (lines.find((l) => l.bold) ?? lines[0]).text;
      const degreeLine = lines.map((l) => l.text).find((t) => t !== school) ?? null;
      const [degree, ...rest] = (degreeLine ?? "").split(",").map((s) => s.trim());
      rows.push({ school, degree: degree || null, field: rest.join(", ") || null });
      if (rows.length >= 5) break;
    }
    return rows;
  }
  async function readProfileProgressively(deps = {}) {
    const scrollBy = deps.scrollBy ?? ((dy) => window.scrollBy(0, dy));
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const maxScrolls = deps.maxScrolls ?? 8;
    const stepPx = deps.stepPx ?? 1200;
    const settleMs = deps.settleMs ?? 700;
    let about = null;
    let experience = [];
    let education = [];
    let skills = [];
    const capture = () => {
      if (about === null) about = readProfileAbout();
      if (experience.length === 0) experience = readProfileExperience();
      if (education.length === 0) education = readProfileEducation();
      if (skills.length === 0) skills = readProfileSkills();
    };
    capture();
    let scrolls = 0;
    while ((experience.length === 0 || education.length === 0) && scrolls < maxScrolls) {
      scrollBy(stepPx);
      scrolls += 1;
      await sleep(settleMs);
      capture();
    }
    return {
      about,
      experience,
      education,
      skills,
      scrolls,
      // Which halves were ever seen at all — the difference between "published nothing" and
      // "we never managed to read it", the distinction that took three runs to get right.
      revealed: { experience: experience.length > 0, education: education.length > 0 },
      viewport: { w: window.innerWidth, h: window.innerHeight }
    };
  }
  function readProfileTopcard() {
    var _a;
    const titleName = clean((document.title || "").split("|")[0]);
    let company = null;
    const compIcon = document.querySelector('svg[id^="company-accent"]');
    if (compIcon) {
      const container = (_a = compIcon.closest("figure")) == null ? void 0 : _a.parentElement;
      if (container) {
        const t = clean(container.innerText);
        if (t) company = t.split("\n")[0];
      }
    }
    let topcard = null;
    for (const section of Array.from(document.querySelectorAll("section"))) {
      const h2 = section.querySelector("h2");
      if (h2 && titleName && clean(h2.textContent) === titleName) {
        topcard = section;
        break;
      }
    }
    let headline = null;
    if (topcard) {
      const ps = Array.from(topcard.querySelectorAll("p")).map((p) => clean(p.textContent)).filter(Boolean).filter(
        (t) => t !== titleName && !t.startsWith("·") && // "· 1st" / "· 2nd" degree markers
        !/^[0-9,]+\+?$/.test(t) && // "500+" connection count
        !/connections?$/i.test(t) && !/contact info/i.test(t)
      );
      if (ps.length) headline = ps[0];
      if (!company && ps.length > 1) company = ps[1];
    }
    const entries = headline || company ? [{ title: headline, company, current: true, startDate: "9999-99" }] : [];
    return { entries, headline };
  }
  const URN_RE = /urn:li:activity:(\d+)/;
  function deepQueryAll(selector, root = document) {
    const found = Array.from(root.querySelectorAll(selector));
    const hosts = root.querySelectorAll("*");
    for (const el of Array.from(hosts)) {
      const shadow = el.shadowRoot;
      if (shadow) found.push(...deepQueryAll(selector, shadow));
    }
    return found;
  }
  const TEXT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-inline-show-more-text",
    '[class*="update-components-text"]'
  ].join(", ");
  const TIME_SELECTORS = [
    ".update-components-actor__sub-description",
    "time"
  ].join(", ");
  function readRecentPosts(limit) {
    var _a, _b, _c, _d;
    const matches = deepQueryAll('[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"]');
    const containers = matches.filter(
      (el) => !matches.some((other) => other !== el && other.contains(el))
    );
    const seen = /* @__PURE__ */ new Set();
    const posts = [];
    for (const el of containers) {
      const rawUrn = el.getAttribute("data-urn") ?? el.getAttribute("data-id") ?? "";
      const m = URN_RE.exec(rawUrn);
      if (!m) continue;
      const urn = `urn:li:activity:${m[1]}`;
      if (seen.has(urn)) continue;
      const text = ((_b = (_a = el.querySelector(TEXT_SELECTORS)) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim()) ?? "";
      if (!text) continue;
      const postedAgoText = ((_d = (_c = el.querySelector(TIME_SELECTORS)) == null ? void 0 : _c.textContent) == null ? void 0 : _d.trim().replace(/\s+/g, " ")) || null;
      seen.add(urn);
      posts.push({ urn, text, postedAgoText });
      if (posts.length >= limit) break;
    }
    return { posts };
  }
  function parseCardFields(nameRaw, rawLines) {
    const stripBidi = (s) => (s || "").replace(/[‎‏‪-‮⁦-⁩]/g, "");
    const norm = rawLines.map((s) => stripBidi(s).replace(/\s+/g, " ").trim()).filter(Boolean);
    const lines = norm.filter((l, i) => i === 0 || l !== norm[i - 1]);
    const name = stripBidi(nameRaw).split("•")[0].replace(/\s*★.*/, "").replace(/\+\d+/g, " ").replace(/\s+/g, " ").trim();
    if (!name || name.length < 2) return null;
    const nameRawNorm = stripBidi(nameRaw).replace(/\s+/g, " ").trim();
    let degree = null;
    for (const l of lines) {
      const en = l.match(/\b(1st|2nd|3rd\+?)\b/);
      if (en) {
        degree = en[1].charAt(0) === "3" ? "3rd" : en[1];
        break;
      }
      const he = l.match(/•\s*(ראשון|שני|שלישי)/);
      if (he) {
        degree = he[1] === "ראשון" ? "1st" : he[1] === "שני" ? "2nd" : "3rd";
        break;
      }
    }
    let cardAction = null;
    for (const l of lines) {
      const en = l.match(/^(connect|follow|following|pending|message)$/i);
      if (en) {
        cardAction = en[1].toLowerCase();
        break;
      }
      if (/^(התחבר|להתחבר|התחברות)$/.test(l)) {
        cardAction = "connect";
        break;
      }
      if (/^עוקב$/.test(l)) {
        cardAction = "following";
        break;
      }
      if (/^(עקוב|מעקב|לעקוב)$/.test(l)) {
        cardAction = "follow";
        break;
      }
      if (/^(ממתין|בהמתנה)$/.test(l)) {
        cardAction = "pending";
        break;
      }
      if (/הודעה/.test(l)) {
        cardAction = "message";
        break;
      }
    }
    const NOISE = /(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\bfollowers?$|^status is |^• )/i;
    const content = lines.filter(
      (l) => l !== name && l !== nameRawNorm && !NOISE.test(l) && !/^(1st|2nd|3rd\+?)$/.test(l) && !/^(התחבר|להתחבר|התחברות|עוקב|עקוב|מעקב|לעקוב|ממתין|בהמתנה|הודעה|שליחת הודעה)$/.test(l)
    );
    const headline = content[0] || null;
    let title = null;
    let company = null;
    if (headline) {
      const at = headline.match(/^(.*?)\s+at\s+(.+)$/);
      if (at) {
        title = at[1].trim();
        company = at[2].trim();
      } else {
        title = headline;
      }
    }
    let location2 = null;
    for (let i = 1; i < content.length; i++) {
      const l = content[i];
      if (/,/.test(l) || /israel|ישראל/i.test(l)) {
        location2 = l;
        break;
      }
    }
    if (!headline && !degree && !cardAction) return null;
    return { name, headline, title, company, location: location2, degree, cardAction };
  }
  function scrapeSearchPage() {
    var _a, _b, _c;
    const bodyText = ((_a = document.body) == null ? void 0 : _a.innerText) ?? "";
    const baseDebug = {
      title: document.title,
      href: location.href,
      vis: document.visibilityState,
      focus: document.hasFocus(),
      inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
      bodyLen: bodyText.length,
      noResults: /no results found|לא נמצאו תוצאות/i.test(bodyText),
      snippet: bodyText.slice(0, 240)
    };
    const section = document.querySelector("main") ?? document.querySelector('section[aria-label="Primary content"]');
    if (!section) {
      return { candidates: [], hasNextPage: false, debug: { ...baseDebug, hasSection: false } };
    }
    const allLinks = Array.from(
      section.querySelectorAll('a[href*="/in/"]')
    );
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const link of allLinks) {
      const profileUrl = link.href.split("?")[0];
      if (seen.has(profileUrl) || !/linkedin\.com\/in\/[^/]+\/?$/.test(profileUrl)) continue;
      seen.add(profileUrl);
      const slug = profileUrl.replace(/\/$/, "").split("/in/")[1] || "";
      const urn = `urn:li:member:${slug}`;
      const card = link.closest("li") ?? ((_c = (_b = link.parentElement) == null ? void 0 : _b.parentElement) == null ? void 0 : _c.parentElement) ?? link.parentElement;
      const nameRaw = (link.innerText || "").split("\n")[0];
      const rawLines = ((card == null ? void 0 : card.innerText) ?? "").split("\n");
      const fields = parseCardFields(nameRaw, rawLines);
      if (!fields) continue;
      out.push({ urn, profileUrl, ...fields });
    }
    const next = Array.from(document.querySelectorAll("button")).find(
      (b) => b.innerText.trim() === "Next" || b.innerText.trim() === "הבא"
    );
    const hasNextPage = !!next && !next.disabled;
    return {
      candidates: out,
      hasNextPage,
      debug: { ...baseDebug, hasSection: true, inLinksSection: allLinks.length }
    };
  }
  const GUARD = "__triollaContentScriptReady";
  const scope = globalThis;
  if (!scope[GUARD]) {
    scope[GUARD] = true;
    registerListener();
  }
  function registerListener() {
    chrome.runtime.onMessage.addListener(
      (msg, _sender, sendResponse) => {
        handle(msg).then(
          (result) => sendResponse({ ok: true, result }),
          (err) => sendResponse({
            ok: false,
            errorCode: (err == null ? void 0 : err.code) ?? "page_error",
            errorMessage: String((err == null ? void 0 : err.message) ?? err)
          })
        );
        return true;
      }
    );
  }
  async function handle(msg) {
    var _a;
    switch (msg.kind) {
      case "PING":
        return true;
      case "SCRAPE_SEARCH":
        return scrapeSearchPage();
      case "READ_PROFILE_TOPCARD":
        return readProfileTopcard();
      case "READ_PROFILE_FULL": {
        const scrolled = await readProfileProgressively();
        window.scrollTo(0, 0);
        const { entries, headline } = readProfileTopcard();
        return {
          headline,
          company: ((_a = entries[0]) == null ? void 0 : _a.company) ?? null,
          about: scrolled.about,
          experience: scrolled.experience,
          skills: scrolled.skills,
          education: scrolled.education,
          // Reported so an empty read is diagnosable instead of looking exactly like a person
          // with an empty profile — the indistinguishability that hid this for weeks, and
          // that caught two wrong fixes of my own before this one.
          revealed: {
            scrolls: scrolled.scrolls,
            found: scrolled.revealed.experience || scrolled.revealed.education,
            experience: scrolled.revealed.experience,
            education: scrolled.revealed.education,
            viewport: scrolled.viewport
          }
        };
      }
      case "EXTRACT_COMPANY":
        return extractCompany();
      case "TOP_COMPANY_RESULTS":
        return topCompanyResults();
      case "PROFILE_STATE":
        return detectProfileState();
      case "COMPOSE_URL":
        return getComposeUrl();
      case "COMPOSE_DIAG":
        return composeDiag();
      case "TYPE_INTO_COMPOSE":
        return typeIntoCompose(msg.text);
      case "CLEAR_DRAFT":
        return clearDraft();
      case "CLICK_SEND":
        return await clickSend();
      case "CLICK_CONNECT":
        return clickConnect(msg.slug);
      case "CLICK_MORE":
        return clickMore();
      case "CLICK_INVITE_SEND":
        return clickInviteSend();
      case "IS_FOLLOW_ONLY":
        return isFollowOnly();
      case "SCAN_BUTTONS":
        return scanButtons();
      case "CLICK_MODAL_CLOSE":
        return clickModalClose();
      case "CLOSE_OVERLAYS":
        return await closeOverlays();
      case "SCROLL_BY":
        window.scrollBy(0, msg.dy);
        return void 0;
      case "READ_RECENT_POSTS":
        return readRecentPosts(msg.limit);
      case "COMMENT_DIAG":
        return commentDiag();
      case "REVEAL_COMMENT_BOX":
        return revealCommentBox();
      case "TYPE_INTO_COMMENT":
        return typeIntoComment(msg.text);
      default: {
        const unknown = msg;
        throw withCode(new Error(`unknown_kind: ${JSON.stringify(unknown)}`), "unknown_kind");
      }
    }
  }
  function withCode(err, code) {
    err.code = code;
    return err;
  }
})();
