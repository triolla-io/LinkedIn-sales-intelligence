import{a as D,h as T,i as X,p as j,r as N}from"./api-IMK_rRYA.js";const z="modulepreload",J=function(t){return"/"+t},O={},Z=function(e,n,i){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),l=(a==null?void 0:a.nonce)||(a==null?void 0:a.getAttribute("nonce"));o=Promise.allSettled(n.map(c=>{if(c=J(c),c in O)return;O[c]=!0;const r=c.endsWith(".css"),f=r?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${f}`))return;const w=document.createElement("link");if(w.rel=r?"stylesheet":z,r||(w.as="script"),w.crossOrigin="",w.href=c,l&&w.setAttribute("nonce",l),document.head.appendChild(w),r)return new Promise((m,y)=>{w.addEventListener("load",m),w.addEventListener("error",()=>y(new Error(`Unable to preload CSS for ${c}`)))})}))}function s(a){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=a,window.dispatchEvent(l),!l.defaultPrevented)throw a}return o.then(a=>{for(const l of a||[])l.status==="rejected"&&s(l.reason);return e().catch(s)})},G="1.3",x="automationWindowId";async function U(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function K(){const e=(await chrome.storage.local.get(x))[x];if(e!==void 0&&await U(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[x]:n.id}),n.id}async function I(t){const e=await K(),n=await chrome.tabs.create({windowId:e,url:t,active:!0});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(e,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function W(){const e=(await chrome.storage.local.get(x))[x];e!==void 0&&!await U(e)&&await chrome.storage.local.remove(x)}async function k(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},G,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function S(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function u(t,e,n={}){return await new Promise((i,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,s=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):i(s)})})}async function b(t,e,n){await u(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await _(50),await u(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await _(50),await u(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function Q(t,e){await u(t,"Input.insertText",{text:e})}async function ee(t,e,n){await u(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await _(30),await u(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function C(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function te(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function ne(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function F(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function oe(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function g(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function ae(t){const e=await g(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await b(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await re(t),i=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return i?(await b(t,i.x+Math.round(i.w/2),i.y+Math.round(i.h/2)),!0):!1}async function re(t){var n;const e=await u(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function ie(t,e){var i;const n=await u(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((i=n==null?void 0:n.result)==null?void 0:i.value)===!0}async function Y(t,e){var s;const n=await u(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:i,h:o}=((s=n==null?void 0:n.result)==null?void 0:s.value)??{w:1440,h:900};await u(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(i/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function A(t){for(let e=0;e<5;e++)await u(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(50),await u(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await _(150)}async function H(t,e,n){var o;const i=await u(t,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=i==null?void 0:i.result)==null?void 0:o.value)===!0}async function q(t){return(await u(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function _(t){return new Promise(e=>setTimeout(e,t))}const ce=Object.freeze(Object.defineProperty({__proto__:null,attach:k,click:b,clickModalClose:ae,clickSendButton:F,closeAllComposeOverlays:A,closeStaleAutomationWindow:W,detach:S,evalFindCompose:oe,findMessageButton:C,focusCompose:ne,getAutomationWindow:K,getComposeCoords:te,insertTextIntoCompose:ie,insertTextIntoNamedCompose:H,openTabInAutomationWindow:I,pressKey:ee,scanButtons:g,scrollBy:Y,send:u,takeScreenshot:q,typeText:Q},Symbol.toStringTag,{value:"Module"})),se=`(() => {
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
})()`,le=30,ue=60,P="0.2.0";let B=!1;async function $(t){await chrome.storage.local.set({swActiveTabId:t})}async function M(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await W().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await M())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:le/60}),chrome.alarms.create("hb",{periodInMinutes:ue/60})});D().then(t=>{t&&T(P)});chrome.runtime.onMessage.addListener(t=>{(t==null?void 0:t.type)==="heartbeat"&&T(P)});chrome.alarms.onAlarm.addListener(async t=>{if(await D()&&!await X()){if(t.name==="hb"){await T(P);return}if(t.name==="poll"){if(B){console.log("[poll] task already running, skipping");return}for(;await de(););}}});async function de(){let t;try{t=await j()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;B=!0;try{const e=await fe(t);await N(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",i=e.screenshot,o=e.buttons;await N(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...i||o?{result:{debugScreenshot:i,buttons:o}}:{}})}finally{B=!1}return!0}async function fe(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw d(new Error("missing_payload"),"bad_payload");return await he(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await me(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await ge(e.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function he(t,e,n=""){var l;const i=await chrome.tabs.create({url:t,active:!0});if(!i.id)throw d(new Error("tab_create_failed"),"tab_load");const o=i.id;await $(o);let s=!1,a=null;try{await E(o),await h(2500);const c=await chrome.tabs.get(o);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await h(300);const r=await chrome.tabs.get(o);if(r.url&&r.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(o),s=!0;const f=await(await Z(async()=>{const{send:p}=await Promise.resolve().then(()=>ce);return{send:p}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),w=((l=f==null?void 0:f.result)==null?void 0:l.value)??1;console.log("[agent] devicePixelRatio:",w),await chrome.scripting.executeScript({target:{tabId:o},func:p=>navigator.clipboard.writeText(p),args:[e]}),await h(200),await A(o),await h(500);let m=await C(o);if(!m){const v=(await g(o)).find(R=>/^more$/i.test(R.text)||/^more$/i.test(R.aria)||/^עוד$/.test(R.text));v&&(await b(o,v.x+Math.round(v.w/2),v.y+Math.round(v.h/2)),await h(700),m=await C(o))}if(console.log("[agent] findMessageButton:",m),!m)throw d(new Error("message_button_not_found"),"not_messageable");await b(o,m.x,m.y),await E(o).catch(()=>{}),await h(2500);let y=!1;for(let p=0;p<6&&(y=await H(o,e,n),console.log(`[agent] insertTextIntoCompose attempt ${p+1}:`,y),!y);p++)await h(600);if(!y)throw d(new Error("compose_insert_failed"),"compose_insert_failed");await h(800);const L=await F(o);if(console.log("[agent] clickSendButton:",L),!L)throw d(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),await A(o).catch(()=>{}),await h(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(c){a=c;const r=await chrome.tabs.get(o).catch(()=>null);if(r!=null&&r.url&&(a.message=`${a.message} (url=${r.url})`),s)try{const[f,w]=await Promise.all([q(o),g(o)]);a.screenshot=f,a.buttons=w}catch{}throw a}finally{s&&await S(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{}),await M()}}const we=`(() => {
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
})()`;async function me(t){var i;const e=await I(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await $(e);let n=!1;try{await E(e),await h(2500);const o=await chrome.tabs.get(e);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(e),n=!0;for(let l=0;l<6;l++)await Y(e,1200),await h(800);const s=await u(e,"Runtime.evaluate",{expression:we,returnByValue:!0}),a=(i=s==null?void 0:s.result)==null?void 0:i.value;if(!a)throw d(new Error("scrape_returned_null"),"scrape_failed");return a}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await M()}}async function V(t,e){var i;const n=await u(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((i=n==null?void 0:n.result)==null?void 0:i.value)??null}async function pe(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function ge(t){var i;const e=await I(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await $(e);let n=!1;try{await E(e),await h(4e3);const o=await chrome.tabs.get(e);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await k(e),n=!0;const s=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let a=await V(e,s);if(console.log("[connect] directBtn:",a),!a){let c=await g(e);if(console.log("[connect] buttons found:",c.map(r=>`"${r.text}" aria="${r.aria}" y=${r.y}`)),a=c.find(r=>/^connect$/i.test(r.text)||/connect/i.test(r.aria))??null,!a){const r=c.find(f=>/^more$/i.test(f.text)||/^more$/i.test(f.aria));r&&(await b(e,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),await h(700),c=await g(e),console.log("[connect] buttons after More:",c.map(f=>`"${f.text}" aria="${f.aria}" y=${f.y}`)),a=c.find(f=>/^connect$/i.test(f.text)||/connect/i.test(f.aria))??null,a||(a=await V(e,s)))}}if(!a){const c=await u(e,"Runtime.evaluate",{expression:se,returnByValue:!0}),r=(i=c==null?void 0:c.result)==null?void 0:i.value;throw r==="pending"?d(new Error("invitation_already_pending"),"already_pending"):r==="connected"?d(new Error("already_connected"),"already_connected"):d(new Error("connect_button_not_found"),"no_connect")}await b(e,a.x+Math.round((a.w??80)/2),a.y+Math.round((a.h??36)/2));let l=null;for(let c=0;c<6&&(await h(c===0?1500:800),l=await pe(e),!l);c++);if(console.log("[connect] sendBtn:",l),!l){const c=await g(e);throw console.log("[connect] afterButtons:",c.map(r=>`"${r.text}" aria="${r.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await b(e,l.x+Math.round(l.w/2),l.y+Math.round(l.h/2)),await h(800),{sentAt:new Date().toISOString()}}catch(o){const s=o,a=await chrome.tabs.get(e).catch(()=>null);if(a!=null&&a.url&&(s.message=`${s.message} (url=${a.url})`),n&&s.code!=="already_pending"&&s.code!=="already_connected"&&s.code!=="checkpoint")try{const[l,c]=await Promise.all([q(e),g(e)]);s.screenshot=l,s.buttons=c}catch{}throw s}finally{n&&await S(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await M()}}async function E(t){const e=await chrome.tabs.get(t).catch(()=>null);(e==null?void 0:e.status)!=="complete"&&await new Promise((n,i)=>{let o=!1;const s=r=>{o||(o=!0,clearTimeout(a),clearInterval(c),chrome.tabs.onUpdated.removeListener(l),r())},a=setTimeout(()=>s(()=>i(d(new Error("tab_load_timeout"),"tab_load"))),3e4),l=(r,f)=>{r===t&&f.status==="complete"&&s(n)};chrome.tabs.onUpdated.addListener(l);const c=setInterval(async()=>{const r=await chrome.tabs.get(t).catch(()=>null);if(!r)return s(()=>i(d(new Error("tab_closed"),"tab_load")));r.status==="complete"&&s(n)},1e3)})}function h(t){return new Promise(e=>setTimeout(e,t))}function d(t,e){return t.code=e,t}
