import{g as P,i as V,h as L,p as O,r as R}from"./api-BmYHn_yp.js";const D="modulepreload",N=function(t){return"/"+t},M={},U=function(e,n,r){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),i=(a==null?void 0:a.nonce)||(a==null?void 0:a.getAttribute("nonce"));o=Promise.allSettled(n.map(u=>{if(u=N(u),u in M)return;M[u]=!0;const d=u.endsWith(".css"),l=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${u}"]${l}`))return;const f=document.createElement("link");if(f.rel=d?"stylesheet":D,d||(f.as="script"),f.crossOrigin="",f.href=u,i&&f.setAttribute("nonce",i),document.head.appendChild(f),d)return new Promise((_,p)=>{f.addEventListener("load",_),f.addEventListener("error",()=>p(new Error(`Unable to preload CSS for ${u}`)))})}))}function c(a){const i=new Event("vite:preloadError",{cancelable:!0});if(i.payload=a,window.dispatchEvent(i),!i.defaultPrevented)throw a}return o.then(a=>{for(const i of a||[])i.status==="rejected"&&c(i.reason);return e().catch(c)})},$="1.3";async function E(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},$,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function v(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function s(t,e,n={}){return await new Promise((r,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,c=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):r(c)})})}async function b(t,e,n){await s(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await y(50),await s(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await y(50),await s(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function K(t,e){await s(t,"Input.insertText",{text:e})}async function W(t,e,n){await s(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await y(30),await s(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function A(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`(function() {
      // LinkedIn Message button is an <a> linking to /messaging/compose/
      const candidates = [
        ...document.querySelectorAll('a[href*="/messaging/compose/"]'),
        // fallback: any element with exact text "Message" in top 60% of page
        ...[...document.querySelectorAll('a,button,[role="button"]')].filter(el => {
          const t = el.textContent?.trim();
          return t === 'Message' || t === 'הודעה';
        }),
      ];
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.top < window.innerHeight * 0.65) {
          el.click();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      return null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function j(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function H(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function B(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function Y(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function g(t){var n;const e=await s(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<500)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function F(t){const e=await g(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await b(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await J(t),r=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return r?(await b(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0):!1}async function J(t){var n;const e=await s(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function X(t,e){var r;const n=await s(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)===!0}async function I(t,e){var c;const n=await s(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:r,h:o}=((c=n==null?void 0:n.result)==null?void 0:c.value)??{w:1440,h:900};await s(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(r/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function S(t){for(let e=0;e<5;e++)await s(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(50),await s(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await y(150)}async function T(t,e,n){var o;const r=await s(t,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=r==null?void 0:r.result)==null?void 0:o.value)===!0}async function q(t){return(await s(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function y(t){return new Promise(e=>setTimeout(e,t))}const z=Object.freeze(Object.defineProperty({__proto__:null,attach:E,click:b,clickMessageButton:A,clickModalClose:F,clickSendButton:B,closeAllComposeOverlays:S,detach:v,evalFindCompose:Y,focusCompose:H,getComposeCoords:j,insertTextIntoCompose:X,insertTextIntoNamedCompose:T,pressKey:W,scanButtons:g,scrollBy:I,send:s,takeScreenshot:q,typeText:K},Symbol.toStringTag,{value:"Module"})),G=30,Q=60,Z="0.2.0";let k=!1;chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:G/60}),chrome.alarms.create("hb",{periodInMinutes:Q/60})});chrome.alarms.onAlarm.addListener(async t=>{if(await P()&&!await V()){if(t.name==="hb"){await L(Z);return}if(t.name==="poll"){if(k){console.log("[poll] task already running, skipping");return}for(;await ee(););}}});async function ee(){let t;try{t=await O()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;k=!0;try{const e=await te(t);await R(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",r=e.screenshot,o=e.buttons;await R(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...r||o?{result:{debugScreenshot:r,buttons:o}}:{}})}finally{k=!1}return!0}async function te(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw h(new Error("missing_payload"),"bad_payload");return await ne(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw h(new Error("missing_payload"),"bad_payload");return await re(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw h(new Error("missing_payload"),"bad_payload");return await ae(e.profileUrl)}throw h(new Error("unknown_kind"),"bad_payload")}async function ne(t,e,n=""){var i;const r=await chrome.tabs.create({url:t,active:!0});if(!r.id)throw h(new Error("tab_create_failed"),"tab_load");const o=r.id;let c=!1,a=null;try{await x(o),await w(2500);const u=await chrome.tabs.get(o);u.windowId&&await chrome.windows.update(u.windowId,{focused:!0}),await w(300),await E(o),c=!0;const d=await(await U(async()=>{const{send:m}=await Promise.resolve().then(()=>z);return{send:m}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),l=((i=d==null?void 0:d.result)==null?void 0:i.value)??1;console.log("[agent] devicePixelRatio:",l),await chrome.scripting.executeScript({target:{tabId:o},func:m=>navigator.clipboard.writeText(m),args:[e]}),await w(200);const f=await S(o);f>0&&(console.log("[agent] closed",f,"existing compose overlay(s)"),await w(500));const _=await A(o);if(console.log("[agent] clickMessageButton:",_),!_)throw h(new Error("message_button_not_found"),"not_messageable");await x(o).catch(()=>{}),await w(2500);let p=!1;for(let m=0;m<6&&(p=await T(o,e,n),console.log(`[agent] insertTextIntoCompose attempt ${m+1}:`,p),!p);m++)await w(600);if(!p)throw h(new Error("compose_insert_failed"),"compose_insert_failed");await w(800);const C=await B(o);if(console.log("[agent] clickSendButton:",C),!C)throw h(new Error("send_button_not_found"),"send_button_not_found");return await w(1500),await S(o).catch(()=>{}),await w(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(u){if(a=u,c)try{const[d,l]=await Promise.all([q(o),g(o)]);a.screenshot=d,a.buttons=l}catch{}throw a}finally{c&&await v(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{})}}const oe=`(() => {
  const cards = Array.from(document.querySelectorAll('[data-chameleon-result-urn], li.reusable-search__result-container, div.search-results-container li'));
  const out = [];
  for (const card of cards) {
    const urn = card.getAttribute && card.getAttribute('data-chameleon-result-urn') || '';
    const link = card.querySelector('a[href*="/in/"]');
    const profileUrl = link ? link.href.split('?')[0] : '';
    const name = (card.querySelector('span[aria-hidden="true"]') && card.querySelector('span[aria-hidden="true"]').textContent || '').trim();
    const degEl = card.querySelector('.entity-result__badge-text, .artdeco-entity-lockup__degree, .entity-result__badge');
    const degreeRaw = degEl ? degEl.textContent : '';
    const m = degreeRaw.match(/(1st|2nd|3rd\\+?)/);
    const degree = m ? (m[1].indexOf('3') === 0 ? '3rd' : m[1]) : null;
    const subEl = card.querySelector('.entity-result__primary-subtitle, .artdeco-entity-lockup__subtitle');
    const subtitle = (subEl ? subEl.textContent : '').trim();
    const locEl = card.querySelector('.entity-result__secondary-subtitle, .artdeco-entity-lockup__caption');
    const location = (locEl ? locEl.textContent : '').trim() || null;
    let title = null, company = null;
    if (subtitle.indexOf(' at ') !== -1) { const p = subtitle.split(' at '); title = p[0].trim(); company = p.slice(1).join(' at ').trim(); }
    else { title = subtitle || null; }
    if (urn && profileUrl && name) out.push({ urn, profileUrl, name, title, company, location, degree });
  }
  const next = document.querySelector('button[aria-label="Next"]');
  const hasNextPage = !!next && !next.hasAttribute('disabled');
  return { candidates: out, hasNextPage };
})()`;async function re(t){var o;const e=await chrome.tabs.create({url:t,active:!0});if(!e.id)throw h(new Error("tab_create_failed"),"tab_load");const n=e.id;let r=!1;try{await x(n),await w(2500);const c=await chrome.tabs.get(n);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await w(300);const a=await chrome.tabs.get(n);if(a.url&&a.url.includes("/checkpoint"))throw h(new Error("checkpoint"),"checkpoint");await E(n),r=!0;for(let d=0;d<6;d++)await I(n,1200),await w(800);const i=await s(n,"Runtime.evaluate",{expression:oe,returnByValue:!0}),u=(o=i==null?void 0:i.result)==null?void 0:o.value;if(!u)throw h(new Error("scrape_returned_null"),"scrape_failed");return u}finally{r&&await v(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{})}}async function ae(t){const e=await chrome.tabs.create({url:t,active:!0});if(!e.id)throw h(new Error("tab_create_failed"),"tab_load");const n=e.id;let r=!1;try{await x(n),await w(2500);const o=await chrome.tabs.get(n);o.windowId&&await chrome.windows.update(o.windowId,{focused:!0}),await w(300);const c=await chrome.tabs.get(n);if(c.url&&c.url.includes("/checkpoint"))throw h(new Error("checkpoint"),"checkpoint");await E(n),r=!0;let a=await g(n),i=a.find(l=>/^connect$/i.test(l.text)||/^connect$/i.test(l.aria));if(!i){const l=a.find(f=>/^more$/i.test(f.text)||/^more$/i.test(f.aria));l&&(await b(n,l.x+Math.round(l.w/2),l.y+Math.round(l.h/2)),await w(700),a=await g(n),i=a.find(f=>/connect/i.test(f.text)||/connect/i.test(f.aria)))}if(!i)throw h(new Error("connect_button_not_found"),"no_connect");await b(n,i.x+Math.round(i.w/2),i.y+Math.round(i.h/2)),await w(900);const u=await g(n),d=u.find(l=>/send without a note/i.test(l.text)||/send without a note/i.test(l.aria))||u.find(l=>/^send$/i.test(l.text)||/^send$/i.test(l.aria));if(!d)throw h(new Error("send_dialog_not_found"),"already_or_blocked");return await b(n,d.x+Math.round(d.w/2),d.y+Math.round(d.h/2)),await w(800),{sentAt:new Date().toISOString()}}finally{r&&await v(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{})}}async function x(t){await new Promise((e,n)=>{const r=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(o),n(h(new Error("tab_load_timeout"),"tab_load"))},3e4),o=(c,a)=>{c===t&&a.status==="complete"&&(clearTimeout(r),chrome.tabs.onUpdated.removeListener(o),e())};chrome.tabs.onUpdated.addListener(o)})}function w(t){return new Promise(e=>setTimeout(e,t))}function h(t,e){return t.code=e,t}
