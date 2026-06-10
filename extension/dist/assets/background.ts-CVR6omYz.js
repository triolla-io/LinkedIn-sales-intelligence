import{a as D,h as T,i as X,p as j,r as L}from"./api-IMK_rRYA.js";const z="modulepreload",J=function(e){return"/"+e},N={},Z=function(t,n,i){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const r=document.querySelector("meta[property=csp-nonce]"),l=(r==null?void 0:r.nonce)||(r==null?void 0:r.getAttribute("nonce"));o=Promise.allSettled(n.map(c=>{if(c=J(c),c in N)return;N[c]=!0;const a=c.endsWith(".css"),f=a?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${f}`))return;const w=document.createElement("link");if(w.rel=a?"stylesheet":z,a||(w.as="script"),w.crossOrigin="",w.href=c,l&&w.setAttribute("nonce",l),document.head.appendChild(w),a)return new Promise((m,b)=>{w.addEventListener("load",m),w.addEventListener("error",()=>b(new Error(`Unable to preload CSS for ${c}`)))})}))}function s(r){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=r,window.dispatchEvent(l),!l.defaultPrevented)throw r}return o.then(r=>{for(const l of r||[])l.status==="rejected"&&s(l.reason);return t().catch(s)})},G="1.3",x="automationWindowId";async function U(e){try{return await chrome.windows.get(e),!0}catch{return!1}}async function K(){const t=(await chrome.storage.local.get(x))[x];if(t!==void 0&&await U(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[x]:n.id}),n.id}async function I(e){const t=await K(),n=await chrome.tabs.create({windowId:t,url:e,active:!0});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(t,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function W(){const t=(await chrome.storage.local.get(x))[x];t!==void 0&&!await U(t)&&await chrome.storage.local.remove(x)}async function k(e){await new Promise((t,n)=>{chrome.debugger.attach({tabId:e},G,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):t()})})}async function S(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function u(e,t,n={}){return await new Promise((i,o)=>{chrome.debugger.sendCommand({tabId:e},t,n,s=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):i(s)})})}async function y(e,t,n){await u(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:n,button:"none",buttons:0}),await _(50),await u(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:n,button:"left",buttons:1,clickCount:1}),await _(50),await u(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:n,button:"left",buttons:0,clickCount:1})}async function Q(e,t){await u(e,"Input.insertText",{text:t})}async function tt(e,t,n){await u(e,"Input.dispatchKeyEvent",{type:"keyDown",key:t,code:t,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await _(30),await u(e,"Input.dispatchKeyEvent",{type:"keyUp",key:t,code:t,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function R(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function et(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??{ok:!1}}async function nt(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}async function F(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}async function ot(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function p(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??[]}async function rt(e){const t=await p(e);for(const o of t)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await y(e,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await at(e),i=t.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return i?(await y(e,i.x+Math.round(i.w/2),i.y+Math.round(i.h/2)),!0):!1}async function at(e){var n;const t=await u(e,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??1440}async function it(e,t){var i;const n=await u(e,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(t)})`,returnByValue:!0});return((i=n==null?void 0:n.result)==null?void 0:i.value)===!0}async function Y(e,t){var s;const n=await u(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:i,h:o}=((s=n==null?void 0:n.result)==null?void 0:s.value)??{w:1440,h:900};await u(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(i/2),y:Math.round(o/2),deltaX:0,deltaY:t})}async function A(e){for(let t=0;t<5;t++)await u(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(50),await u(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(150)}async function H(e,t,n){var o;const i=await u(e,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(t)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=i==null?void 0:i.result)==null?void 0:o.value)===!0}async function $(e){return(await u(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function _(e){return new Promise(t=>setTimeout(t,e))}const ct=Object.freeze(Object.defineProperty({__proto__:null,attach:k,click:y,clickModalClose:rt,clickSendButton:F,closeAllComposeOverlays:A,closeStaleAutomationWindow:W,detach:S,evalFindCompose:ot,findMessageButton:R,focusCompose:nt,getAutomationWindow:K,getComposeCoords:et,insertTextIntoCompose:it,insertTextIntoNamedCompose:H,openTabInAutomationWindow:I,pressKey:tt,scanButtons:p,scrollBy:Y,send:u,takeScreenshot:$,typeText:Q},Symbol.toStringTag,{value:"Module"})),st=`(() => {
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
})()`,lt=30,ut=60,q="0.2.0";let B=!1;async function P(e){await chrome.storage.local.set({swActiveTabId:e})}async function M(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await W().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await M())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:lt/60}),chrome.alarms.create("hb",{periodInMinutes:ut/60})});D().then(e=>{e&&T(q)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&T(q)});chrome.alarms.onAlarm.addListener(async e=>{if(await D()&&!await X()){if(e.name==="hb"){await T(q);return}if(e.name==="poll"){if(B){console.log("[poll] task already running, skipping");return}for(;await dt(););}}});async function dt(){let e;try{e=await j()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;B=!0;try{const t=await ft(e);await L(e.id,{ok:!0,result:t})}catch(t){const n=t.code??"unknown",i=t.screenshot,o=t.buttons;await L(e.id,{ok:!1,errorCode:n,errorMessage:t.message,...i||o?{result:{debugScreenshot:i,buttons:o}}:{}})}finally{B=!1}return!0}async function ft(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw d(new Error("missing_payload"),"bad_payload");return await ht(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await mt(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await gt(t.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function ht(e,t,n=""){var l;const i=await chrome.tabs.create({url:e,active:!0});if(!i.id)throw d(new Error("tab_create_failed"),"tab_load");const o=i.id;await P(o);let s=!1,r=null;try{await E(o),await h(2500);const c=await chrome.tabs.get(o);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await h(300);const a=await chrome.tabs.get(o);if(a.url&&a.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(o),s=!0;const f=await(await Z(async()=>{const{send:g}=await Promise.resolve().then(()=>ct);return{send:g}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),w=((l=f==null?void 0:f.result)==null?void 0:l.value)??1;console.log("[agent] devicePixelRatio:",w),await chrome.scripting.executeScript({target:{tabId:o},func:g=>navigator.clipboard.writeText(g),args:[t]}),await h(200),await A(o),await h(500);let m=await R(o);if(!m){const v=(await p(o)).find(C=>/^more$/i.test(C.text)||/^more$/i.test(C.aria)||/^עוד$/.test(C.text));v&&(await y(o,v.x+Math.round(v.w/2),v.y+Math.round(v.h/2)),await h(700),m=await R(o))}if(console.log("[agent] findMessageButton:",m),!m)throw d(new Error("message_button_not_found"),"not_messageable");await y(o,m.x,m.y),await E(o).catch(()=>{}),await h(2500);let b=!1;for(let g=0;g<6&&(b=await H(o,t,n),console.log(`[agent] insertTextIntoCompose attempt ${g+1}:`,b),!b);g++)await h(600);if(!b)throw d(new Error("compose_insert_failed"),"compose_insert_failed");await h(800);const O=await F(o);if(console.log("[agent] clickSendButton:",O),!O)throw d(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),await A(o).catch(()=>{}),await h(300),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(c){r=c;const a=await chrome.tabs.get(o).catch(()=>null);if(a!=null&&a.url&&(r.message=`${r.message} (url=${a.url})`),s)try{const[f,w]=await Promise.all([$(o),p(o)]);r.screenshot=f,r.buttons=w}catch{}throw r}finally{s&&await S(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{}),await M()}}const wt=`(() => {
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
})()`;async function mt(e){var i;const t=await I(e).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await P(t);let n=!1;try{await E(t),await h(2500);const o=await chrome.tabs.get(t);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(t),n=!0;for(let l=0;l<6;l++)await Y(t,1200),await h(800);const s=await u(t,"Runtime.evaluate",{expression:wt,returnByValue:!0}),r=(i=s==null?void 0:s.result)==null?void 0:i.value;if(!r)throw d(new Error("scrape_returned_null"),"scrape_failed");return r}finally{n&&await S(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await M()}}async function V(e,t){var i;const n=await u(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((i=n==null?void 0:n.result)==null?void 0:i.value)??null}async function pt(e){var n;const t=await u(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function gt(e){var i;const t=await I(e).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await P(t);let n=!1;try{await E(t),await h(4e3);const o=await chrome.tabs.get(t);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(t),n=!0;const s=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let r=await V(t,s);if(console.log("[connect] directBtn:",r),!r){let c=await p(t);if(console.log("[connect] buttons found:",c.map(a=>`"${a.text}" aria="${a.aria}" y=${a.y}`)),r=c.find(a=>/^connect$/i.test(a.text)||/connect/i.test(a.aria))??null,!r){const a=c.find(f=>/^more$/i.test(f.text)||/^more$/i.test(f.aria));a&&(await y(t,a.x+Math.round(a.w/2),a.y+Math.round(a.h/2)),await h(700),c=await p(t),console.log("[connect] buttons after More:",c.map(f=>`"${f.text}" aria="${f.aria}" y=${f.y}`)),r=c.find(f=>/^connect$/i.test(f.text)||/connect/i.test(f.aria))??null,r||(r=await V(t,s)))}}if(!r){const c=await u(t,"Runtime.evaluate",{expression:st,returnByValue:!0}),a=(i=c==null?void 0:c.result)==null?void 0:i.value;throw a==="pending"?d(new Error("invitation_already_pending"),"already_pending"):a==="connected"?d(new Error("already_connected"),"already_connected"):(await p(t)).some(m=>/^follow$/i.test(m.text.trim())||/^follow$/i.test(m.aria.trim())||/^עקוב$/.test(m.text.trim()))?d(new Error("follow_only_profile"),"follow_only"):d(new Error("connect_button_not_found"),"no_connect")}await y(t,r.x+Math.round((r.w??80)/2),r.y+Math.round((r.h??36)/2));let l=null;for(let c=0;c<6&&(await h(c===0?1500:800),l=await pt(t),!l);c++);if(console.log("[connect] sendBtn:",l),!l){const c=await p(t);throw console.log("[connect] afterButtons:",c.map(a=>`"${a.text}" aria="${a.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await y(t,l.x+Math.round(l.w/2),l.y+Math.round(l.h/2)),await h(800),{sentAt:new Date().toISOString()}}catch(o){const s=o,r=await chrome.tabs.get(t).catch(()=>null);if(r!=null&&r.url&&(s.message=`${s.message} (url=${r.url})`),n&&s.code!=="already_pending"&&s.code!=="already_connected"&&s.code!=="checkpoint")try{const[l,c]=await Promise.all([$(t),p(t)]);s.screenshot=l,s.buttons=c}catch{}throw s}finally{n&&await S(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await M()}}async function E(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((n,i)=>{let o=!1;const s=a=>{o||(o=!0,clearTimeout(r),clearInterval(c),chrome.tabs.onUpdated.removeListener(l),a())},r=setTimeout(()=>s(()=>i(d(new Error("tab_load_timeout"),"tab_load"))),3e4),l=(a,f)=>{a===e&&f.status==="complete"&&s(n)};chrome.tabs.onUpdated.addListener(l);const c=setInterval(async()=>{const a=await chrome.tabs.get(e).catch(()=>null);if(!a)return s(()=>i(d(new Error("tab_closed"),"tab_load")));a.status==="complete"&&s(n)},1e3)})}function h(e){return new Promise(t=>setTimeout(t,e))}function d(e,t){return e.code=t,e}
