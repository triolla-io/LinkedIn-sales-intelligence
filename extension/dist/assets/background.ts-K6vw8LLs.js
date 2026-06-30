import{a as N,h as _,i as P,p as B,r as R}from"./api-IMK_rRYA.js";const D="1.3",p="automationWindowId";async function $(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function L(){const e=(await chrome.storage.local.get(p))[p];if(e!==void 0&&await $(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[p]:n.id}),n.id}async function E(t,e=!0){const n=await L(),a=await chrome.tabs.create({windowId:n,url:t,active:e});if(!a.id)throw new Error("tab_create_failed");return await chrome.windows.update(n,{focused:!1,state:"minimized"}).catch(()=>{}),a.id}async function O(){const e=(await chrome.storage.local.get(p))[p];e!==void 0&&!await $(e)&&await chrome.storage.local.remove(p)}async function S(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},D,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function A(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function i(t,e,n={}){return await new Promise((a,r)=>{chrome.debugger.sendCommand({tabId:t},e,n,o=>{chrome.runtime.lastError?r(new Error(chrome.runtime.lastError.message)):a(o)})})}async function q(t,e,n){await i(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await y(50),await i(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await y(50),await i(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function U(t){var n;const e=await i(t,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function V(t,e){var a;const n=await i(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await i(t,"Input.insertText",{text:e}),!0):!1}async function I(t){var n;const e=await i(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{diag:"eval_failed"}}async function F(t){var n;const e=await i(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}const K='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function b(t){var n;const e=await i(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${K}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}function W(t){for(const e of t)if(/^(dismiss|close|cancel)$/i.test(e.aria)||/artdeco-modal__dismiss/i.test(e.cls)||/dismiss/i.test(e.cls)||e.text==="×"||e.text==="✕"||e.text==="✖")return e;return t.find(e=>e.inModal&&e.w<50&&e.h<50)??null}async function H(t){const e=await b(t),n=W(e);return n?(await q(t,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function Y(t,e){var o;const n=await i(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:r}=((o=n==null?void 0:n.result)==null?void 0:o.value)??{w:1440,h:900};await i(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(r/2),deltaX:0,deltaY:e})}async function z(t){for(let e=0;e<5;e++)await i(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(50),await i(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(150)}async function M(t){return(await i(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function y(t){return new Promise(e=>setTimeout(e,t))}const J=`(() => {
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
})()`,X=30,j=60,C="0.3.4";let k=!1;async function x(t){await chrome.storage.local.set({swActiveTabId:t})}async function v(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await O().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await v())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:X/60}),chrome.alarms.create("hb",{periodInMinutes:j/60})});N().then(t=>{t&&_(C)});chrome.runtime.onMessage.addListener(t=>{(t==null?void 0:t.type)==="heartbeat"&&_(C)});chrome.alarms.onAlarm.addListener(async t=>{if(await N()&&!await P()){if(t.name==="hb"){await _(C);return}if(t.name==="poll"){if(k){console.log("[poll] task already running, skipping");return}for(;await G(););}}});async function G(){let t;try{t=await B()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;k=!0;try{const e=await Q(t);await R(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",a=e.screenshot,r=e.buttons,o=e.diag;await R(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...a||r||o?{result:{debugScreenshot:a,buttons:r,diag:o}}:{}})}finally{k=!1}return!0}async function Q(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw u(new Error("missing_payload"),"bad_payload");return await ee(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw u(new Error("missing_payload"),"bad_payload");return await ne(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw u(new Error("missing_payload"),"bad_payload");return await oe(e.profileUrl)}throw u(new Error("unknown_kind"),"bad_payload")}async function Z(t){var n;const e={};try{const a=await chrome.tabs.get(t);e.tabUrl=a.url??null,e.tabStatus=a.status??null,e.tabTitle=a.title??null,e.windowId=a.windowId??null}catch(a){e.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();e.extensions=a.filter(r=>r.type==="extension").map(r=>({id:r.id,name:r.name,enabled:r.enabled}))}else e.extensions="management_api_unavailable"}catch(a){e.managementError=String((a==null?void 0:a.message)??a)}return e}async function ee(t,e,n=""){const a=await E("about:blank",!1);await x(a);let r=!1,o=null;try{await g(a),await S(a),r=!0,await i(a,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(a,"Page.navigate",{url:t}),await g(a),await m(2500);const f=await chrome.tabs.get(a);if(f.url&&f.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await z(a),await m(500),await H(a)&&(console.log("[agent] dismissed popup before Message click"),await m(500));const d=await U(a);if(!d)throw u(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",d),await chrome.tabs.update(a,{url:d}),await g(a);let s=await I(a);const c=Date.now()+15e3;for(;Date.now()<c&&s.msgForm===0&&s.anyEditable===0;)await m(500),s=await I(a);console.log("[agent] post-nav diag:",s);const h=await V(a,e);if(console.log("[agent] typeIntoCompose:",h),!h)throw u(new Error(`compose_insert_failed diag=${JSON.stringify(s)}`),"compose_insert_failed");await m(600);const w=await F(a);if(console.log("[agent] clickSendButton:",w),!w)throw u(new Error("send_button_not_found"),"send_button_not_found");return await m(1500),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(f){o=f;const l=await chrome.tabs.get(a).catch(()=>null);if(l!=null&&l.url&&(o.message=`${o.message} (url=${l.url})`),o.diag=await Z(a).catch(()=>({diagError:!0})),r)try{const[d,s]=await Promise.all([M(a),b(a)]);o.screenshot=d,o.buttons=s}catch{}throw o}finally{r&&await A(a).catch(()=>{}),await chrome.tabs.remove(a).catch(()=>{}),await v()}}const te=`(() => {
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
})()`;async function ne(t){var a;const e=await E(t).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await x(e);let n=!1;try{await g(e),await m(2500);const r=await chrome.tabs.get(e);if(r.url&&r.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");await S(e),n=!0,await i(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{});for(let l=0;l<6;l++)await Y(e,1200),await m(800);const o=await i(e,"Runtime.evaluate",{expression:te,returnByValue:!0}),f=(a=o==null?void 0:o.result)==null?void 0:a.value;if(!f)throw u(new Error("scrape_returned_null"),"scrape_failed");return f}finally{n&&await A(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await v()}}async function T(t,e){var a;const n=await i(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)===!0}async function ae(t){var n;const e=await i(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function oe(t){var a,r,o;const e=await E("about:blank",!1).catch(()=>{throw u(new Error("tab_create_failed"),"tab_load")});await x(e);let n=!1;try{await g(e),await S(e),n=!0,await i(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(e,"Page.navigate",{url:t}),await g(e),await m(4e3);const f=await chrome.tabs.get(e);if(f.url&&f.url.includes("/checkpoint"))throw u(new Error("checkpoint"),"checkpoint");const l=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let d=await T(e,l);if(console.log("[connect] clickConnectInPage:",d),!d){const c=await i(e,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(a=c==null?void 0:c.result)!=null&&a.value&&(await m(800),d=await T(e,l),console.log("[connect] clickConnectInPage after More:",d))}if(!d){const c=await i(e,"Runtime.evaluate",{expression:J,returnByValue:!0}),h=(r=c==null?void 0:c.result)==null?void 0:r.value;if(h==="pending")throw u(new Error("invitation_already_pending"),"already_pending");if(h==="connected")throw u(new Error("already_connected"),"already_connected");const w=await i(e,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(o=w==null?void 0:w.result)!=null&&o.value?u(new Error("follow_only"),"follow_only"):u(new Error("connect_button_not_found"),"no_connect")}let s=!1;for(let c=0;c<6&&(await m(c===0?1500:800),s=await ae(e),!s);c++);if(console.log("[connect] clickSendInPage:",s),!s){const c=await b(e);console.log("[connect] afterButtons:",c.map(w=>`"${w.text}" aria="${w.aria}"`));const h=c.map(w=>(w.text||w.aria||"").trim()).filter(Boolean).slice(0,12).join(" | ");throw u(new Error(`send_dialog_not_found; buttons=[${h}]`),"already_or_blocked")}return await m(800),{sentAt:new Date().toISOString()}}catch(f){const l=f,d=await chrome.tabs.get(e).catch(()=>null);if(d!=null&&d.url&&(l.message=`${l.message} (url=${d.url})`),n&&l.code!=="already_pending"&&l.code!=="already_connected"&&l.code!=="checkpoint")try{const[s,c]=await Promise.all([M(e),b(e)]);l.screenshot=s,l.buttons=c}catch{}throw l}finally{n&&await A(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await v()}}async function g(t){const e=await chrome.tabs.get(t).catch(()=>null);(e==null?void 0:e.status)!=="complete"&&await new Promise((n,a)=>{let r=!1;const o=s=>{r||(r=!0,clearTimeout(f),clearInterval(d),chrome.tabs.onUpdated.removeListener(l),s())},f=setTimeout(()=>o(()=>a(u(new Error("tab_load_timeout"),"tab_load"))),3e4),l=(s,c)=>{s===t&&c.status==="complete"&&o(n)};chrome.tabs.onUpdated.addListener(l);const d=setInterval(async()=>{const s=await chrome.tabs.get(t).catch(()=>null);if(!s)return o(()=>a(u(new Error("tab_closed"),"tab_load")));s.status==="complete"&&o(n)},1e3)})}function m(t){return new Promise(e=>setTimeout(e,t))}function u(t,e){return t.code=e,t}
