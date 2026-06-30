import{a as I,h as _,i as $,p as P,r as C}from"./api-IMK_rRYA.js";const O="1.3",m="automationWindowId";async function N(e){try{return await chrome.windows.get(e),!0}catch{return!1}}async function L(){const t=(await chrome.storage.local.get(m))[m];if(t!==void 0&&await N(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[m]:n.id}),n.id}async function k(e,t=!0){const n=await L(),a=await chrome.tabs.create({windowId:n,url:e,active:t});if(!a.id)throw new Error("tab_create_failed");return await chrome.windows.update(n,{focused:!1,state:"minimized"}).catch(()=>{}),a.id}async function U(){const t=(await chrome.storage.local.get(m))[m];t!==void 0&&!await N(t)&&await chrome.storage.local.remove(m)}async function E(e){await new Promise((t,n)=>{chrome.debugger.attach({tabId:e},O,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):t()})})}async function x(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function s(e,t,n={}){return await new Promise((a,i)=>{chrome.debugger.sendCommand({tabId:e},t,n,o=>{chrome.runtime.lastError?i(new Error(chrome.runtime.lastError.message)):a(o)})})}async function g(e,t,n){await s(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:n,button:"none",buttons:0}),await y(50),await s(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:n,button:"left",buttons:1,clickCount:1}),await y(50),await s(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:n,button:"left",buttons:0,clickCount:1})}async function q(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await s(e,"Input.insertText",{text:t}),!0):!1}async function B(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}const W='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function w(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${W}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??[]}function K(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function H(e){const t=await w(e),n=K(t);return n?(await g(e,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function Y(e,t){var o;const n=await s(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:i}=((o=n==null?void 0:n.result)==null?void 0:o.value)??{w:1440,h:900};await s(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(i/2),deltaX:0,deltaY:t})}async function z(e){for(let t=0;t<5;t++)await s(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(50),await s(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(150)}async function D(e){return(await s(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function y(e){return new Promise(t=>setTimeout(t,e))}const X=`(() => {
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
})()`,J=30,G=60,S="0.3.0";let v=!1;async function M(e){await chrome.storage.local.set({swActiveTabId:e})}async function b(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await U().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await b())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:J/60}),chrome.alarms.create("hb",{periodInMinutes:G/60})});I().then(e=>{e&&_(S)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&_(S)});chrome.alarms.onAlarm.addListener(async e=>{if(await I()&&!await $()){if(e.name==="hb"){await _(S);return}if(e.name==="poll"){if(v){console.log("[poll] task already running, skipping");return}for(;await Z(););}}});async function Z(){let e;try{e=await P()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;v=!0;try{const t=await j(e);await C(e.id,{ok:!0,result:t})}catch(t){const n=t.code??"unknown",a=t.screenshot,i=t.buttons,o=t.diag;await C(e.id,{ok:!1,errorCode:n,errorMessage:t.message,...a||i||o?{result:{debugScreenshot:a,buttons:i,diag:o}}:{}})}finally{v=!1}return!0}async function j(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw d(new Error("missing_payload"),"bad_payload");return await tt(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await nt(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await ot(t.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function Q(e){var n;const t={};try{const a=await chrome.tabs.get(e);t.tabUrl=a.url??null,t.tabStatus=a.status??null,t.tabTitle=a.title??null,t.windowId=a.windowId??null}catch(a){t.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();t.extensions=a.filter(i=>i.type==="extension").map(i=>({id:i.id,name:i.name,enabled:i.enabled}))}else t.extensions="management_api_unavailable"}catch(a){t.managementError=String((a==null?void 0:a.message)??a)}return t}async function tt(e,t,n=""){const a=await k("about:blank",!1);await M(a);let i=!1,o=null;try{await p(a),await E(a),i=!0,await s(a,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(a,"Page.navigate",{url:e}),await p(a),await h(2500);const c=await chrome.tabs.get(a);if(c.url&&c.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await z(a),await h(500),await H(a)&&(console.log("[agent] dismissed popup before Message click"),await h(500));const l=await q(a);if(!l)throw d(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",l),await chrome.tabs.update(a,{url:l}),await p(a);let r=await B(a);const f=Date.now()+15e3;for(;Date.now()<f&&r.msgForm===0&&r.anyEditable===0;)await h(500),r=await B(a);console.log("[agent] post-nav diag:",r);const R=await V(a,t);if(console.log("[agent] typeIntoCompose:",R),!R)throw d(new Error(`compose_insert_failed diag=${JSON.stringify(r)}`),"compose_insert_failed");await h(600);const A=await F(a);if(console.log("[agent] clickSendButton:",A),!A)throw d(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(c){o=c;const u=await chrome.tabs.get(a).catch(()=>null);if(u!=null&&u.url&&(o.message=`${o.message} (url=${u.url})`),o.diag=await Q(a).catch(()=>({diagError:!0})),i)try{const[l,r]=await Promise.all([D(a),w(a)]);o.screenshot=l,o.buttons=r}catch{}throw o}finally{i&&await x(a).catch(()=>{}),await chrome.tabs.remove(a).catch(()=>{}),await b()}}const et=`(() => {
  const section = document.querySelector('section[aria-label="Primary content"]');
  if (!section) return { candidates: [], hasNextPage: false };
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    // derive a stable urn from the profile slug
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    // raw text of the card subtree (2-3 levels up from the link)
    const container = link.parentElement?.parentElement?.parentElement || link.parentElement;
    const raw = (container ? container.innerText : '').replace(/\\s+/g, ' ').trim();
    // name: first part of link text before " • "
    const nameRaw = link.innerText.trim().split('\\n')[0];
    // Strip: connection degree (" • 2nd"), favorite stars, and the inline "+N" shared-connection
    // badge LinkedIn glues to names in search cards (e.g. "+1 Yuval Bar Or"). Names never contain "+digits".
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').replace(/\\+\\d+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!name || name.length < 2) continue;
    // degree
    const degM = raw.match(/(1st|2nd|3rd\\+?)/);
    const degree = degM ? (degM[1].startsWith('3') ? '3rd' : degM[1]) : null;
    // title + company: look for "X at Y" or "X" pattern in raw text after name
    const afterName = raw.substring(raw.indexOf(name) + name.length).replace(/^[^a-zA-Zא-ת]+/, '');
    const atMatch = afterName.match(/^([^|•\\n]+?) at ([^|•\\n]+)/);
    let title = null, company = null, location = null;
    if (atMatch) {
      title = atMatch[1].trim();
      const rest = atMatch[2];
      // location is often after company — split on newline or " | "
      const locM = rest.split(/\\||\\n/);
      company = locM[0].trim();
      location = locM[1] ? locM[1].trim() : null;
    } else {
      const lines = afterName.split(/\\n|\\|/).map(s => s.trim()).filter(Boolean);
      title = lines[0] || null;
      location = lines[1] || null;
    }
    // headline: the raw first line after the name (LinkedIn's professional tagline)
    const headlineRaw = afterName.split(/\\n/)[0]?.replace(/^[•|\\s]+|[•|\\s]+$/g, '').trim() || null;
    const headline = headlineRaw && headlineRaw.length > 2 ? headlineRaw : null;
    out.push({ urn, profileUrl, name, headline, title, company, location, degree });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  return { candidates: out, hasNextPage };
})()`;async function nt(e){var a;const t=await k(e).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await M(t);let n=!1;try{await p(t),await h(2500);const i=await chrome.tabs.get(t);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await E(t),n=!0,await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{});for(let u=0;u<6;u++)await Y(t,1200),await h(800);const o=await s(t,"Runtime.evaluate",{expression:et,returnByValue:!0}),c=(a=o==null?void 0:o.result)==null?void 0:a.value;if(!c)throw d(new Error("scrape_returned_null"),"scrape_failed");return c}finally{n&&await x(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await b()}}async function T(e,t){var a;const n=await s(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function ot(e){var a;const t=await k("about:blank",!1).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await M(t);let n=!1;try{await p(t),await E(t),n=!0,await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(t,"Page.navigate",{url:e}),await p(t),await h(4e3);const i=await chrome.tabs.get(t);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");const o=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let c=await T(t,o);if(console.log("[connect] directBtn:",c),!c){let l=await w(t);if(console.log("[connect] buttons found:",l.map(r=>`"${r.text}" aria="${r.aria}" y=${r.y}`)),c=l.find(r=>/^connect$/i.test(r.text)||/connect/i.test(r.aria))??null,!c){const r=l.find(f=>/^more$/i.test(f.text)||/^more$/i.test(f.aria));r&&(await g(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),await h(700),l=await w(t),console.log("[connect] buttons after More:",l.map(f=>`"${f.text}" aria="${f.aria}" y=${f.y}`)),c=l.find(f=>/^connect$/i.test(f.text)||/connect/i.test(f.aria))??null,c||(c=await T(t,o)))}}if(!c){const l=await s(t,"Runtime.evaluate",{expression:X,returnByValue:!0}),r=(a=l==null?void 0:l.result)==null?void 0:a.value;throw r==="pending"?d(new Error("invitation_already_pending"),"already_pending"):r==="connected"?d(new Error("already_connected"),"already_connected"):d(new Error("connect_button_not_found"),"no_connect")}await g(t,c.x+Math.round((c.w??80)/2),c.y+Math.round((c.h??36)/2));let u=null;for(let l=0;l<6&&(await h(l===0?1500:800),u=await at(t),!u);l++);if(console.log("[connect] sendBtn:",u),!u){const l=await w(t);throw console.log("[connect] afterButtons:",l.map(r=>`"${r.text}" aria="${r.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await g(t,u.x+Math.round(u.w/2),u.y+Math.round(u.h/2)),await h(800),{sentAt:new Date().toISOString()}}catch(i){const o=i,c=await chrome.tabs.get(t).catch(()=>null);if(c!=null&&c.url&&(o.message=`${o.message} (url=${c.url})`),n&&o.code!=="already_pending"&&o.code!=="already_connected"&&o.code!=="checkpoint")try{const[u,l]=await Promise.all([D(t),w(t)]);o.screenshot=u,o.buttons=l}catch{}throw o}finally{n&&await x(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await b()}}async function p(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((n,a)=>{let i=!1;const o=r=>{i||(i=!0,clearTimeout(c),clearInterval(l),chrome.tabs.onUpdated.removeListener(u),r())},c=setTimeout(()=>o(()=>a(d(new Error("tab_load_timeout"),"tab_load"))),3e4),u=(r,f)=>{r===e&&f.status==="complete"&&o(n)};chrome.tabs.onUpdated.addListener(u);const l=setInterval(async()=>{const r=await chrome.tabs.get(e).catch(()=>null);if(!r)return o(()=>a(d(new Error("tab_closed"),"tab_load")));r.status==="complete"&&o(n)},1e3)})}function h(e){return new Promise(t=>setTimeout(t,e))}function d(e,t){return e.code=t,e}
