import{a as L,h as V,i as X,p as j,r as P}from"./api-IMK_rRYA.js";const J="modulepreload",z=function(t){return"/"+t},$={},Z=function(e,n,r){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),c=(a==null?void 0:a.nonce)||(a==null?void 0:a.getAttribute("nonce"));o=Promise.allSettled(n.map(s=>{if(s=z(s),s in $)return;$[s]=!0;const u=s.endsWith(".css"),p=u?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${s}"]${p}`))return;const h=document.createElement("link");if(h.rel=u?"stylesheet":J,u||(h.as="script"),h.crossOrigin="",h.href=s,c&&h.setAttribute("nonce",c),document.head.appendChild(h),u)return new Promise((m,y)=>{h.addEventListener("load",m),h.addEventListener("error",()=>y(new Error(`Unable to preload CSS for ${s}`)))})}))}function i(a){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=a,window.dispatchEvent(c),!c.defaultPrevented)throw a}return o.then(a=>{for(const c of a||[])c.status==="rejected"&&i(c.reason);return e().catch(i)})},G="1.3",x="automationWindowId";async function O(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function D(){const e=(await chrome.storage.local.get(x))[x];if(e!==void 0&&await O(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[x]:n.id}),n.id}async function T(t){const e=await D(),n=await chrome.tabs.create({windowId:e,url:t,active:!0});if(!n.id)throw new Error("tab_create_failed");return n.id}async function U(){const e=(await chrome.storage.local.get(x))[x];e!==void 0&&!await O(e)&&await chrome.storage.local.remove(x)}async function k(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},G,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function S(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function l(t,e,n={}){return await new Promise((r,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,i=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):r(i)})})}async function g(t,e,n){await l(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await _(50),await l(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await _(50),await l(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function Q(t,e){await l(t,"Input.insertText",{text:e})}async function ee(t,e,n){await l(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await _(30),await l(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function R(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
      const isMsgText = (t) => t === 'Message' || t === 'הודעה' || t === 'Message ';
      const candidates = [
        ...document.querySelectorAll('a[href*="/messaging/compose/"]'),
        ...document.querySelectorAll('button[aria-label*="Message" i]'),
        ...document.querySelectorAll('a[aria-label*="Message" i]'),
        ...document.querySelectorAll('button[aria-label*="הודעה"]'),
        ...document.querySelectorAll('a[aria-label*="הודעה"]'),
        ...[...document.querySelectorAll('a,button,[role="button"]')].filter(el => isMsgText((el.textContent || '').trim())),
      ];
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top < window.innerHeight * 0.65) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      return null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function te(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
      const compose =
        document.querySelector('div.msg-form__contenteditable[contenteditable="true"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]');
      if (!compose) return { ok: false };

      const cr = compose.getBoundingClientRect();
      if (cr.width === 0) return { ok: false }; // height can be 0 for flex-grow compose areas

      const btn =
        document.querySelector('button.msg-form__send-button') ||
        [...document.querySelectorAll('button[type="submit"]')].find(b =>
          b.textContent?.trim() === 'Send' || b.getAttribute('aria-label') === 'Send'
        ) || null;

      const result = {
        ok: true,
        composeX: Math.round(cr.left + cr.width / 2),
        composeY: Math.round(cr.top + cr.height / 2),
      };

      if (btn) {
        const br = btn.getBoundingClientRect();
        Object.assign(result, { sendX: Math.round(br.left + br.width / 2), sendY: Math.round(br.top + br.height / 2) });
      }

      return result;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function ne(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
      const selectors = [
        'div.msg-form__contenteditable[contenteditable="true"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        '[aria-label*="message" i]',
        '[aria-label*="הודעה"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { el.focus(); el.click(); return true; }
      }
      return false;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function K(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function oe(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(function() {
        const selectors = [
          '[placeholder="Write a message..."]',
          '[placeholder="כתוב הודעה..."]',
          'div.msg-form__contenteditable[contenteditable="true"]',
          '[contenteditable="true"]',
          '[data-placeholder]',
          'div[role="textbox"]',
          'textarea',
        ];
        function findInDoc(doc) {
          for (const sel of selectors) {
            try {
              for (const el of doc.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                if (r.width > 50 && r.height > 0) {
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
              }
            } catch(e) {}
          }
          return null;
        }
        const main = findInDoc(document);
        if (main) return main;
        for (const iframe of document.querySelectorAll('iframe')) {
          try {
            const iDoc = iframe.contentDocument;
            if (!iDoc) continue;
            const fr = iframe.getBoundingClientRect();
            const found = findInDoc(iDoc);
            if (found) return { x: Math.round(fr.left + found.x), y: Math.round(fr.top + found.y) };
          } catch(e) {}
        }
        return null;
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function b(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function re(t){const e=await b(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await g(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await ae(t),r=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return r?(await g(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0):!1}async function ae(t){var n;const e=await l(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function ie(t,e){var r;const n=await l(t,"Runtime.evaluate",{expression:`(function(txt) {
      // Pierce shadow DOM — LinkedIn compose is inside #interop-outlet shadowRoot
      function findEditable(root) {
        for (const sel of ['[contenteditable="true"]', '[contenteditable]', '[role="textbox"]', 'textarea']) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 10) return el;
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const found = findEditable(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const el = findEditable(document);
      if (!el) return false;
      el.focus();
      el.click();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      const result = document.execCommand('insertText', false, txt);
      return result || (el.textContent || '').includes(txt.slice(0, 10));
    })(${JSON.stringify(e)})`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)===!0}async function W(t,e){var i;const n=await l(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:r,h:o}=((i=n==null?void 0:n.result)==null?void 0:i.value)??{w:1440,h:900};await l(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(r/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function A(t){for(let e=0;e<5;e++)await l(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(50),await l(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(150)}async function Y(t,e,n){var o;const r=await l(t,"Runtime.evaluate",{expression:`(function(txt, name) {
      // Pierce shadow DOM to find all visible contenteditable elements
      function findAllEditables(root, found) {
        for (const sel of ['[contenteditable="true"]', '[contenteditable]']) {
          for (const el of root.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 10) found.push(el);
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) findAllEditables(el.shadowRoot, found);
        }
      }

      const editables = [];
      findAllEditables(document, editables);
      if (editables.length === 0) return false;

      // Try to find the compose that belongs to the correct recipient
      // by checking if the recipient name appears near the compose element
      let target = null;
      const nameLower = name.toLowerCase().split(' ')[0]; // first name
      for (const el of editables) {
        // Walk up the DOM to find a container that mentions the recipient
        let node = el.parentElement;
        for (let i = 0; i < 10 && node; i++) {
          if (node.textContent && node.textContent.toLowerCase().includes(nameLower)) {
            target = el;
            break;
          }
          node = node.parentElement;
        }
        if (target) break;
      }

      // If no match by name, use the LAST opened compose (rightmost / highest index)
      if (!target) target = editables[editables.length - 1];

      target.focus();
      target.click();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      return document.execCommand('insertText', false, txt) || (target.textContent || '').includes(txt.slice(0, 10));
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=r==null?void 0:r.result)==null?void 0:o.value)===!0}async function F(t){return(await l(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function _(t){return new Promise(e=>setTimeout(e,t))}const se=Object.freeze(Object.defineProperty({__proto__:null,attach:k,click:g,clickModalClose:re,clickSendButton:K,closeAllComposeOverlays:A,closeStaleAutomationWindow:U,detach:S,evalFindCompose:oe,findMessageButton:R,focusCompose:ne,getAutomationWindow:D,getComposeCoords:te,insertTextIntoCompose:ie,insertTextIntoNamedCompose:Y,openTabInAutomationWindow:T,pressKey:ee,scanButtons:b,scrollBy:W,send:l,takeScreenshot:F,typeText:Q},Symbol.toStringTag,{value:"Module"})),ce=30,le=60,H="0.2.0";let B=!1;async function I(t){await chrome.storage.local.set({swActiveTabId:t})}async function M(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await U().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await M())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:ce/60}),chrome.alarms.create("hb",{periodInMinutes:le/60})});L().then(t=>{t&&V(H)});chrome.alarms.onAlarm.addListener(async t=>{if(await L()&&!await X()){if(t.name==="hb"){await V(H);return}if(t.name==="poll"){if(B){console.log("[poll] task already running, skipping");return}for(;await ue(););}}});async function ue(){let t;try{t=await j()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;B=!0;try{const e=await de(t);await P(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",r=e.screenshot,o=e.buttons;await P(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...r||o?{result:{debugScreenshot:r,buttons:o}}:{}})}finally{B=!1}return!0}async function de(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw d(new Error("missing_payload"),"bad_payload");return await fe(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await me(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await ge(e.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function fe(t,e,n=""){var c;const r=await chrome.tabs.create({url:t,active:!0});if(!r.id)throw d(new Error("tab_create_failed"),"tab_load");const o=r.id;await I(o);let i=!1,a=null;try{await E(o),await f(2500);const s=await chrome.tabs.get(o);s.windowId&&await chrome.windows.update(s.windowId,{focused:!0}),await f(300);const u=await chrome.tabs.get(o);if(u.url&&u.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(o),i=!0;const p=await(await Z(async()=>{const{send:w}=await Promise.resolve().then(()=>se);return{send:w}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),h=((c=p==null?void 0:p.result)==null?void 0:c.value)??1;console.log("[agent] devicePixelRatio:",h),await chrome.scripting.executeScript({target:{tabId:o},func:w=>navigator.clipboard.writeText(w),args:[e]}),await f(200),await A(o),await f(500);let m=await R(o);if(!m){const v=(await b(o)).find(C=>/^more$/i.test(C.text)||/^more$/i.test(C.aria)||/^עוד$/.test(C.text));v&&(await g(o,v.x+Math.round(v.w/2),v.y+Math.round(v.h/2)),await f(700),m=await R(o))}if(console.log("[agent] findMessageButton:",m),!m)throw d(new Error("message_button_not_found"),"not_messageable");await g(o,m.x,m.y),await E(o).catch(()=>{}),await f(2500);let y=!1;for(let w=0;w<6&&(y=await Y(o,e,n),console.log(`[agent] insertTextIntoCompose attempt ${w+1}:`,y),!y);w++)await f(600);if(!y)throw d(new Error("compose_insert_failed"),"compose_insert_failed");await f(800);const q=await K(o);if(console.log("[agent] clickSendButton:",q),!q)throw d(new Error("send_button_not_found"),"send_button_not_found");return await f(1500),await A(o).catch(()=>{}),await f(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(s){a=s;const u=await chrome.tabs.get(o).catch(()=>null);if(u!=null&&u.url&&(a.message=`${a.message} (url=${u.url})`),i)try{const[p,h]=await Promise.all([F(o),b(o)]);a.screenshot=p,a.buttons=h}catch{}throw a}finally{i&&await S(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{}),await M()}}const he=`(() => {
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
    out.push({ urn, profileUrl, name, title, company, location, degree });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  return { candidates: out, hasNextPage };
})()`;async function me(t){var r;const e=await T(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await I(e);let n=!1;try{await E(e),await f(2500);const o=await chrome.tabs.get(e);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(e),n=!0;for(let c=0;c<6;c++)await W(e,1200),await f(800);const i=await l(e,"Runtime.evaluate",{expression:he,returnByValue:!0}),a=(r=i==null?void 0:i.result)==null?void 0:r.value;if(!a)throw d(new Error("scrape_returned_null"),"scrape_failed");return a}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await M()}}async function N(t,e){var r;const n=await l(t,"Runtime.evaluate",{expression:`(() => {
      const slug = ${JSON.stringify(e)};
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
    })()`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)??null}async function we(t){var n;const e=await l(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function ge(t){const e=await T(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await I(e);let n=!1;try{await E(e),await f(4e3);const r=await chrome.tabs.get(e);if(r.url&&r.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(e),n=!0;const o=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let i=await N(e,o);if(console.log("[connect] directBtn:",i),!i){let c=await b(e);if(console.log("[connect] buttons found:",c.map(s=>`"${s.text}" aria="${s.aria}" y=${s.y}`)),i=c.find(s=>/^connect$/i.test(s.text)||/connect/i.test(s.aria))??null,!i){const s=c.find(u=>/^more$/i.test(u.text)||/^more$/i.test(u.aria));s&&(await g(e,s.x+Math.round(s.w/2),s.y+Math.round(s.h/2)),await f(700),c=await b(e),console.log("[connect] buttons after More:",c.map(u=>`"${u.text}" aria="${u.aria}" y=${u.y}`)),i=c.find(u=>/^connect$/i.test(u.text)||/connect/i.test(u.aria))??null,i||(i=await N(e,o)))}}if(!i)throw d(new Error("connect_button_not_found"),"no_connect");await g(e,i.x+Math.round((i.w??80)/2),i.y+Math.round((i.h??36)/2));let a=null;for(let c=0;c<6&&(await f(c===0?1500:800),a=await we(e),!a);c++);if(console.log("[connect] sendBtn:",a),!a){const c=await b(e);throw console.log("[connect] afterButtons:",c.map(s=>`"${s.text}" aria="${s.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await g(e,a.x+Math.round(a.w/2),a.y+Math.round(a.h/2)),await f(800),{sentAt:new Date().toISOString()}}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await M()}}async function E(t){await new Promise((e,n)=>{const r=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(o),n(d(new Error("tab_load_timeout"),"tab_load"))},3e4),o=(i,a)=>{i===t&&a.status==="complete"&&(clearTimeout(r),chrome.tabs.onUpdated.removeListener(o),e())};chrome.tabs.onUpdated.addListener(o)})}function f(t){return new Promise(e=>setTimeout(e,t))}function d(t,e){return t.code=e,t}
