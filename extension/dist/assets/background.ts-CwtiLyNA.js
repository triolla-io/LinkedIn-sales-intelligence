import{g as I,i as V,h as L,p as q,r as C}from"./api-BmYHn_yp.js";const D="modulepreload",O=function(t){return"/"+t},S={},K=function(e,n,r){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));o=Promise.allSettled(n.map(l=>{if(l=O(l),l in S)return;S[l]=!0;const d=l.endsWith(".css"),p=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${p}`))return;const u=document.createElement("link");if(u.rel=d?"stylesheet":D,d||(u.as="script"),u.crossOrigin="",u.href=l,c&&u.setAttribute("nonce",c),document.head.appendChild(u),d)return new Promise((b,w)=>{u.addEventListener("load",b),u.addEventListener("error",()=>w(new Error(`Unable to preload CSS for ${l}`)))})}))}function s(i){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=i,window.dispatchEvent(c),!c.defaultPrevented)throw i}return o.then(i=>{for(const c of i||[])c.status==="rejected"&&s(c.reason);return e().catch(s)})},N="1.3";async function R(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},N,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function M(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function a(t,e,n={}){return await new Promise((r,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,s=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):r(s)})})}async function y(t,e,n){await a(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await g(50),await a(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await g(50),await a(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function U(t,e){await a(t,"Input.insertText",{text:e})}async function $(t,e,n){await a(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await g(30),await a(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function A(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function W(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function j(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function B(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function H(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function E(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<500)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function Y(t){const e=await E(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await y(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await J(t),r=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return r?(await y(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0):!1}async function J(t){var n;const e=await a(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function X(t,e){var r;const n=await a(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)===!0}async function F(t,e){var s;const n=await a(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:r,h:o}=((s=n==null?void 0:n.result)==null?void 0:s.value)??{w:1440,h:900};await a(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(r/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function v(t){for(let e=0;e<5;e++)await a(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await g(50),await a(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await g(150)}async function T(t,e,n){var o;const r=await a(t,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=r==null?void 0:r.result)==null?void 0:o.value)===!0}async function P(t){return(await a(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function g(t){return new Promise(e=>setTimeout(e,t))}const z=Object.freeze(Object.defineProperty({__proto__:null,attach:R,click:y,clickMessageButton:A,clickModalClose:Y,clickSendButton:B,closeAllComposeOverlays:v,detach:M,evalFindCompose:H,focusCompose:j,getComposeCoords:W,insertTextIntoCompose:X,insertTextIntoNamedCompose:T,pressKey:$,scanButtons:E,scrollBy:F,send:a,takeScreenshot:P,typeText:U},Symbol.toStringTag,{value:"Module"})),G=30,Q=60,Z="0.2.0";let x=!1;chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:G/60}),chrome.alarms.create("hb",{periodInMinutes:Q/60})});chrome.alarms.onAlarm.addListener(async t=>{if(await I()&&!await V()){if(t.name==="hb"){await L(Z);return}if(t.name==="poll"){if(x){console.log("[poll] task already running, skipping");return}for(;await ee(););}}});async function ee(){let t;try{t=await q()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;x=!0;try{const e=await te(t);await C(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",r=e.screenshot,o=e.buttons;await C(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...r||o?{result:{debugScreenshot:r,buttons:o}}:{}})}finally{x=!1}return!0}async function te(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw h(new Error("missing_payload"),"bad_payload");return await ne(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};throw h(new Error("unknown_kind"),"bad_payload")}async function ne(t,e,n=""){var c;const r=await chrome.tabs.create({url:t,active:!0});if(!r.id)throw h(new Error("tab_create_failed"),"tab_load");const o=r.id;let s=!1,i=null;try{await k(o),await f(2500);const l=await chrome.tabs.get(o);l.windowId&&await chrome.windows.update(l.windowId,{focused:!0}),await f(300),await R(o),s=!0;const d=await(await K(async()=>{const{send:m}=await Promise.resolve().then(()=>z);return{send:m}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),p=((c=d==null?void 0:d.result)==null?void 0:c.value)??1;console.log("[agent] devicePixelRatio:",p),await chrome.scripting.executeScript({target:{tabId:o},func:m=>navigator.clipboard.writeText(m),args:[e]}),await f(200);const u=await v(o);u>0&&(console.log("[agent] closed",u,"existing compose overlay(s)"),await f(500));const b=await A(o);if(console.log("[agent] clickMessageButton:",b),!b)throw h(new Error("message_button_not_found"),"not_messageable");await k(o).catch(()=>{}),await f(2500);let w=!1;for(let m=0;m<6&&(w=await T(o,e,n),console.log(`[agent] insertTextIntoCompose attempt ${m+1}:`,w),!w);m++)await f(600);if(!w)throw h(new Error("compose_insert_failed"),"compose_insert_failed");await f(800);const _=await B(o);if(console.log("[agent] clickSendButton:",_),!_)throw h(new Error("send_button_not_found"),"send_button_not_found");return await f(1500),await v(o).catch(()=>{}),await f(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(l){if(i=l,s)try{const[d,p]=await Promise.all([P(o),E(o)]);i.screenshot=d,i.buttons=p}catch{}throw i}finally{s&&await M(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{})}}async function k(t){await new Promise((e,n)=>{const r=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(o),n(h(new Error("tab_load_timeout"),"tab_load"))},3e4),o=(s,i)=>{s===t&&i.status==="complete"&&(clearTimeout(r),chrome.tabs.onUpdated.removeListener(o),e())};chrome.tabs.onUpdated.addListener(o)})}function f(t){return new Promise(e=>setTimeout(e,t))}function h(t,e){return t.code=e,t}
