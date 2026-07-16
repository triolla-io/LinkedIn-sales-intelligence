import{a as L,h as x,i as $,p as U,r as I}from"./api-BmYRdt7d.js";const O="1.3",g="automationWindowId";async function P(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function B(){const e=(await chrome.storage.local.get(g))[g];if(e!==void 0&&await P(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const o=await chrome.windows.create({focused:!1,state:"minimized"});if(!(o!=null&&o.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[g]:o.id}),o.id}async function S(t,e=!0){const o=await B(),n=await chrome.tabs.create({windowId:o,url:t,active:e});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(o,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function q(){const e=(await chrome.storage.local.get(g))[g];e!==void 0&&!await P(e)&&await chrome.storage.local.remove(g)}async function y(t){await new Promise((e,o)=>{chrome.debugger.attach({tabId:t},O,()=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):e()})})}async function k(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function a(t,e,o={}){return await new Promise((n,r)=>{chrome.debugger.sendCommand({tabId:t},e,o,i=>{chrome.runtime.lastError?r(new Error(chrome.runtime.lastError.message)):n(i)})})}async function D(t,e,o){await a(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:o,button:"none",buttons:0}),await E(50),await a(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:o,button:"left",buttons:1,clickCount:1}),await E(50),await a(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:o,button:"left",buttons:0,clickCount:1})}async function V(t){var o;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((o=e==null?void 0:e.result)==null?void 0:o.value)??null}async function F(t,e){var n;const o=await a(t,"Runtime.evaluate",{expression:`(function() {
      function findEl(root) {
        for (const sel of ['div.msg-form__contenteditable[contenteditable]','[role="textbox"][contenteditable]','[contenteditable="true"]']) {
          const el = root.querySelector(sel);
          if (el) { const r = el.getBoundingClientRect(); if (r.width > 50) return el; }
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const f = findEl(el.shadowRoot); if (f) return f; }
      }
      const el = findEl(document);
      if (!el) return false;
      el.focus();
      el.click();
      return true;
    })()`,returnByValue:!0});return(n=o==null?void 0:o.result)!=null&&n.value?(await a(t,"Input.insertText",{text:e}),!0):!1}async function T(t){var o;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
      const countDeep = (sel) => {
        let n = 0;
        const walk = (root) => {
          n += root.querySelectorAll(sel).length;
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
        };
        try { walk(document); } catch (e) {}
        return n;
      };
      return {
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        msgForm: countDeep('div.msg-form__contenteditable[contenteditable]'),
        textbox: countDeep('[role="textbox"][contenteditable]'),
        anyEditable: countDeep('[contenteditable="true"]'),
      };
    })()`,returnByValue:!0});return((o=e==null?void 0:e.result)==null?void 0:o.value)??{diag:"eval_failed"}}async function K(t){var o;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
      function findSend(root) {
        for (const sel of [
          'button.msg-form__send-button',
          'button[type="submit"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="שלח"]',
        ]) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) { el.click(); return true; }
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            if (findSend(el.shadowRoot)) return true;
          }
        }
        return false;
      }
      return findSend(document);
    })()`,returnByValue:!0});return((o=e==null?void 0:e.result)==null?void 0:o.value)===!0}const W='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function _(t){var o;const e=await a(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${W}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((o=e==null?void 0:e.result)==null?void 0:o.value)??[]}function H(t){for(const e of t)if(/^(dismiss|close|cancel)$/i.test(e.aria)||/artdeco-modal__dismiss/i.test(e.cls)||/dismiss/i.test(e.cls)||e.text==="×"||e.text==="✕"||e.text==="✖")return e;return t.find(e=>e.inModal&&e.w<50&&e.h<50)??null}async function Y(t){const e=await _(t),o=H(e);return o?(await D(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0):!1}async function z(t,e){var i;const o=await a(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:n,h:r}=((i=o==null?void 0:o.result)==null?void 0:i.value)??{w:1440,h:900};await a(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(n/2),y:Math.round(r/2),deltaX:0,deltaY:e})}async function X(t){for(let e=0;e<5;e++)await a(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await E(50),await a(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await E(150)}async function M(t){return(await a(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function E(t){return new Promise(e=>setTimeout(e,t))}const J=`(() => {
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('button,[role="button"],a,span')) {
      const t = (el.textContent || '').trim();
      const a = el.getAttribute && el.getAttribute('aria-label') || '';
      all.push((t + ' ' + a).toLowerCase());
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const text = all.join(' || ');
  if (/pending|invitation sent|withdraw invitation|ממתין/.test(text)) return 'pending';
  if (/remove (your )?connection|הסר חיבור|הסרת חיבור/.test(text)) return 'connected';
  return 'connectable';
})()`,j=`(() => {
  const html = document.documentElement.innerHTML;
  const patterns = [
    /urn:li:fsd_company:(\\d+)/,
    /"voyagerCompanyId"\\s*:\\s*(\\d+)/,
    /voyagerCompanyId=(\\d+)/,
    /"companyId"\\s*:\\s*(\\d+)/,
  ];
  let companyId = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { companyId = m[1]; break; }
  }
  const h1 = document.querySelector('h1');
  const og = document.querySelector('meta[property="og:title"]');
  const resolvedName =
    (h1 && h1.textContent && h1.textContent.trim()) ||
    (og && og.getAttribute('content')) ||
    null;
  return { companyId, resolvedName, url: location.href.split('?')[0] };
})()`,G=`(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
  const link = links.find((a) => /linkedin\\.com\\/company\\/[^/?#]+\\/?$/.test(a.href.split('?')[0]));
  if (!link) return null;
  const card = link.closest('li') || link.parentElement;
  const text = (card ? card.textContent : link.textContent) || '';
  const name = text.split('\\n').map((s) => s.trim()).filter(Boolean)[0] || null;
  return { companyUrl: link.href.split('?')[0], name };
})()`;function Z(t){const e=t.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);return e?decodeURIComponent(e[1]).toLowerCase():null}function Q(t){return`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(t)}`}const ee=30,te=60,R="0.4.2";let A=!1;async function C(t){await chrome.storage.local.set({swActiveTabId:t})}async function v(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await q().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await v())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:ee/60}),chrome.alarms.create("hb",{periodInMinutes:te/60})});L().then(t=>{t&&x(R)});chrome.runtime.onMessage.addListener(t=>{(t==null?void 0:t.type)==="heartbeat"&&x(R)});chrome.alarms.onAlarm.addListener(async t=>{if(await L()&&!await $()){if(t.name==="hb"){await x(R);return}if(t.name==="poll"){if(A){console.log("[poll] task already running, skipping");return}for(;await ne(););}}});async function ne(){let t;try{t=await U()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;A=!0;try{const e=await oe(t);await I(t.id,{ok:!0,result:e})}catch(e){const o=e.code??"unknown",n=e.screenshot,r=e.buttons,i=e.diag;await I(t.id,{ok:!1,errorCode:o,errorMessage:e.message,...n||r||i?{result:{debugScreenshot:n,buttons:r,diag:i}}:{}})}finally{A=!1}return!0}async function oe(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw u(new Error("missing_payload"),"bad_payload");return await re(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw u(new Error("missing_payload"),"bad_payload");return await le(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw u(new Error("missing_payload"),"bad_payload");return await ue(e.profileUrl)}if(t.kind==="RESOLVE_COMPANY"){if(!e.linkedinUrl&&!e.name)throw u(new Error("missing_payload"),"bad_payload");return await ce(e.linkedinUrl??null,e.name??null)}throw u(new Error("unknown_kind"),"unsupported_kind")}async function ae(t){var o;const e={};try{const n=await chrome.tabs.get(t);e.tabUrl=n.url??null,e.tabStatus=n.status??null,e.tabTitle=n.title??null,e.windowId=n.windowId??null}catch(n){e.tabGetError=String((n==null?void 0:n.message)??n)}try{if((o=chrome.management)!=null&&o.getAll){const n=await chrome.management.getAll();e.extensions=n.flatMap(r=>r.type==="extension"?[{id:r.id,name:r.name,enabled:r.enabled}]:[])}else e.extensions="management_api_unavailable"}catch(n){e.managementError=String((n==null?void 0:n.message)??n)}return e}async function re(t,e,o=""){const n=await S("about:blank",!1);await C(n);let r=!1,i=null;try{await p(n),await y(n),r=!0,await a(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await a(n,"Page.navigate",{url:t}),await p(n),await h(2500);const m=await chrome.tabs.get(n);if(m.url&&m.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await X(n),await h(500),await Y(n)&&(console.log("[agent] dismissed popup before Message click"),await h(500));const l=await V(n);if(!l)throw u(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",l),await chrome.tabs.update(n,{url:l}),await p(n);let d=await T(n);const s=Date.now()+15e3;for(;Date.now()<s&&d.msgForm===0&&d.anyEditable===0;)await h(500),d=await T(n);console.log("[agent] post-nav diag:",d);const w=await F(n,e);if(console.log("[agent] typeIntoCompose:",w),!w)throw u(new Error(`compose_insert_failed diag=${JSON.stringify(d)}`),"compose_insert_failed");await h(600);const f=await K(n);if(console.log("[agent] clickSendButton:",f),!f)throw u(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(m){i=m;const c=await chrome.tabs.get(n).catch(()=>null);if(c!=null&&c.url&&(i.message=`${i.message} (url=${c.url})`),i.diag=await ae(n).catch(()=>({diagError:!0})),r)try{const[l,d]=await Promise.all([M(n),_(n)]);i.screenshot=l,i.buttons=d}catch{}throw i}finally{r&&await k(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await v()}}const ie=`(() => {
  // Results live in <main> (the "skip to main content" landmark). Prefer it over the
  // aria-label "Primary content", which LinkedIn LOCALIZES (e.g. a Hebrew UI renders a
  // Hebrew aria-label), so the English match finds nothing and the scrape reads zero even
  // though the people are on the page.
  const section = document.querySelector('main')
    || document.querySelector('section[aria-label="Primary content"]');
  if (!section) {
    const b = (document.body && document.body.innerText) || '';
    return { candidates: [], hasNextPage: false, debug: {
      title: document.title, href: location.href, vis: document.visibilityState,
      focus: document.hasFocus(), hasSection: false,
      inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
      bodyLen: b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(b),
      snippet: b.slice(0, 240),
    } };
  }
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  // Lines that are chrome, not profile data: buttons, the "View X's profile" a11y label,
  // the degree-connection caption, mutual-connection / follower counts, presence status.
  const NOISE = /(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\\bfollowers?$|^status is |^• )/i;
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    // derive a stable urn from the profile slug
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    // The whole result card. LinkedIn search results are <li> items; fall back to walking up.
    const card = link.closest('li') || link.parentElement?.parentElement?.parentElement || link.parentElement;
    // Keep the line structure (do NOT collapse newlines). Trim each line, drop blanks, and drop
    // consecutive duplicates (LinkedIn repeats the name for screen readers).
    let lines = (card ? card.innerText : '').split('\\n').map(s => s.replace(/\\s+/g, ' ').trim()).filter(Boolean);
    lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
    // name: first line of the link's own text, minus the degree badge / favourite star / "+N" badge.
    const nameRaw = (link.innerText || '').split('\\n')[0].trim();
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').replace(/\\+\\d+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!name || name.length < 2) continue;
    // degree: first line containing a standalone 1st/2nd/3rd token (e.g. "• 2nd" or "2nd degree connection").
    let degree = null;
    for (const l of lines) {
      const m = l.match(/\\b(1st|2nd|3rd\\+?)\\b/);
      if (m) { degree = m[1].charAt(0) === '3' ? '3rd' : m[1]; break; }
    }
    // content lines = everything that isn't the name or chrome. headline first, location later.
    const content = lines.filter(l =>
      l !== name && l !== nameRaw && !NOISE.test(l) && !/^(1st|2nd|3rd\\+?)$/.test(l)
    );
    const headline = content[0] || null;
    // title + company from "Title at Company" when present; otherwise the whole headline is the title.
    let title = null, company = null;
    if (headline) {
      const at = headline.match(/^(.*?)\\s+at\\s+(.+)$/);
      if (at) { title = at[1].trim(); company = at[2].trim(); } else { title = headline; }
    }
    // location: the first later content line that reads like a place (has a comma, or names Israel).
    let location = null;
    for (let i = 1; i < content.length; i++) {
      const l = content[i];
      if (/,/.test(l) || /israel|ישראל/i.test(l)) { location = l; break; }
    }
    // cardAction: the card's action-button label. "Connect" means sendable now; "Pending" means an
    // invite is already out; "Follow"/"Message" hint the profile may not expose Connect directly.
    let cardAction = null;
    for (const l of lines) {
      const m = l.match(/^(connect|follow|following|pending|message)$/i);
      if (m) { cardAction = m[1].toLowerCase(); break; }
    }
    out.push({ urn, profileUrl, name, headline, title, company, location, degree, cardAction });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  const _b = (document.body && document.body.innerText) || '';
  return { candidates: out, hasNextPage, debug: {
    title: document.title, href: location.href, vis: document.visibilityState,
    focus: document.hasFocus(), hasSection: true, inLinksSection: allLinks.length,
    inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
    bodyLen: _b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(_b),
    snippet: _b.slice(0, 240),
  } };
})()`;async function le(t){var n,r;const e=await S(t).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await C(e);let o=!1;try{await p(e),await h(1500);const i=await chrome.tabs.get(e);if(i.url&&i.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await y(e),o=!0,await a(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await a(e,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await a(e,"Page.enable",{}).catch(()=>{}),await a(e,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{});let m;for(let c=0;c<12;c++){await z(e,1500),await h(1200);const l=await a(e,"Runtime.evaluate",{expression:ie,returnByValue:!0});if(m=(n=l==null?void 0:l.result)==null?void 0:n.value,m&&(m.candidates.length>0||((r=m.debug)==null?void 0:r.noResults)===!0))break}if(!m)throw u(new Error("scrape_returned_null"),"scrape_failed");return m}finally{o&&await k(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await v()}}async function ce(t,e){var i,m,c;const o=t??Q(e??""),n=await S(o).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await C(n);let r=!1;try{await p(n),await h(2500);let l=await chrome.tabs.get(n);if(l.url&&l.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");if(await y(n),r=!0,await a(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),!t){const f=await a(n,"Runtime.evaluate",{expression:G,returnByValue:!0}),b=(m=(i=f==null?void 0:f.result)==null?void 0:i.value)==null?void 0:m.companyUrl;if(!b)throw u(new Error("company_not_found"),"not_found");if(await k(n).catch(()=>{}),r=!1,await chrome.tabs.update(n,{url:b}),await p(n),await h(2500),l=await chrome.tabs.get(n),l.url&&l.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await y(n),r=!0}const d=await a(n,"Runtime.evaluate",{expression:j,returnByValue:!0}),s=(c=d==null?void 0:d.result)==null?void 0:c.value;if(!s||!s.companyId)throw u(new Error("company_id_not_found"),"no_id");const w=s.url??(await chrome.tabs.get(n)).url??o;return{companyId:s.companyId,resolvedName:s.resolvedName??null,slug:Z(w),matchedUrl:w}}finally{r&&await k(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await v()}}async function N(t,e){var n;const o=await a(t,"Runtime.evaluate",{expression:`(() => {
      const slug = ${JSON.stringify(e)};
      const all = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('button, a, [role="button"]')) all.push(el);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      const inSidebar = (el) => {
        let p = el;
        while (p) {
          if (p.tagName === 'ASIDE') return true;
          const cls = typeof p.className === 'string' ? p.className : '';
          if (/similar|browsemap|pymk|discovery/i.test(cls)) return true;
          p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null;
        }
        return false;
      };
      const isConnect = (el) => {
        const t = (el.textContent || '').trim();
        const a = el.getAttribute('aria-label') || '';
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (href.includes('custom-invite')) return !(slug && !href.includes('vanityname=' + slug));
        if (/invite\\b.*\\bto connect/i.test(a) || /^connect$/i.test(a)) return true;
        if (/^(connect|התחבר)$/i.test(t)) return true;
        return false;
      };
      const cands = all.filter(isConnect);
      const slugMatch = cands.find(el => (el.getAttribute('href') || '').toLowerCase().includes('vanityname=' + slug));
      const mainCard = cands.find(el => !inSidebar(el));
      const target = slugMatch || mainCard || cands[0];
      if (target) { target.click(); return true; }
      return false;
    })()`,returnByValue:!0});return((n=o==null?void 0:o.result)==null?void 0:n.value)===!0}async function se(t){var o;const e=await a(t,"Runtime.evaluate",{expression:`(() => {
      let dlg = null;
      const findDlg = (root) => {
        if (dlg) return;
        const m = root.querySelector('[role="dialog"], .artdeco-modal');
        if (m) { dlg = m; return; }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { findDlg(el.shadowRoot); if (dlg) return; }
      };
      findDlg(document);
      const scope = dlg || document;
      const SEND = [/^send\\b/i, /send without/i, /^שלח/, /שלח ללא/];
      const SKIP = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;
      let found = null, primary = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (SEND.some(p => p.test(t) || p.test(a))) { found = el; return; }
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!primary && /artdeco-button--primary/.test(cls) && !SKIP.test(t + ' ' + a)) primary = el;
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      // Only trust the primary-button fallback when we actually located the invite dialog, so we
      // never click a stray primary button elsewhere on the page when no dialog opened.
      const target = found || (dlg ? primary : null);
      if (target) { target.click(); return true; }
      return false;
    })()`,returnByValue:!0});return((o=e==null?void 0:e.result)==null?void 0:o.value)===!0}async function ue(t){var n,r,i;const e=await S("about:blank",!1).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await C(e);let o=!1;try{await p(e),await y(e),o=!0,await a(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await a(e,"Page.navigate",{url:t}),await p(e),await h(4e3);const m=await chrome.tabs.get(e);if(m.url&&m.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");const c=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let l=await N(e,c);if(console.log("[connect] clickConnectInPage:",l),!l){const s=await a(e,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(n=s==null?void 0:s.result)!=null&&n.value&&(await h(800),l=await N(e,c),console.log("[connect] clickConnectInPage after More:",l))}if(!l){const s=await a(e,"Runtime.evaluate",{expression:J,returnByValue:!0}),w=(r=s==null?void 0:s.result)==null?void 0:r.value;if(w==="pending")throw u(new Error("invitation_already_pending"),"already_pending");if(w==="connected")throw u(new Error("already_connected"),"already_connected");const f=await a(e,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(i=f==null?void 0:f.result)!=null&&i.value?u(new Error("follow_only"),"follow_only"):u(new Error("connect_button_not_found"),"no_connect")}let d=!1;for(let s=0;s<6&&(await h(s===0?1500:800),d=await se(e),!d);s++);if(console.log("[connect] clickSendInPage:",d),!d){const s=await _(e);console.log("[connect] afterButtons:",s.map(f=>`"${f.text}" aria="${f.aria}"`));const w=s.flatMap(f=>{const b=(f.text||f.aria||"").trim();return b?[b]:[]}).slice(0,12).join(" | ");throw u(new Error(`send_dialog_not_found; buttons=[${w}]`),"already_or_blocked")}return await h(800),{sentAt:new Date().toISOString()}}catch(m){const c=m,l=await chrome.tabs.get(e).catch(()=>null);if(l!=null&&l.url&&(c.message=`${c.message} (url=${l.url})`),o&&c.code!=="already_pending"&&c.code!=="already_connected"&&c.code!=="checkpoint")try{const[d,s]=await Promise.all([M(e),_(e)]);c.screenshot=d,c.buttons=s}catch{}throw c}finally{o&&await k(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await v()}}async function p(t){const e=await chrome.tabs.get(t).catch(()=>null);(e==null?void 0:e.status)!=="complete"&&await new Promise((o,n)=>{let r=!1;const i=d=>{r||(r=!0,clearTimeout(m),clearInterval(l),chrome.tabs.onUpdated.removeListener(c),d())},m=setTimeout(()=>i(()=>n(u(new Error("tab_load_timeout"),"tab_load"))),3e4),c=(d,s)=>{d===t&&s.status==="complete"&&i(o)};chrome.tabs.onUpdated.addListener(c);const l=setInterval(async()=>{const d=await chrome.tabs.get(t).catch(()=>null);if(!d)return i(()=>n(u(new Error("tab_closed"),"tab_load")));d.status==="complete"&&i(o)},1e3)})}function h(t){return new Promise(e=>setTimeout(e,t))}function u(t,e){return t.code=e,t}
