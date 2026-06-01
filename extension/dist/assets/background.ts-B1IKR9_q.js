import{g as I,i as T,h as q,p as V,r as S}from"./api-BmYHn_yp.js";const L="modulepreload",D=function(t){return"/"+t},R={},O=function(e,n,o){let r=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));r=Promise.allSettled(n.map(l=>{if(l=D(l),l in R)return;R[l]=!0;const f=l.endsWith(".css"),g=f?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${g}`))return;const u=document.createElement("link");if(u.rel=f?"stylesheet":L,f||(u.as="script"),u.crossOrigin="",u.href=l,c&&u.setAttribute("nonce",c),document.head.appendChild(u),f)return new Promise((h,p)=>{u.addEventListener("load",h),u.addEventListener("error",()=>p(new Error(`Unable to preload CSS for ${l}`)))})}))}function s(i){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=i,window.dispatchEvent(c),!c.defaultPrevented)throw i}return r.then(i=>{for(const c of i||[])c.status==="rejected"&&s(c.reason);return e().catch(s)})},U="1.3";async function k(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},U,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function C(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function a(t,e,n={}){return await new Promise((o,r)=>{chrome.debugger.sendCommand({tabId:t},e,n,s=>{chrome.runtime.lastError?r(new Error(chrome.runtime.lastError.message)):o(s)})})}async function b(t,e,n){await a(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await v(50),await a(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await v(50),await a(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function K(t,e){await a(t,"Input.insertText",{text:e})}async function N(t,e,n){await a(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await v(30),await a(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function M(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function $(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function j(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function _(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<500)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function H(t){const e=await _(t);for(const r of e)if(/^(dismiss|close|cancel)$/i.test(r.aria)||/artdeco-modal__dismiss/i.test(r.cls)||/dismiss/i.test(r.cls)||r.text==="×"||r.text==="✕"||r.text==="✖")return await b(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0;const n=await Y(t),o=e.find(r=>r.w<50&&r.h<50&&r.y<300&&r.x>n*.4);return o?(await b(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0):!1}async function Y(t){var n;const e=await a(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function A(t,e){var o;const n=await a(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((o=n==null?void 0:n.result)==null?void 0:o.value)===!0}async function X(t,e){var s;const n=await a(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:o,h:r}=((s=n==null?void 0:n.result)==null?void 0:s.value)??{w:1440,h:900};await a(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(o/2),y:Math.round(r/2),deltaX:0,deltaY:e})}async function y(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
      let closed = 0;
      function closeInRoot(root) {
        for (const el of root.querySelectorAll('button')) {
          const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();
          if (aria === 'dismiss' || aria === 'close' || aria.includes('close compose')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) { el.click(); closed++; }
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) closeInRoot(el.shadowRoot);
        }
      }
      closeInRoot(document);
      return closed;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??0}async function P(t){return(await a(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function v(t){return new Promise(e=>setTimeout(e,t))}const F=Object.freeze(Object.defineProperty({__proto__:null,attach:k,click:b,clickMessageButton:M,clickModalClose:H,clickSendButton:B,closeAllComposeOverlays:y,detach:C,evalFindCompose:j,focusCompose:$,getComposeCoords:W,insertTextIntoCompose:A,pressKey:N,scanButtons:_,scrollBy:X,send:a,takeScreenshot:P,typeText:K},Symbol.toStringTag,{value:"Module"})),z=30,J=60,G="0.2.0";let x=!1;chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:z/60}),chrome.alarms.create("hb",{periodInMinutes:J/60})});chrome.alarms.onAlarm.addListener(async t=>{if(await I()&&!await T()){if(t.name==="hb"){await q(G);return}if(t.name==="poll"){if(x){console.log("[poll] task already running, skipping");return}for(;await Q(););}}});async function Q(){let t;try{t=await V()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;x=!0;try{const e=await Z(t);await S(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",o=e.screenshot,r=e.buttons;await S(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...o||r?{result:{debugScreenshot:o,buttons:r}}:{}})}finally{x=!1}return!0}async function Z(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw w(new Error("missing_payload"),"bad_payload");return await ee(e.linkedinUrl,e.text)}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};throw w(new Error("unknown_kind"),"bad_payload")}async function ee(t,e){var i;const n=await chrome.tabs.create({url:t,active:!0});if(!n.id)throw w(new Error("tab_create_failed"),"tab_load");const o=n.id;let r=!1,s=null;try{await E(o),await d(2500);const c=await chrome.tabs.get(o);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await d(300),await k(o),r=!0;const l=await(await O(async()=>{const{send:m}=await Promise.resolve().then(()=>F);return{send:m}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),f=((i=l==null?void 0:l.result)==null?void 0:i.value)??1;console.log("[agent] devicePixelRatio:",f),await chrome.scripting.executeScript({target:{tabId:o},func:m=>navigator.clipboard.writeText(m),args:[e]}),await d(200);const g=await y(o);g>0&&(console.log("[agent] closed",g,"existing compose overlay(s)"),await d(500));const u=await M(o);if(console.log("[agent] clickMessageButton:",u),!u)throw w(new Error("message_button_not_found"),"not_messageable");await E(o).catch(()=>{}),await d(2500);let h=!1;for(let m=0;m<6&&(h=await A(o,e),console.log(`[agent] insertTextIntoCompose attempt ${m+1}:`,h),!h);m++)await d(600);if(!h)throw w(new Error("compose_insert_failed"),"compose_insert_failed");await d(800);const p=await B(o);if(console.log("[agent] clickSendButton:",p),!p)throw w(new Error("send_button_not_found"),"send_button_not_found");return await d(1500),await y(o).catch(()=>{}),await d(300),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(c){if(s=c,r)try{const[l,f]=await Promise.all([P(o),_(o)]);s.screenshot=l,s.buttons=f}catch{}throw s}finally{r&&await C(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{})}}async function E(t){await new Promise((e,n)=>{const o=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(r),n(w(new Error("tab_load_timeout"),"tab_load"))},3e4),r=(s,i)=>{s===t&&i.status==="complete"&&(clearTimeout(o),chrome.tabs.onUpdated.removeListener(r),e())};chrome.tabs.onUpdated.addListener(r)})}function d(t){return new Promise(e=>setTimeout(e,t))}function w(t,e){return t.code=e,t}
