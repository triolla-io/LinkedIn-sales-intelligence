import{a as I,h as k,i as D,p as O,r as M}from"./api-IMK_rRYA.js";const P="1.3",m="automationWindowId";async function B(e){try{return await chrome.windows.get(e),!0}catch{return!1}}async function L(){const t=(await chrome.storage.local.get(m))[m];if(t!==void 0&&await B(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[m]:n.id}),n.id}async function _(e,t=!0){const n=await L(),a=await chrome.tabs.create({windowId:n,url:e,active:t});if(!a.id)throw new Error("tab_create_failed");return await chrome.windows.update(n,{focused:!1,state:"minimized"}).catch(()=>{}),a.id}async function U(){const t=(await chrome.storage.local.get(m))[m];t!==void 0&&!await B(t)&&await chrome.storage.local.remove(m)}async function E(e){await new Promise((t,n)=>{chrome.debugger.attach({tabId:e},P,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):t()})})}async function x(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function s(e,t,n={}){return await new Promise((a,i)=>{chrome.debugger.sendCommand({tabId:e},t,n,o=>{chrome.runtime.lastError?i(new Error(chrome.runtime.lastError.message)):a(o)})})}async function g(e,t,n){await s(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:n,button:"none",buttons:0}),await b(50),await s(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:n,button:"left",buttons:1,clickCount:1}),await b(50),await s(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:n,button:"left",buttons:0,clickCount:1})}async function q(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function V(e,t){var a;const n=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await s(e,"Input.insertText",{text:t}),!0):!1}async function T(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??{diag:"eval_failed"}}async function F(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}const K='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function w(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${K}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??[]}function W(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function H(e){const t=await w(e),n=W(t);return n?(await g(e,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function Y(e,t){var o;const n=await s(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:i}=((o=n==null?void 0:n.result)==null?void 0:o.value)??{w:1440,h:900};await s(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(i/2),deltaX:0,deltaY:t})}async function z(e){for(let t=0;t<5;t++)await s(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await b(50),await s(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await b(150)}async function N(e){return(await s(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function b(e){return new Promise(t=>setTimeout(t,e))}const J=`(() => {
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
})()`,X=30,G=60,S="0.3.1";let v=!1;async function A(e){await chrome.storage.local.set({swActiveTabId:e})}async function y(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await U().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await y())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:X/60}),chrome.alarms.create("hb",{periodInMinutes:G/60})});I().then(e=>{e&&k(S)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&k(S)});chrome.alarms.onAlarm.addListener(async e=>{if(await I()&&!await D()){if(e.name==="hb"){await k(S);return}if(e.name==="poll"){if(v){console.log("[poll] task already running, skipping");return}for(;await j(););}}});async function j(){let e;try{e=await O()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;v=!0;try{const t=await Q(e);await M(e.id,{ok:!0,result:t})}catch(t){const n=t.code??"unknown",a=t.screenshot,i=t.buttons,o=t.diag;await M(e.id,{ok:!1,errorCode:n,errorMessage:t.message,...a||i||o?{result:{debugScreenshot:a,buttons:i,diag:o}}:{}})}finally{v=!1}return!0}async function Q(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw d(new Error("missing_payload"),"bad_payload");return await tt(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await nt(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await ot(t.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function Z(e){var n;const t={};try{const a=await chrome.tabs.get(e);t.tabUrl=a.url??null,t.tabStatus=a.status??null,t.tabTitle=a.title??null,t.windowId=a.windowId??null}catch(a){t.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();t.extensions=a.filter(i=>i.type==="extension").map(i=>({id:i.id,name:i.name,enabled:i.enabled}))}else t.extensions="management_api_unavailable"}catch(a){t.managementError=String((a==null?void 0:a.message)??a)}return t}async function tt(e,t,n=""){const a=await _("about:blank",!1);await A(a);let i=!1,o=null;try{await p(a),await E(a),i=!0,await s(a,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(a,"Page.navigate",{url:e}),await p(a),await f(2500);const l=await chrome.tabs.get(a);if(l.url&&l.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await z(a),await f(500),await H(a)&&(console.log("[agent] dismissed popup before Message click"),await f(500));const c=await q(a);if(!c)throw d(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",c),await chrome.tabs.update(a,{url:c}),await p(a);let r=await T(a);const h=Date.now()+15e3;for(;Date.now()<h&&r.msgForm===0&&r.anyEditable===0;)await f(500),r=await T(a);console.log("[agent] post-nav diag:",r);const R=await V(a,t);if(console.log("[agent] typeIntoCompose:",R),!R)throw d(new Error(`compose_insert_failed diag=${JSON.stringify(r)}`),"compose_insert_failed");await f(600);const C=await F(a);if(console.log("[agent] clickSendButton:",C),!C)throw d(new Error("send_button_not_found"),"send_button_not_found");return await f(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(l){o=l;const u=await chrome.tabs.get(a).catch(()=>null);if(u!=null&&u.url&&(o.message=`${o.message} (url=${u.url})`),o.diag=await Z(a).catch(()=>({diagError:!0})),i)try{const[c,r]=await Promise.all([N(a),w(a)]);o.screenshot=c,o.buttons=r}catch{}throw o}finally{i&&await x(a).catch(()=>{}),await chrome.tabs.remove(a).catch(()=>{}),await y()}}const et=`(() => {
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
})()`;async function nt(e){var a;const t=await _(e).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await A(t);let n=!1;try{await p(t),await f(2500);const i=await chrome.tabs.get(t);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await E(t),n=!0,await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{});for(let u=0;u<6;u++)await Y(t,1200),await f(800);const o=await s(t,"Runtime.evaluate",{expression:et,returnByValue:!0}),l=(a=o==null?void 0:o.result)==null?void 0:a.value;if(!l)throw d(new Error("scrape_returned_null"),"scrape_failed");return l}finally{n&&await x(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await y()}}async function $(e,t){var a;const n=await s(e,"Runtime.evaluate",{expression:`(() => {
      const slug = ${JSON.stringify(t)};
      const cands = [...document.querySelectorAll(
        'a[href*="custom-invite" i], button[aria-label*="invite" i], button[aria-label*="connect" i], a[aria-label*="connect" i], [role="button"][aria-label*="invite" i]'
      )];
      let fallback = null;
      for (const el of cands) {
        const href = (el.getAttribute('href') || '').toLowerCase();
        // Skip custom-invite links that target a DIFFERENT member (sidebar suggestions).
        if (href.includes('custom-invite') && slug && !href.includes('vanityname=' + slug)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const at = document.elementFromPoint(cx, cy);
        const clickable = !!at && (at === el || el.contains(at) || at.contains(el));
        if (!clickable) continue; // occluded (e.g. sticky-header copy behind the nav)
        const box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        // Prefer a slug-scoped match; otherwise remember the first clickable connect/invite.
        if (href.includes('custom-invite') && slug && href.includes('vanityname=' + slug)) return box;
        if (!fallback) fallback = box;
      }
      return fallback;
    })()`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)??null}async function at(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(() => {
      let dlg = null;
      const findDlg = (root) => {
        if (dlg) return;
        const m = root.querySelector('[role="dialog"], .artdeco-modal');
        if (m) { dlg = m; return; }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { findDlg(el.shadowRoot); if (dlg) return; }
      };
      findDlg(document);
      const scope = dlg || document;
      const patterns = [/send without/i, /שלח ללא/i, /^send$/i, /^שלח$/i];
      let found = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (patterns.some(p => p.test(t) || p.test(a))) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              found = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
              return;
            }
          }
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      return found;
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function ot(e){var a;const t=await _("about:blank",!1).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await A(t);let n=!1;try{await p(t),await E(t),n=!0,await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(t,"Page.navigate",{url:e}),await p(t),await f(4e3);const i=await chrome.tabs.get(t);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");const o=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let l=await $(t,o);if(console.log("[connect] directBtn:",l),!l){let c=await w(t);if(console.log("[connect] buttons found:",c.map(r=>`"${r.text}" aria="${r.aria}" y=${r.y}`)),l=c.find(r=>/^connect$/i.test(r.text)||/connect/i.test(r.aria))??null,!l){const r=c.find(h=>/^more$/i.test(h.text)||/^more$/i.test(h.aria));r&&(await g(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),await f(700),c=await w(t),console.log("[connect] buttons after More:",c.map(h=>`"${h.text}" aria="${h.aria}" y=${h.y}`)),l=c.find(h=>/^connect$/i.test(h.text)||/connect/i.test(h.aria))??null,l||(l=await $(t,o)))}}if(!l){const c=await s(t,"Runtime.evaluate",{expression:J,returnByValue:!0}),r=(a=c==null?void 0:c.result)==null?void 0:a.value;throw r==="pending"?d(new Error("invitation_already_pending"),"already_pending"):r==="connected"?d(new Error("already_connected"),"already_connected"):d(new Error("connect_button_not_found"),"no_connect")}await g(t,l.x+Math.round((l.w??80)/2),l.y+Math.round((l.h??36)/2));let u=null;for(let c=0;c<6&&(await f(c===0?1500:800),u=await at(t),!u);c++);if(console.log("[connect] sendBtn:",u),!u){const c=await w(t);throw console.log("[connect] afterButtons:",c.map(r=>`"${r.text}" aria="${r.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await g(t,u.x+Math.round(u.w/2),u.y+Math.round(u.h/2)),await f(800),{sentAt:new Date().toISOString()}}catch(i){const o=i,l=await chrome.tabs.get(t).catch(()=>null);if(l!=null&&l.url&&(o.message=`${o.message} (url=${l.url})`),n&&o.code!=="already_pending"&&o.code!=="already_connected"&&o.code!=="checkpoint")try{const[u,c]=await Promise.all([N(t),w(t)]);o.screenshot=u,o.buttons=c}catch{}throw o}finally{n&&await x(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await y()}}async function p(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((n,a)=>{let i=!1;const o=r=>{i||(i=!0,clearTimeout(l),clearInterval(c),chrome.tabs.onUpdated.removeListener(u),r())},l=setTimeout(()=>o(()=>a(d(new Error("tab_load_timeout"),"tab_load"))),3e4),u=(r,h)=>{r===e&&h.status==="complete"&&o(n)};chrome.tabs.onUpdated.addListener(u);const c=setInterval(async()=>{const r=await chrome.tabs.get(e).catch(()=>null);if(!r)return o(()=>a(d(new Error("tab_closed"),"tab_load")));r.status==="complete"&&o(n)},1e3)})}function f(e){return new Promise(t=>setTimeout(t,e))}function d(e,t){return e.code=t,e}
