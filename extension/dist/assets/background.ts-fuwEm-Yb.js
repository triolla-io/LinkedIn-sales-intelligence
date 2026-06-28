import{a as O,h as A,i as G,p as Z,r as N}from"./api-IMK_rRYA.js";const Q="modulepreload",ee=function(t){return"/"+t},L={},te=function(e,n,a){let o=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const r=document.querySelector("meta[property=csp-nonce]"),s=(r==null?void 0:r.nonce)||(r==null?void 0:r.getAttribute("nonce"));o=Promise.allSettled(n.map(c=>{if(c=ee(c),c in L)return;L[c]=!0;const i=c.endsWith(".css"),f=i?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${f}`))return;const m=document.createElement("link");if(m.rel=i?"stylesheet":Q,i||(m.as="script"),m.crossOrigin="",m.href=c,s&&m.setAttribute("nonce",s),document.head.appendChild(m),i)return new Promise((q,p)=>{m.addEventListener("load",q),m.addEventListener("error",()=>p(new Error(`Unable to preload CSS for ${c}`)))})}))}function l(r){const s=new Event("vite:preloadError",{cancelable:!0});if(s.payload=r,window.dispatchEvent(s),!s.defaultPrevented)throw r}return o.then(r=>{for(const s of r||[])s.status==="rejected"&&l(s.reason);return e().catch(l)})},ne="1.3",g="automationWindowId";async function V(t){try{return await chrome.windows.get(t),!0}catch{return!1}}async function U(){const e=(await chrome.storage.local.get(g))[g];if(e!==void 0&&await V(e))return e;e!==void 0&&await chrome.windows.remove(e).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[g]:n.id}),n.id}async function M(t){const e=await U(),n=await chrome.tabs.create({windowId:e,url:t,active:!0});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(e,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function K(){const e=(await chrome.storage.local.get(g))[g];e!==void 0&&!await V(e)&&await chrome.storage.local.remove(g)}async function _(t){await new Promise((e,n)=>{chrome.debugger.attach({tabId:t},ne,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):e()})})}async function E(t){await new Promise(e=>{chrome.debugger.detach({tabId:t},()=>{chrome.runtime.lastError,e()})})}async function u(t,e,n={}){return await new Promise((a,o)=>{chrome.debugger.sendCommand({tabId:t},e,n,l=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):a(l)})})}async function y(t,e,n){await u(t,"Input.dispatchMouseEvent",{type:"mouseMoved",x:e,y:n,button:"none",buttons:0}),await x(50),await u(t,"Input.dispatchMouseEvent",{type:"mousePressed",x:e,y:n,button:"left",buttons:1,clickCount:1}),await x(50),await u(t,"Input.dispatchMouseEvent",{type:"mouseReleased",x:e,y:n,button:"left",buttons:0,clickCount:1})}async function oe(t,e){await u(t,"Input.insertText",{text:e})}async function ae(t,e,n){await u(t,"Input.dispatchKeyEvent",{type:"keyDown",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n}),await x(30),await u(t,"Input.dispatchKeyEvent",{type:"keyUp",key:e,code:e,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})}async function re(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function ie(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{ok:!1}}async function le(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function W(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function F(t,e){var a;const n=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await u(t,"Input.insertText",{text:e}),!0):!1}async function R(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??{diag:"eval_failed"}}async function Y(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)===!0}async function ce(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(function() {
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
      })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}const se='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function w(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${se}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??[]}function H(t){for(const e of t)if(/^(dismiss|close|cancel)$/i.test(e.aria)||/artdeco-modal__dismiss/i.test(e.cls)||/dismiss/i.test(e.cls)||e.text==="×"||e.text==="✕"||e.text==="✖")return e;return t.find(e=>e.inModal&&e.w<50&&e.h<50)??null}async function J(t){const e=await w(t),n=H(e);return n?(await y(t,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function ue(t,e){var a;const n=await u(t,"Runtime.evaluate",{expression:`(function(txt) {
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
    })(${JSON.stringify(e)})`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)===!0}async function X(t,e){var l;const n=await u(t,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:o}=((l=n==null?void 0:n.result)==null?void 0:l.value)??{w:1440,h:900};await u(t,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(o/2),deltaX:0,deltaY:e})}async function j(t){for(let e=0;e<5;e++)await u(t,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await x(50),await u(t,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await x(150)}async function de(t,e,n){var o;const a=await u(t,"Runtime.evaluate",{expression:`(function(txt, name) {
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
    })(${JSON.stringify(e)}, ${JSON.stringify(n)})`,returnByValue:!0});return((o=a==null?void 0:a.result)==null?void 0:o.value)===!0}async function B(t){return(await u(t,"Page.captureScreenshot",{format:"png",quality:80})).data}function x(t){return new Promise(e=>setTimeout(e,t))}const fe=Object.freeze(Object.defineProperty({__proto__:null,attach:_,click:y,clickModalClose:J,clickSendButton:Y,closeAllComposeOverlays:j,closeStaleAutomationWindow:K,composeDiag:R,detach:E,evalFindCompose:ce,findMessageButton:re,focusCompose:le,getAutomationWindow:U,getComposeCoords:ie,getComposeUrl:W,insertTextIntoCompose:ue,insertTextIntoNamedCompose:de,openTabInAutomationWindow:M,pickCloseButton:H,pressKey:ae,scanButtons:w,scrollBy:X,send:u,takeScreenshot:B,typeIntoCompose:F,typeText:oe},Symbol.toStringTag,{value:"Module"})),he=`(() => {
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
})()`,me=30,we=60,T="0.2.2";let C=!1;async function I(t){await chrome.storage.local.set({swActiveTabId:t})}async function S(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await K().catch(()=>{});const{swActiveTabId:t}=await chrome.storage.local.get("swActiveTabId");t&&(console.log("[startup] closing orphaned tab",t),await chrome.tabs.remove(t).catch(()=>{}),await S())}catch(t){console.warn("[startup] cleanup error",t)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:me/60}),chrome.alarms.create("hb",{periodInMinutes:we/60})});O().then(t=>{t&&A(T)});chrome.runtime.onMessage.addListener(t=>{(t==null?void 0:t.type)==="heartbeat"&&A(T)});chrome.alarms.onAlarm.addListener(async t=>{if(await O()&&!await G()){if(t.name==="hb"){await A(T);return}if(t.name==="poll"){if(C){console.log("[poll] task already running, skipping");return}for(;await ge(););}}});async function ge(){let t;try{t=await Z()}catch(e){return console.warn("poll error",e),!1}if(!t)return!1;C=!0;try{const e=await pe(t);await N(t.id,{ok:!0,result:e})}catch(e){const n=e.code??"unknown",a=e.screenshot,o=e.buttons,l=e.diag;await N(t.id,{ok:!1,errorCode:n,errorMessage:e.message,...a||o||l?{result:{debugScreenshot:a,buttons:o,diag:l}}:{}})}finally{C=!1}return!0}async function pe(t){const e=t.payload;if(t.kind==="SEND"){if(!e.linkedinUrl||!e.text)throw d(new Error("missing_payload"),"bad_payload");return await ye(e.linkedinUrl,e.text,e.recipientName??"")}if(t.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(t.kind==="SEARCH"){if(!e.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await xe(e.searchUrl)}if(t.kind==="CONNECT"){if(!e.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await Ee(e.profileUrl)}throw d(new Error("unknown_kind"),"bad_payload")}async function be(t){var n;const e={};try{const a=await chrome.tabs.get(t);e.tabUrl=a.url??null,e.tabStatus=a.status??null,e.tabTitle=a.title??null,e.windowId=a.windowId??null}catch(a){e.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();e.extensions=a.filter(o=>o.type==="extension").map(o=>({id:o.id,name:o.name,enabled:o.enabled}))}else e.extensions="management_api_unavailable"}catch(a){e.managementError=String((a==null?void 0:a.message)??a)}return e}async function ye(t,e,n=""){var s;const a=await chrome.tabs.create({url:"about:blank",active:!0});if(!a.id)throw d(new Error("tab_create_failed"),"tab_load");const o=a.id;await I(o);let l=!1,r=null;try{await v(o),await _(o),l=!0;const c=await chrome.tabs.get(o);c.windowId&&await chrome.windows.update(c.windowId,{focused:!0}),await h(300),await u(o,"Page.navigate",{url:t}),await v(o),await h(2500);const i=await chrome.tabs.get(o);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");const f=await(await te(async()=>{const{send:k}=await Promise.resolve().then(()=>fe);return{send:k}},void 0)).send(o,"Runtime.evaluate",{expression:"window.devicePixelRatio",returnByValue:!0}),m=((s=f==null?void 0:f.result)==null?void 0:s.value)??1;console.log("[agent] devicePixelRatio:",m),await chrome.scripting.executeScript({target:{tabId:o},func:k=>navigator.clipboard.writeText(k),args:[e]}),await h(200),await j(o),await h(500),await J(o)&&(console.log("[agent] dismissed popup before Message click"),await h(500));const p=await W(o);if(!p)throw d(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",p),await chrome.tabs.update(o,{url:p}),await v(o);let b=await R(o);const z=Date.now()+15e3;for(;Date.now()<z&&b.msgForm===0&&b.anyEditable===0;)await h(500),b=await R(o);console.log("[agent] post-nav diag:",b);const P=await F(o,e);if(console.log("[agent] typeIntoCompose:",P),!P)throw d(new Error(`compose_insert_failed diag=${JSON.stringify(b)}`),"compose_insert_failed");await h(600);const D=await Y(o);if(console.log("[agent] clickSendButton:",D),!D)throw d(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),{sentAt:new Date().toISOString(),conversationUrl:t,steps:3}}catch(c){r=c;const i=await chrome.tabs.get(o).catch(()=>null);if(i!=null&&i.url&&(r.message=`${r.message} (url=${i.url})`),r.diag=await be(o).catch(()=>({diagError:!0})),l)try{const[f,m]=await Promise.all([B(o),w(o)]);r.screenshot=f,r.buttons=m}catch{}throw r}finally{l&&await E(o).catch(()=>{}),await chrome.tabs.remove(o).catch(()=>{}),await S()}}const ve=`(() => {
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
})()`;async function xe(t){var a;const e=await M(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await I(e);let n=!1;try{await v(e),await h(2500);const o=await chrome.tabs.get(e);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await _(e),n=!0;for(let s=0;s<6;s++)await X(e,1200),await h(800);const l=await u(e,"Runtime.evaluate",{expression:ve,returnByValue:!0}),r=(a=l==null?void 0:l.result)==null?void 0:a.value;if(!r)throw d(new Error("scrape_returned_null"),"scrape_failed");return r}finally{n&&await E(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await S()}}async function $(t,e){var a;const n=await u(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)??null}async function _e(t){var n;const e=await u(t,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=e==null?void 0:e.result)==null?void 0:n.value)??null}async function Ee(t){var a;const e=await M(t).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await I(e);let n=!1;try{await v(e),await h(4e3);const o=await chrome.tabs.get(e);if(o.url&&o.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await _(e),n=!0;const l=(t.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let r=await $(e,l);if(console.log("[connect] directBtn:",r),!r){let c=await w(e);if(console.log("[connect] buttons found:",c.map(i=>`"${i.text}" aria="${i.aria}" y=${i.y}`)),r=c.find(i=>/^connect$/i.test(i.text)||/connect/i.test(i.aria))??null,!r){const i=c.find(f=>/^more$/i.test(f.text)||/^more$/i.test(f.aria));i&&(await y(e,i.x+Math.round(i.w/2),i.y+Math.round(i.h/2)),await h(700),c=await w(e),console.log("[connect] buttons after More:",c.map(f=>`"${f.text}" aria="${f.aria}" y=${f.y}`)),r=c.find(f=>/^connect$/i.test(f.text)||/connect/i.test(f.aria))??null,r||(r=await $(e,l)))}}if(!r){const c=await u(e,"Runtime.evaluate",{expression:he,returnByValue:!0}),i=(a=c==null?void 0:c.result)==null?void 0:a.value;throw i==="pending"?d(new Error("invitation_already_pending"),"already_pending"):i==="connected"?d(new Error("already_connected"),"already_connected"):d(new Error("connect_button_not_found"),"no_connect")}await y(e,r.x+Math.round((r.w??80)/2),r.y+Math.round((r.h??36)/2));let s=null;for(let c=0;c<6&&(await h(c===0?1500:800),s=await _e(e),!s);c++);if(console.log("[connect] sendBtn:",s),!s){const c=await w(e);throw console.log("[connect] afterButtons:",c.map(i=>`"${i.text}" aria="${i.aria}"`)),d(new Error("send_dialog_not_found"),"already_or_blocked")}return await y(e,s.x+Math.round(s.w/2),s.y+Math.round(s.h/2)),await h(800),{sentAt:new Date().toISOString()}}catch(o){const l=o,r=await chrome.tabs.get(e).catch(()=>null);if(r!=null&&r.url&&(l.message=`${l.message} (url=${r.url})`),n&&l.code!=="already_pending"&&l.code!=="already_connected"&&l.code!=="checkpoint")try{const[s,c]=await Promise.all([B(e),w(e)]);l.screenshot=s,l.buttons=c}catch{}throw l}finally{n&&await E(e).catch(()=>{}),await chrome.tabs.remove(e).catch(()=>{}),await S()}}async function v(t){const e=await chrome.tabs.get(t).catch(()=>null);(e==null?void 0:e.status)!=="complete"&&await new Promise((n,a)=>{let o=!1;const l=i=>{o||(o=!0,clearTimeout(r),clearInterval(c),chrome.tabs.onUpdated.removeListener(s),i())},r=setTimeout(()=>l(()=>a(d(new Error("tab_load_timeout"),"tab_load"))),3e4),s=(i,f)=>{i===t&&f.status==="complete"&&l(n)};chrome.tabs.onUpdated.addListener(s);const c=setInterval(async()=>{const i=await chrome.tabs.get(t).catch(()=>null);if(!i)return l(()=>a(d(new Error("tab_closed"),"tab_load")));i.status==="complete"&&l(n)},1e3)})}function h(t){return new Promise(e=>setTimeout(e,t))}function d(t,e){return t.code=e,t}
