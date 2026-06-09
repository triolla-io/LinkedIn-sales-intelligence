import{a as $,h as V,i as K,p as W,r as I}from"./api-IMK_rRYA.js";const H="modulepreload",X=function(t){return"/"+t},P={},Y=function(e,n,r){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),d=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));o=Promise.allSettled(n.map(a=>{if(a=X(a),a in P)return;P[a]=!0;const f=a.endsWith(".css"),p=f?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${a}"]${p}`))return;const l=document.createElement("link");if(l.rel=f?"stylesheet":H,f||(l.as="script"),l.crossOrigin="",l.href=a,d&&l.setAttribute("nonce",d),document.head.appendChild(l),f)return new Promise((s,m)=>{l.addEventListener("load",s),l.addEventListener("error",()=>m(new Error(`Unable to preload CSS for ${a}`)))})}))}function u(i){const d=new Event("vite:preloadError",{cancelable:!0});if(d.payload=i,window.dispatchEvent(d),!d.defaultPrevented)throw i}return o.then(i=>{for(const d of i||[])d.status==="rejected"&&u(d.reason);return e().catch(u)})},j="1.3";async function E(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},j,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function M(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function c(t,e,n={}){return await new Promise((r,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,u=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):r(u)})})}async function g(t,e,n){await c(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await v(50),await c(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await v(50),await c(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function F(t,e){await c(t,"Input.insertText",{text:e})}async function J(t,e,n){await c(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await v(30),await c(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function C(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function z(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function Z(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function L(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function G(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function y(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function Q(t){const e=await y(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await g(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await ee(t),r=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return r?(await g(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0):!1}async function ee(t){var n;const e=await c(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function te(t,e){var r;const n=await c(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)===!0}async function N(t,e){var u;const n=await c(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:r,h:o}=((u=n==null?void 0:n.result)==null?void 0:u.value)??{w:1440,h:900};await c(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(r/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function R(t){for(let e=0;e<5;e++)await c(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await v(50),await c(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await v(150)}async function O(t,e,n){var o;const r=await c(t,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=r==null?void 0:r.result)==null?void 0:o.value)===!0}async function U(t){return(await c(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function v(t){return new Promise(e=>setTimeout(e,t))}const ne=Object.freeze(Object.defineProperty({__proto__:null,attach:E,click:g,clickModalClose:Q,clickSendButton:L,closeAllComposeOverlays:R,detach:M,evalFindCompose:G,findMessageButton:C,focusCompose:Z,getComposeCoords:z,insertTextIntoCompose:te,insertTextIntoNamedCompose:O,pressKey:J,scanButtons:y,scrollBy:N,send:c,takeScreenshot:U,typeText:F},Symbol.toStringTag,{value:"Module"})),oe=30,re=60,D="0.2.0";let A=!1;async function B(t){await chrome.storage.local.set({swActiveTabId:t})}async function S(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await S())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:oe/60}),chrome.alarms.create("hb",{periodInMinutes:re/60})});$().then(t=>{t&&V(D)});chrome.alarms.onAlarm.addListener(async t=>{if(await $()&&!await K()){if(t.name==="hb"){await V(D);return}if(t.name==="poll"){if(A){console.log("[poll] task already running, skipping");return}for(;await ae(););}}});async function ae(){let t;try{t=await W()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;A=!0;try{const e=await ie(t);await I(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",r=e.screenshot,o=e.buttons;await I(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...r||o?{result:{debugScreenshot:r,buttons:o}}:{}})}finally{A=!1}return!0}async function ie(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw w(new Error("missing_payload"),"bad_payload");return await se(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw w(new Error("missing_payload"),"bad_payload");return await le(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw w(new Error("missing_payload"),"bad_payload");return await ue(e.profileUrl)}throw w(new Error("unknown_kind"),"bad_payload")}async function se(t,e,n=""){var d;const r=await chrome.tabs.create({url:t,active:!0});if(!r.id)throw w(new Error("tab_create_failed"),"tab_load");const o=r.id;await B(o);let u=!1,i=null;try{await _(o),await h(2500);const a=await chrome.tabs.get(o);a.windowId&&await chrome.windows.update(a.windowId,{focused:!0}),await h(300);const f=await chrome.tabs.get(o);if(f.url&&f.url.includes("/checkpoint"))throw w(new Error("checkpoint"),"checkpoint");await E(o),u=!0;const p=await(await Y(async()=>{const{send:b}=await Promise.resolve().then(()=>ne);return{send:b}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),l=((d=p==null?void 0:p.result)==null?void 0:d.value)??1;console.log("[agent] devicePixelRatio:",l),await chrome.scripting.executeScript({target:{tabId:o},func:b=>navigator.clipboard.writeText(b),args:[e]}),await h(200),await R(o),await h(500);let s=await C(o);if(!s){const x=(await y(o)).find(k=>/^more$/i.test(k.text)||/^more$/i.test(k.aria)||/^עוד$/.test(k.text));x&&(await g(o,x.x+Math.round(x.w/2),x.y+Math.round(x.h/2)),await h(700),s=await C(o))}if(console.log("[agent] findMessageButton:",s),!s)throw w(new Error("message_button_not_found"),"not_messageable");await g(o,s.x,s.y),await _(o).catch(()=>{}),await h(2500);let m=!1;for(let b=0;b<6&&(m=await O(o,e,n),console.log(`[agent] insertTextIntoCompose attempt ${b+1}:`,m),!m);b++)await h(600);if(!m)throw w(new Error("compose_insert_failed"),"compose_insert_failed");await h(800);const T=await L(o);if(console.log("[agent] clickSendButton:",T),!T)throw w(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),await R(o).catch(()=>{}),await h(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(a){i=a;const f=await chrome.tabs.get(o).catch(()=>null);if(f!=null&&f.url&&(i.message=`${i.message} (url=${f.url})`),u)try{const[p,l]=await Promise.all([U(o),y(o)]);i.screenshot=p,i.buttons=l}catch{}throw i}finally{u&&await M(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{}),await S()}}const ce=`(() => {
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
    const name = nameRaw.replace(/\\s*•\\s*(1st|2nd|3rd\\+?).*/, '').replace(/\\s*★.*/, '').trim();
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
})()`;async function le(t){var o;const e=await chrome.tabs.create({url:t,active:!0});if(!e.id)throw w(new Error("tab_create_failed"),"tab_load");const n=e.id;await B(n);let r=!1;try{await _(n),await h(2500);const u=await chrome.tabs.get(n);u.windowId&&await chrome.windows.update(u.windowId,{focused:!0}),await h(300);const i=await chrome.tabs.get(n);if(i.url&&i.url.includes("/checkpoint"))throw w(new Error("checkpoint"),"checkpoint");await E(n),r=!0;for(let f=0;f<6;f++)await N(n,1200),await h(800);const d=await c(n,"Runtime.evaluate",{expression:ce,returnByValue:!0}),a=(o=d==null?void 0:d.result)==null?void 0:o.value;if(!a)throw w(new Error("scrape_returned_null"),"scrape_failed");return a}finally{r&&await M(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await S()}}async function q(t){var n;const e=await c(t,"Runtime.evaluate",{expression:`(() => {
      const selectors = [
        'button[aria-label*="connect" i]',
        'button[aria-label*="invite" i]',
        'a[aria-label*="connect" i]',
        'a[aria-label*="invite" i]',
        'a[href*="custom-invite"]',
        'a[href*="preload/custom-invite"]',
      ];
      for (const sel of selectors) {
        const els = [...document.querySelectorAll(sel)];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), label: el.getAttribute('aria-label') };
          }
        }
      }
      return null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function ue(t){var o;const e=await chrome.tabs.create({url:t,active:!0});if(!e.id)throw w(new Error("tab_create_failed"),"tab_load");const n=e.id;await B(n);let r=!1;try{await _(n),await h(4e3);const u=await chrome.tabs.get(n);u.windowId&&await chrome.windows.update(u.windowId,{focused:!0}),await h(300);const i=await chrome.tabs.get(n);if(i.url&&i.url.includes("/checkpoint"))throw w(new Error("checkpoint"),"checkpoint");await E(n),r=!0;const d=await q(n);console.log("[connect] directBtn:",d);let a=d;if(!a){let l=await y(n);if(console.log("[connect] buttons found:",l.map(s=>`"${s.text}" aria="${s.aria}" y=${s.y}`)),a=l.find(s=>/^connect$/i.test(s.text)||/connect/i.test(s.aria))??null,!a){const s=l.find(m=>/^more$/i.test(m.text)||/^more$/i.test(m.aria));s&&(await g(n,s.x+Math.round(s.w/2),s.y+Math.round(s.h/2)),await h(700),l=await y(n),console.log("[connect] buttons after More:",l.map(m=>`"${m.text}" aria="${m.aria}" y=${m.y}`)),a=l.find(m=>/^connect$/i.test(m.text)||/connect/i.test(m.aria))??null,a||(a=await q(n)))}}if(!a)throw w(new Error("connect_button_not_found"),"no_connect");await g(n,a.x+Math.round((a.w??80)/2),a.y+Math.round((a.h??36)/2)),await h(1500);const f=await c(n,"Runtime.evaluate",{expression:`(() => {
        const patterns = [/send without/i, /שלח ללא/i, /^send$/i, /^שלח$/i];
        const btns = [...document.querySelectorAll('button,[role="button"]')];
        for (const b of btns) {
          const t = (b.textContent || '').trim();
          const a = b.getAttribute('aria-label') || '';
          if (patterns.some(p => p.test(t) || p.test(a))) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
          }
        }
        return null;
      })()`,returnByValue:!0}),p=(o=f==null?void 0:f.result)==null?void 0:o.value;if(console.log("[connect] sendBtn direct:",p),!p){const l=await y(n);throw console.log("[connect] afterButtons:",l.map(s=>`"${s.text}" aria="${s.aria}"`)),w(new Error("send_dialog_not_found"),"already_or_blocked")}return await g(n,p.x+Math.round(p.w/2),p.y+Math.round(p.h/2)),await h(800),{sentAt:new Date().toISOString()}}finally{r&&await M(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await S()}}async function _(t){await new Promise((e,n)=>{const r=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(o),n(w(new Error("tab_load_timeout"),"tab_load"))},3e4),o=(u,i)=>{u===t&&i.status==="complete"&&(clearTimeout(r),chrome.tabs.onUpdated.removeListener(o),e())};chrome.tabs.onUpdated.addListener(o)})}function h(t){return new Promise(e=>setTimeout(e,t))}function w(t,e){return t.code=e,t}
