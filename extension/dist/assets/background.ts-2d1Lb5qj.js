import{g as B,i as P,h as A,p as I,r as v}from"./api-BmYHn_yp.js";const T="modulepreload",V=function(t){return"/"+t},x={},q=function(e,n,r){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));o=Promise.allSettled(n.map(u=>{if(u=V(u),u in x)return;x[u]=!0;const f=u.endsWith(".css"),w=f?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${u}"]${w}`))return;const l=document.createElement("link");if(l.rel=f?"stylesheet":T,f||(l.as="script"),l.crossOrigin="",l.href=u,c&&l.setAttribute("nonce",c),document.head.appendChild(l),f)return new Promise((b,d)=>{l.addEventListener("load",b),l.addEventListener("error",()=>d(new Error(`Unable to preload CSS for ${u}`)))})}))}function s(i){const c=new Event("vite:preloadError",{cancelable:!0});if(c.payload=i,window.dispatchEvent(c),!c.defaultPrevented)throw i}return o.then(i=>{for(const c of i||[])c.status==="rejected"&&s(c.reason);return e().catch(s)})},L="1.3";async function S(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},L,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function E(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function a(t,e,n={}){return await new Promise((r,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,s=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):r(s)})})}async function p(t,e,n){await a(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await g(50),await a(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await g(50),await a(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function D(t,e){await a(t,"Input.insertText",{text:e})}async function O(t,e,n){await a(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await g(30),await a(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function R(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function U(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function K(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function C(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function N(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function y(t){var n;const e=await a(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}}).filter(b=>b.w>0&&b.h>0&&b.y<500)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}async function W(t){const e=await y(t);for(const o of e)if(/^(dismiss|close|cancel)$/i.test(o.aria)||/artdeco-modal__dismiss/i.test(o.cls)||/dismiss/i.test(o.cls)||o.text==="×"||o.text==="✕"||o.text==="✖")return await p(t,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0;const n=await $(t),r=e.find(o=>o.w<50&&o.h<50&&o.y<300&&o.x>n*.4);return r?(await p(t,r.x+Math.round(r.w/2),r.y+Math.round(r.h/2)),!0):!1}async function $(t){var n;const e=await a(t,"Runtime.evaluate",{expression:"window.innerWidth",returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??1440}async function k(t,e){var r;const n=await a(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((r=n==null?void 0:n.result)==null?void 0:r.value)===!0}async function j(t,e){var s;const n=await a(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:r,h:o}=((s=n==null?void 0:n.result)==null?void 0:s.value)??{w:1440,h:900};await a(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(r/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function M(t){return(await a(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function g(t){return new Promise(e=>setTimeout(e,t))}const H=Object.freeze(Object.defineProperty({__proto__:null,attach:S,click:p,clickMessageButton:R,clickModalClose:W,clickSendButton:C,detach:E,evalFindCompose:N,focusCompose:K,getComposeCoords:U,insertTextIntoCompose:k,pressKey:O,scanButtons:y,scrollBy:j,send:a,takeScreenshot:M,typeText:D},Symbol.toStringTag,{value:"Module"})),Y=30,X=60,F="0.2.0";chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:Y/60}),chrome.alarms.create("hb",{periodInMinutes:X/60})});chrome.alarms.onAlarm.addListener(async t=>{if(await B()&&!await P()){if(t.name==="hb"){await A(F);return}t.name==="poll"&&await z()}});async function z(){let t;try{t=await I()}catch(e){console.warn("poll error",e);return}if(t)try{const e=await J(t);await v(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",r=e.screenshot,o=e.buttons;await v(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...r||o?{result:{debugScreenshot:r,buttons:o}}:{}})}}async function J(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw h(new Error("missing_payload"),"bad_payload");return await G(e.linkedinUrl,e.text)}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};throw h(new Error("unknown_kind"),"bad_payload")}async function G(t,e){var i;const n=await chrome.tabs.create({url:t,active:!0});if(!n.id)throw h(new Error("tab_create_failed"),"tab_load");const r=n.id;let o=!1,s=null;try{await _(r),await m(2500);const c=await chrome.tabs.get(r);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await m(300),await S(r),o=!0;const u=await(await q(async()=>{const{send:d}=await Promise.resolve().then(()=>H);return{send:d}},void 0)).send(r,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),f=((i=u==null?void 0:u.result)==null?void 0:i.value)??1;console.log("[agent] devicePixelRatio:",f),await chrome.scripting.executeScript({target:{tabId:r},func:d=>navigator.clipboard.writeText(d),args:[e]}),await m(200);const w=await R(r);if(console.log("[agent] clickMessageButton:",w),!w)throw h(new Error("message_button_not_found"),"not_messageable");await _(r).catch(()=>{}),await m(2500);let l=!1;for(let d=0;d<6&&(l=await k(r,e),console.log(`[agent] insertTextIntoCompose attempt ${d+1}:`,l),!l);d++)await m(600);if(!l)throw h(new Error("compose_insert_failed"),"compose_insert_failed");await m(800);const b=await C(r);if(console.log("[agent] clickSendButton:",b),!b)throw h(new Error("send_button_not_found"),"send_button_not_found");return await m(1500),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(c){if(s=c,o)try{const[u,f]=await Promise.all([M(r),y(r)]);s.screenshot=u,s.buttons=f}catch{}throw s}finally{o&&await E(r).catch(()=>{}),await chrome.tabs.remove(r).catch(()=>{})}}async function _(t){await new Promise((e,n)=>{const r=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(o),n(h(new Error("tab_load_timeout"),"tab_load"))},3e4),o=(s,i)=>{s===t&&i.status==="complete"&&(clearTimeout(r),chrome.tabs.onUpdated.removeListener(o),e())};chrome.tabs.onUpdated.addListener(o)})}function m(t){return new Promise(e=>setTimeout(e,t))}function h(t,e){return t.code=e,t}
