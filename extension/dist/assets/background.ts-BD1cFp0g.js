import{a as N,h as v,i as P,p as B,r as R}from"./api-IMK_rRYA.js";const D="1.3",h="automationWindowId";async function $(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function O(){const e=(await chrome.storage.local.get(h))[h];if(e!==void 0&&await $(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[h]:n.id}),n.id}async function _(t,e=!0){const n=await O(),a=await chrome.tabs.create({windowId:n,url:t,active:e});if(!a.id)throw new Error("tab_create_failed");return await chrome.windows.update(n,{focused:!1,state:"minimized"}).catch(()=>{}),a.id}async function L(){const e=(await chrome.storage.local.get(h))[h];e!==void 0&&!await $(e)&&await chrome.storage.local.remove(h)}async function E(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},D,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function S(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function l(t,e,n={}){return await new Promise((a,i)=>{chrome.debugger.sendCommand({tabId:t},e,n,r=>{chrome.runtime.lastError?i(new Error(chrome.runtime.lastError.message)):a(r)})})}async function q(t,e,n){await l(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await b(50),await l(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await b(50),await l(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function U(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function V(t,e){var a;const n=await l(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await l(t,"Input.insertText",{text:e}),!0):!1}async function I(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{diag:"eval_failed"}}async function K(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}const F='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function g(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${F}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}function W(t){for(const e of t)if(/^(dismiss|close|cancel)$/i.test(e.aria)||/artdeco-modal__dismiss/i.test(e.cls)||/dismiss/i.test(e.cls)||e.text==="×"||e.text==="✕"||e.text==="✖")return e;return t.find(e=>e.inModal&&e.w<50&&e.h<50)??null}async function H(t){const e=await g(t),n=W(e);return n?(await q(t,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function Y(t,e){var r;const n=await l(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:i}=((r=n==null?void 0:n.result)==null?void 0:r.value)??{w:1440,h:900};await l(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(i/2),deltaX:0,deltaY:e})}async function z(t){for(let e=0;e<5;e++)await l(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await b(50),await l(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await b(150)}async function M(t){return(await l(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function b(t){return new Promise(e=>setTimeout(e,t))}const J=`(() => {
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
})()`,X=30,j=60,A="0.3.3";let k=!1;async function x(t){await chrome.storage.local.set({swActiveTabId:t})}async function y(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await L().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await y())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:X/60}),chrome.alarms.create("hb",{periodInMinutes:j/60})});N().then(t=>{t&&v(A)});chrome.runtime.onMessage.addListener(t=>{(t==null?void 0:t.type)==="heartbeat"&&v(A)});chrome.alarms.onAlarm.addListener(async t=>{if(await N()&&!await P()){if(t.name==="hb"){await v(A);return}if(t.name==="poll"){if(k){console.log("[poll] task already running, skipping");return}for(;await G(););}}});async function G(){let t;try{t=await B()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;k=!0;try{const e=await Q(t);await R(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",a=e.screenshot,i=e.buttons,r=e.diag;await R(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...a||i||r?{result:{debugScreenshot:a,buttons:i,diag:r}}:{}})}finally{k=!1}return!0}async function Q(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw u(new Error("missing_payload"),"bad_payload");return await ee(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw u(new Error("missing_payload"),"bad_payload");return await ne(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw u(new Error("missing_payload"),"bad_payload");return await oe(e.profileUrl)}throw u(new Error("unknown_kind"),"bad_payload")}async function Z(t){var n;const e={};try{const a=await chrome.tabs.get(t);e.tabUrl=a.url??null,e.tabStatus=a.status??null,e.tabTitle=a.title??null,e.windowId=a.windowId??null}catch(a){e.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();e.extensions=a.filter(i=>i.type==="extension").map(i=>({id:i.id,name:i.name,enabled:i.enabled}))}else e.extensions="management_api_unavailable"}catch(a){e.managementError=String((a==null?void 0:a.message)??a)}return e}async function ee(t,e,n=""){const a=await _("about:blank",!1);await x(a);let i=!1,r=null;try{await p(a),await E(a),i=!0,await l(a,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await l(a,"Page.navigate",{url:t}),await p(a),await f(2500);const c=await chrome.tabs.get(a);if(c.url&&c.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await z(a),await f(500),await H(a)&&(console.log("[agent] dismissed popup before Message click"),await f(500));const d=await U(a);if(!d)throw u(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",d),await chrome.tabs.update(a,{url:d}),await p(a);let o=await I(a);const w=Date.now()+15e3;for(;Date.now()<w&&o.msgForm===0&&o.anyEditable===0;)await f(500),o=await I(a);console.log("[agent] post-nav diag:",o);const m=await V(a,e);if(console.log("[agent] typeIntoCompose:",m),!m)throw u(new Error(`compose_insert_failed diag=${JSON.stringify(o)}`),"compose_insert_failed");await f(600);const C=await K(a);if(console.log("[agent] clickSendButton:",C),!C)throw u(new Error("send_button_not_found"),"send_button_not_found");return await f(1500),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(c){r=c;const s=await chrome.tabs.get(a).catch(()=>null);if(s!=null&&s.url&&(r.message=`${r.message} (url=${s.url})`),r.diag=await Z(a).catch(()=>({diagError:!0})),i)try{const[d,o]=await Promise.all([M(a),g(a)]);r.screenshot=d,r.buttons=o}catch{}throw r}finally{i&&await S(a).catch(()=>{}),await chrome.tabs.remove(a).catch(()=>{}),await y()}}const te=`(() => {
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
    out.push({ urn, profileUrl, name, headline, title, company, location, degree });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  return { candidates: out, hasNextPage };
})()`;async function ne(t){var a;const e=await _(t).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await x(e);let n=!1;try{await p(e),await f(2500);const i=await chrome.tabs.get(e);if(i.url&&i.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await E(e),n=!0,await l(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{});for(let s=0;s<6;s++)await Y(e,1200),await f(800);const r=await l(e,"Runtime.evaluate",{expression:te,returnByValue:!0}),c=(a=r==null?void 0:r.result)==null?void 0:a.value;if(!c)throw u(new Error("scrape_returned_null"),"scrape_failed");return c}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await y()}}async function T(t,e){var a;const n=await l(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)===!0}async function ae(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function oe(t){var a,i;const e=await _("about:blank",!1).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await x(e);let n=!1;try{await p(e),await E(e),n=!0,await l(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await l(e,"Page.navigate",{url:t}),await p(e),await f(4e3);const r=await chrome.tabs.get(e);if(r.url&&r.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");const c=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let s=await T(e,c);if(console.log("[connect] clickConnectInPage:",s),!s){const o=await l(e,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(a=o==null?void 0:o.result)!=null&&a.value&&(await f(800),s=await T(e,c),console.log("[connect] clickConnectInPage after More:",s))}if(!s){const o=await l(e,"Runtime.evaluate",{expression:J,returnByValue:!0}),w=(i=o==null?void 0:o.result)==null?void 0:i.value;throw w==="pending"?u(new Error("invitation_already_pending"),"already_pending"):w==="connected"?u(new Error("already_connected"),"already_connected"):u(new Error("connect_button_not_found"),"no_connect")}let d=!1;for(let o=0;o<6&&(await f(o===0?1500:800),d=await ae(e),!d);o++);if(console.log("[connect] clickSendInPage:",d),!d){const o=await g(e);console.log("[connect] afterButtons:",o.map(m=>`"${m.text}" aria="${m.aria}"`));const w=o.map(m=>(m.text||m.aria||"").trim()).filter(Boolean).slice(0,12).join(" | ");throw u(new Error(`send_dialog_not_found; buttons=[${w}]`),"already_or_blocked")}return await f(800),{sentAt:new Date().toISOString()}}catch(r){const c=r,s=await chrome.tabs.get(e).catch(()=>null);if(s!=null&&s.url&&(c.message=`${c.message} (url=${s.url})`),n&&c.code!=="already_pending"&&c.code!=="already_connected"&&c.code!=="checkpoint")try{const[d,o]=await Promise.all([M(e),g(e)]);c.screenshot=d,c.buttons=o}catch{}throw c}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await y()}}async function p(t){const e=await chrome.tabs.get(t).catch(()=>null);(e==null?void 0:e.status)!=="complete"&&await new Promise((n,a)=>{let i=!1;const r=o=>{i||(i=!0,clearTimeout(c),clearInterval(d),chrome.tabs.onUpdated.removeListener(s),o())},c=setTimeout(()=>r(()=>a(u(new Error("tab_load_timeout"),"tab_load"))),3e4),s=(o,w)=>{o===t&&w.status==="complete"&&r(n)};chrome.tabs.onUpdated.addListener(s);const d=setInterval(async()=>{const o=await chrome.tabs.get(t).catch(()=>null);if(!o)return r(()=>a(u(new Error("tab_closed"),"tab_load")));o.status==="complete"&&r(n)},1e3)})}function f(t){return new Promise(e=>setTimeout(e,t))}function u(t,e){return t.code=e,t}
