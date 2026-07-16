import{a as M,h as x,i as U,p as O,r as I}from"./api-BmYRdt7d.js";const B="1.3",g="automationWindowId";async function $(e){try{return await chrome.windows.get(e),!0}catch{return!1}}async function L(){const t=(await chrome.storage.local.get(g))[g];if(t!==void 0&&await $(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const a=await chrome.windows.create({focused:!1,state:"minimized"});if(!(a!=null&&a.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[g]:a.id}),a.id}async function S(e,t=!0){const a=await L(),n=await chrome.tabs.create({windowId:a,url:e,active:t});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(a,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function D(){const t=(await chrome.storage.local.get(g))[g];t!==void 0&&!await $(t)&&await chrome.storage.local.remove(g)}async function y(e){await new Promise((t,a)=>{chrome.debugger.attach({tabId:e},B,()=>{chrome.runtime.lastError?a(new Error(chrome.runtime.lastError.message)):t()})})}async function k(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function i(e,t,a={}){return await new Promise((n,r)=>{chrome.debugger.sendCommand({tabId:e},t,a,o=>{chrome.runtime.lastError?r(new Error(chrome.runtime.lastError.message)):n(o)})})}async function q(e,t,a){await i(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:a,button:"none",buttons:0}),await E(50),await i(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:a,button:"left",buttons:1,clickCount:1}),await E(50),await i(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:a,button:"left",buttons:0,clickCount:1})}async function V(e){var a;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((a=t==null?void 0:t.result)==null?void 0:a.value)??null}async function F(e,t){var n;const a=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(n=a==null?void 0:a.result)!=null&&n.value?(await i(e,"Input.insertText",{text:t}),!0):!1}async function N(e){var a;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((a=t==null?void 0:t.result)==null?void 0:a.value)??{diag:"eval_failed"}}async function K(e){var a;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((a=t==null?void 0:t.result)==null?void 0:a.value)===!0}const W='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function v(e){var a;const t=await i(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${W}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((a=t==null?void 0:t.result)==null?void 0:a.value)??[]}function H(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function Y(e){const t=await v(e),a=H(t);return a?(await q(e,a.x+Math.round(a.w/2),a.y+Math.round(a.h/2)),!0):!1}async function X(e,t){var o;const a=await i(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:n,h:r}=((o=a==null?void 0:a.result)==null?void 0:o.value)??{w:1440,h:900};await i(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(n/2),y:Math.round(r/2),deltaX:0,deltaY:t})}async function z(e){for(let t=0;t<5;t++)await i(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await E(50),await i(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await E(150)}async function P(e){return(await i(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function E(e){return new Promise(t=>setTimeout(t,e))}const J=`(() => {
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
})()`;function Q(e){const t=e.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);return t?decodeURIComponent(t[1]).toLowerCase():null}function Z(e){return`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e)}`}const tt=30,et=60,R="0.4.0";let A=!1;async function C(e){await chrome.storage.local.set({swActiveTabId:e})}async function _(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await D().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await _())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:tt/60}),chrome.alarms.create("hb",{periodInMinutes:et/60})});M().then(e=>{e&&x(R)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&x(R)});chrome.alarms.onAlarm.addListener(async e=>{if(await M()&&!await U()){if(e.name==="hb"){await x(R);return}if(e.name==="poll"){if(A){console.log("[poll] task already running, skipping");return}for(;await nt(););}}});async function nt(){let e;try{e=await O()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;A=!0;try{const t=await at(e);await I(e.id,{ok:!0,result:t})}catch(t){const a=t.code??"unknown",n=t.screenshot,r=t.buttons,o=t.diag;await I(e.id,{ok:!1,errorCode:a,errorMessage:t.message,...n||r||o?{result:{debugScreenshot:n,buttons:r,diag:o}}:{}})}finally{A=!1}return!0}async function at(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw s(new Error("missing_payload"),"bad_payload");return await rt(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw s(new Error("missing_payload"),"bad_payload");return await lt(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw s(new Error("missing_payload"),"bad_payload");return await ut(t.profileUrl)}if(e.kind==="RESOLVE_COMPANY"){if(!t.linkedinUrl&&!t.name)throw s(new Error("missing_payload"),"bad_payload");return await ct(t.linkedinUrl??null,t.name??null)}throw s(new Error("unknown_kind"),"unsupported_kind")}async function ot(e){var a;const t={};try{const n=await chrome.tabs.get(e);t.tabUrl=n.url??null,t.tabStatus=n.status??null,t.tabTitle=n.title??null,t.windowId=n.windowId??null}catch(n){t.tabGetError=String((n==null?void 0:n.message)??n)}try{if((a=chrome.management)!=null&&a.getAll){const n=await chrome.management.getAll();t.extensions=n.flatMap(r=>r.type==="extension"?[{id:r.id,name:r.name,enabled:r.enabled}]:[])}else t.extensions="management_api_unavailable"}catch(n){t.managementError=String((n==null?void 0:n.message)??n)}return t}async function rt(e,t,a=""){const n=await S("about:blank",!1);await C(n);let r=!1,o=null;try{await p(n),await y(n),r=!0,await i(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(n,"Page.navigate",{url:e}),await p(n),await w(2500);const m=await chrome.tabs.get(n);if(m.url&&m.url.includes("/checkpoint"))throw s(new Error("checkpoint"),"checkpoint");await z(n),await w(500),await Y(n)&&(console.log("[agent] dismissed popup before Message click"),await w(500));const d=await V(n);if(!d)throw s(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",d),await chrome.tabs.update(n,{url:d}),await p(n);let u=await N(n);const c=Date.now()+15e3;for(;Date.now()<c&&u.msgForm===0&&u.anyEditable===0;)await w(500),u=await N(n);console.log("[agent] post-nav diag:",u);const h=await F(n,t);if(console.log("[agent] typeIntoCompose:",h),!h)throw s(new Error(`compose_insert_failed diag=${JSON.stringify(u)}`),"compose_insert_failed");await w(600);const f=await K(n);if(console.log("[agent] clickSendButton:",f),!f)throw s(new Error("send_button_not_found"),"send_button_not_found");return await w(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(m){o=m;const l=await chrome.tabs.get(n).catch(()=>null);if(l!=null&&l.url&&(o.message=`${o.message} (url=${l.url})`),o.diag=await ot(n).catch(()=>({diagError:!0})),r)try{const[d,u]=await Promise.all([P(n),v(n)]);o.screenshot=d,o.buttons=u}catch{}throw o}finally{r&&await k(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await _()}}const it=`(() => {
  const section = document.querySelector('section[aria-label="Primary content"]');
  if (!section) return { candidates: [], hasNextPage: false };
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
  return { candidates: out, hasNextPage };
})()`;async function lt(e){var n;const t=await S(e).catch(()=>{throw s(new Error("tab_create_failed"),"tab_load")});await C(t);let a=!1;try{await p(t),await w(2500);const r=await chrome.tabs.get(t);if(r.url&&r.url.includes("/checkpoint"))throw s(new Error("checkpoint"),"checkpoint");await y(t),a=!0,await i(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{});for(let l=0;l<6;l++)await X(t,1200),await w(800);const o=await i(t,"Runtime.evaluate",{expression:it,returnByValue:!0}),m=(n=o==null?void 0:o.result)==null?void 0:n.value;if(!m)throw s(new Error("scrape_returned_null"),"scrape_failed");return m}finally{a&&await k(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await _()}}async function ct(e,t){var o,m,l;const a=e??Z(t??""),n=await S(a).catch(()=>{throw s(new Error("tab_create_failed"),"tab_load")});await C(n);let r=!1;try{await p(n),await w(2500);let d=await chrome.tabs.get(n);if(d.url&&d.url.includes("/checkpoint"))throw s(new Error("checkpoint"),"checkpoint");if(await y(n),r=!0,await i(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),!e){const f=await i(n,"Runtime.evaluate",{expression:G,returnByValue:!0}),b=(m=(o=f==null?void 0:f.result)==null?void 0:o.value)==null?void 0:m.companyUrl;if(!b)throw s(new Error("company_not_found"),"not_found");if(await k(n).catch(()=>{}),r=!1,await chrome.tabs.update(n,{url:b}),await p(n),await w(2500),d=await chrome.tabs.get(n),d.url&&d.url.includes("/checkpoint"))throw s(new Error("checkpoint"),"checkpoint");await y(n),r=!0}const u=await i(n,"Runtime.evaluate",{expression:j,returnByValue:!0}),c=(l=u==null?void 0:u.result)==null?void 0:l.value;if(!c||!c.companyId)throw s(new Error("company_id_not_found"),"no_id");const h=c.url??(await chrome.tabs.get(n)).url??a;return{companyId:c.companyId,resolvedName:c.resolvedName??null,slug:Q(h),matchedUrl:h}}finally{r&&await k(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await _()}}async function T(e,t){var n;const a=await i(e,"Runtime.evaluate",{expression:`(() => {
      const slug = ${JSON.stringify(t)};
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
    })()`,returnByValue:!0});return((n=a==null?void 0:a.result)==null?void 0:n.value)===!0}async function st(e){var a;const t=await i(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((a=t==null?void 0:t.result)==null?void 0:a.value)===!0}async function ut(e){var n,r,o;const t=await S("about:blank",!1).catch(()=>{throw s(new Error("tab_create_failed"),"tab_load")});await C(t);let a=!1;try{await p(t),await y(t),a=!0,await i(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(t,"Page.navigate",{url:e}),await p(t),await w(4e3);const m=await chrome.tabs.get(t);if(m.url&&m.url.includes("/checkpoint"))throw s(new Error("checkpoint"),"checkpoint");const l=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let d=await T(t,l);if(console.log("[connect] clickConnectInPage:",d),!d){const c=await i(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(n=c==null?void 0:c.result)!=null&&n.value&&(await w(800),d=await T(t,l),console.log("[connect] clickConnectInPage after More:",d))}if(!d){const c=await i(t,"Runtime.evaluate",{expression:J,returnByValue:!0}),h=(r=c==null?void 0:c.result)==null?void 0:r.value;if(h==="pending")throw s(new Error("invitation_already_pending"),"already_pending");if(h==="connected")throw s(new Error("already_connected"),"already_connected");const f=await i(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(o=f==null?void 0:f.result)!=null&&o.value?s(new Error("follow_only"),"follow_only"):s(new Error("connect_button_not_found"),"no_connect")}let u=!1;for(let c=0;c<6&&(await w(c===0?1500:800),u=await st(t),!u);c++);if(console.log("[connect] clickSendInPage:",u),!u){const c=await v(t);console.log("[connect] afterButtons:",c.map(f=>`"${f.text}" aria="${f.aria}"`));const h=c.flatMap(f=>{const b=(f.text||f.aria||"").trim();return b?[b]:[]}).slice(0,12).join(" | ");throw s(new Error(`send_dialog_not_found; buttons=[${h}]`),"already_or_blocked")}return await w(800),{sentAt:new Date().toISOString()}}catch(m){const l=m,d=await chrome.tabs.get(t).catch(()=>null);if(d!=null&&d.url&&(l.message=`${l.message} (url=${d.url})`),a&&l.code!=="already_pending"&&l.code!=="already_connected"&&l.code!=="checkpoint")try{const[u,c]=await Promise.all([P(t),v(t)]);l.screenshot=u,l.buttons=c}catch{}throw l}finally{a&&await k(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await _()}}async function p(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((a,n)=>{let r=!1;const o=u=>{r||(r=!0,clearTimeout(m),clearInterval(d),chrome.tabs.onUpdated.removeListener(l),u())},m=setTimeout(()=>o(()=>n(s(new Error("tab_load_timeout"),"tab_load"))),3e4),l=(u,c)=>{u===e&&c.status==="complete"&&o(a)};chrome.tabs.onUpdated.addListener(l);const d=setInterval(async()=>{const u=await chrome.tabs.get(e).catch(()=>null);if(!u)return o(()=>n(s(new Error("tab_closed"),"tab_load")));u.status==="complete"&&o(a)},1e3)})}function w(e){return new Promise(t=>setTimeout(t,e))}function s(e,t){return e.code=t,e}
