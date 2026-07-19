import{a as U,h as N,i as q,p as D,r as M}from"./api-BmYRdt7d.js";const V="1.3",k="automationWindowId";async function B(e){try{return await chrome.windows.get(e),!0}catch{return!1}}async function F(){const t=(await chrome.storage.local.get(k))[k];if(t!==void 0&&await B(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const o=await chrome.windows.create({focused:!1,state:"minimized"});if(!(o!=null&&o.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[k]:o.id}),o.id}async function A(e,t=!0){const o=await F(),n=await chrome.tabs.create({windowId:o,url:e,active:t});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(o,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function K(){const t=(await chrome.storage.local.get(k))[k];t!==void 0&&!await B(t)&&await chrome.storage.local.remove(k)}async function _(e){await new Promise((t,o)=>{chrome.debugger.attach({tabId:e},V,()=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):t()})})}async function v(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function l(e,t,o={}){return await new Promise((n,i)=>{chrome.debugger.sendCommand({tabId:e},t,o,r=>{chrome.runtime.lastError?i(new Error(chrome.runtime.lastError.message)):n(r)})})}async function W(e,t,o){await l(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:o,button:"none",buttons:0}),await C(50),await l(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:o,button:"left",buttons:1,clickCount:1}),await C(50),await l(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:o,button:"left",buttons:0,clickCount:1})}async function H(e){var o;const t=await l(e,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??null}async function Y(e,t){var n;const o=await l(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(n=o==null?void 0:o.result)!=null&&n.value?(await l(e,"Input.insertText",{text:t}),!0):!1}async function L(e){var o;const t=await l(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??{diag:"eval_failed"}}async function z(e){var o;const t=await l(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)===!0}const J='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function S(e){var o;const t=await l(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${J}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??[]}function X(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function j(e){const t=await S(e),o=X(t);return o?(await W(e,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0):!1}async function G(e,t){var r;const o=await l(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:n,h:i}=((r=o==null?void 0:o.result)==null?void 0:r.value)??{w:1440,h:900};await l(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(n/2),y:Math.round(i/2),deltaX:0,deltaY:t})}async function Q(e){for(let t=0;t<5;t++)await l(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await C(50),await l(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await C(150)}async function O(e){return(await l(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function C(e){return new Promise(t=>setTimeout(t,e))}const Z=`(() => {
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
})()`,tt=`(() => {
  const html = document.documentElement.innerHTML;
  const patterns = [
    /urn:li:fsd_company:(\\d+)/,
    /"voyagerCompanyId"\\s*:\\s*(\\d+)/,
    /voyagerCompanyId=(\\d+)/,
    /"companyId"\\s*:\\s*(\\d+)/,
  ];
  let companyId = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { companyId = m[1]; break; }
  }
  const h1 = document.querySelector('h1');
  const og = document.querySelector('meta[property="og:title"]');
  const resolvedName =
    (h1 && h1.textContent && h1.textContent.trim()) ||
    (og && og.getAttribute('content')) ||
    null;
  return { companyId, resolvedName, url: location.href.split('?')[0] };
})()`,et=`(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
  const link = links.find((a) => /linkedin\\.com\\/company\\/[^/?#]+\\/?$/.test(a.href.split('?')[0]));
  if (!link) return null;
  const card = link.closest('li') || link.parentElement;
  const text = (card ? card.textContent : link.textContent) || '';
  const name = text.split('\\n').map((s) => s.trim()).filter(Boolean)[0] || null;
  return { companyUrl: link.href.split('?')[0], name };
})()`;function nt(e){const t=e.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);return t?decodeURIComponent(t[1]).toLowerCase():null}function ot(e){return`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e)}`}function at(e,t){const o=u=>(u||"").replace(/[‎‏‪-‮⁦-⁩]/g,""),n=t.map(u=>o(u).replace(/\s+/g," ").trim()).filter(Boolean),i=n.filter((u,b)=>b===0||u!==n[b-1]),r=o(e).split("•")[0].replace(/\s*★.*/,"").replace(/\+\d+/g," ").replace(/\s+/g," ").trim();if(!r||r.length<2)return null;const m=o(e).replace(/\s+/g," ").trim();let c=null;for(const u of i){const b=u.match(/\b(1st|2nd|3rd\+?)\b/);if(b){c=b[1].charAt(0)==="3"?"3rd":b[1];break}const R=u.match(/•\s*(ראשון|שני|שלישי)/);if(R){c=R[1]==="ראשון"?"1st":R[1]==="שני"?"2nd":"3rd";break}}let a=null;for(const u of i){const b=u.match(/^(connect|follow|following|pending|message)$/i);if(b){a=b[1].toLowerCase();break}if(/^(התחבר|להתחבר|התחברות)$/.test(u)){a="connect";break}if(/^עוקב$/.test(u)){a="following";break}if(/^(עקוב|מעקב|לעקוב)$/.test(u)){a="follow";break}if(/^(ממתין|בהמתנה)$/.test(u)){a="pending";break}if(/הודעה/.test(u)){a="message";break}}const d=/(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\bfollowers?$|^status is |^• )/i,s=i.filter(u=>u!==r&&u!==m&&!d.test(u)&&!/^(1st|2nd|3rd\+?)$/.test(u)&&!/^(התחבר|להתחבר|התחברות|עוקב|עקוב|מעקב|לעקוב|ממתין|בהמתנה|הודעה|שליחת הודעה)$/.test(u)),h=s[0]||null;let w=null,g=null;if(h){const u=h.match(/^(.*?)\s+at\s+(.+)$/);u?(w=u[1].trim(),g=u[2].trim()):w=h}let $=null;for(let u=1;u<s.length;u++){const b=s[u];if(/,/.test(b)||/israel|ישראל/i.test(b)){$=b;break}}return{name:r,headline:h,title:w,company:g,location:$,degree:c,cardAction:a}}const rt=`(() => {
  const parseCardFields = ${at.toString()};
  const section = document.querySelector('main')
    || document.querySelector('section[aria-label="Primary content"]');
  if (!section) {
    const b = (document.body && document.body.innerText) || '';
    return { candidates: [], hasNextPage: false, debug: {
      title: document.title, href: location.href, vis: document.visibilityState,
      focus: document.hasFocus(), hasSection: false,
      inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
      bodyLen: b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(b),
      snippet: b.slice(0, 240),
    } };
  }
  const allLinks = Array.from(section.querySelectorAll('a[href*="/in/"]'));
  const seen = new Set();
  const out = [];
  for (const link of allLinks) {
    const profileUrl = link.href.split('?')[0];
    if (seen.has(profileUrl) || !profileUrl.match(/linkedin\\.com\\/in\\/[^\\/]+\\/?$/)) continue;
    seen.add(profileUrl);
    const slug = profileUrl.replace(/\\/$/, '').split('/in/')[1] || '';
    const urn = 'urn:li:member:' + slug;
    const card = link.closest('li') || link.parentElement?.parentElement?.parentElement || link.parentElement;
    const nameRaw = (link.innerText || '').split('\\n')[0];
    const rawLines = (card ? card.innerText : '').split('\\n');
    const fields = parseCardFields(nameRaw, rawLines);
    if (!fields) continue;
    out.push({ urn, profileUrl, ...fields });
  }
  const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Next' || b.innerText.trim() === 'הבא');
  const next = nextBtns[0];
  const hasNextPage = !!next && !next.disabled;
  const _b = (document.body && document.body.innerText) || '';
  return { candidates: out, hasNextPage, debug: {
    title: document.title, href: location.href, vis: document.visibilityState,
    focus: document.hasFocus(), hasSection: true, inLinksSection: allLinks.length,
    inLinksDoc: document.querySelectorAll('a[href*="/in/"]').length,
    bodyLen: _b.length, noResults: /no results found|לא נמצאו תוצאות/i.test(_b),
    snippet: _b.slice(0, 240),
  } };
})()`,it=30,lt=60,T="0.4.3";let I=!1;async function x(e){await chrome.storage.local.set({swActiveTabId:e})}async function E(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await K().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await E())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:it/60}),chrome.alarms.create("hb",{periodInMinutes:lt/60})});U().then(e=>{e&&N(T)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&N(T)});chrome.alarms.onAlarm.addListener(async e=>{if(await U()&&!await q()){if(e.name==="hb"){await N(T);return}if(e.name==="poll"){if(I){console.log("[poll] task already running, skipping");return}for(;await ct(););}}});async function ct(){let e;try{e=await D()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;I=!0;try{const t=await st(e);await M(e.id,{ok:!0,result:t})}catch(t){const o=t.code??"unknown",n=t.screenshot,i=t.buttons,r=t.diag;await M(e.id,{ok:!1,errorCode:o,errorMessage:t.message,...n||i||r?{result:{debugScreenshot:n,buttons:i,diag:r}}:{}})}finally{I=!1}return!0}async function st(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw f(new Error("missing_payload"),"bad_payload");return await dt(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw f(new Error("missing_payload"),"bad_payload");return await ft(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw f(new Error("missing_payload"),"bad_payload");return await ht(t.profileUrl)}if(e.kind==="RESOLVE_COMPANY"){if(!t.linkedinUrl&&!t.name)throw f(new Error("missing_payload"),"bad_payload");return await mt(t.linkedinUrl??null,t.name??null)}throw f(new Error("unknown_kind"),"unsupported_kind")}async function ut(e){var o;const t={};try{const n=await chrome.tabs.get(e);t.tabUrl=n.url??null,t.tabStatus=n.status??null,t.tabTitle=n.title??null,t.windowId=n.windowId??null}catch(n){t.tabGetError=String((n==null?void 0:n.message)??n)}try{if((o=chrome.management)!=null&&o.getAll){const n=await chrome.management.getAll();t.extensions=n.flatMap(i=>i.type==="extension"?[{id:i.id,name:i.name,enabled:i.enabled}]:[])}else t.extensions="management_api_unavailable"}catch(n){t.managementError=String((n==null?void 0:n.message)??n)}return t}async function dt(e,t,o=""){const n=await A("about:blank",!1);await x(n);let i=!1,r=null;try{await y(n),await _(n),i=!0,await l(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await l(n,"Page.navigate",{url:e}),await y(n),await p(2500);const m=await chrome.tabs.get(n);if(m.url&&m.url.includes("/checkpoint"))throw f(new Error("checkpoint"),"checkpoint");await Q(n),await p(500),await j(n)&&(console.log("[agent] dismissed popup before Message click"),await p(500));const a=await H(n);if(!a)throw f(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",a),await chrome.tabs.update(n,{url:a}),await y(n);let d=await L(n);const s=Date.now()+15e3;for(;Date.now()<s&&d.msgForm===0&&d.anyEditable===0;)await p(500),d=await L(n);console.log("[agent] post-nav diag:",d);const h=await Y(n,t);if(console.log("[agent] typeIntoCompose:",h),!h)throw f(new Error(`compose_insert_failed diag=${JSON.stringify(d)}`),"compose_insert_failed");await p(600);const w=await z(n);if(console.log("[agent] clickSendButton:",w),!w)throw f(new Error("send_button_not_found"),"send_button_not_found");return await p(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(m){r=m;const c=await chrome.tabs.get(n).catch(()=>null);if(c!=null&&c.url&&(r.message=`${r.message} (url=${c.url})`),r.diag=await ut(n).catch(()=>({diagError:!0})),i)try{const[a,d]=await Promise.all([O(n),S(n)]);r.screenshot=a,r.buttons=d}catch{}throw r}finally{i&&await v(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await E()}}async function ft(e){var n,i;const t=await A(e).catch(()=>{throw f(new Error("tab_create_failed"),"tab_load")});await x(t);let o=!1;try{await y(t),await p(1500);const r=await chrome.tabs.get(t);if(r.url&&r.url.includes("/checkpoint"))throw f(new Error("checkpoint"),"checkpoint");await _(t),o=!0,await l(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await l(t,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await l(t,"Page.enable",{}).catch(()=>{}),await l(t,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{});let m;for(let c=0;c<12;c++){await G(t,1500),await p(1200);const a=await l(t,"Runtime.evaluate",{expression:rt,returnByValue:!0});if(m=(n=a==null?void 0:a.result)==null?void 0:n.value,m&&(m.candidates.length>0||((i=m.debug)==null?void 0:i.noResults)===!0))break}if(!m)throw f(new Error("scrape_returned_null"),"scrape_failed");return m}finally{o&&await v(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await E()}}async function mt(e,t){var r,m,c;const o=e??ot(t??""),n=await A(o).catch(()=>{throw f(new Error("tab_create_failed"),"tab_load")});await x(n);let i=!1;try{await y(n),await p(2500);let a=await chrome.tabs.get(n);if(a.url&&a.url.includes("/checkpoint"))throw f(new Error("checkpoint"),"checkpoint");if(await _(n),i=!0,await l(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),!e){const w=await l(n,"Runtime.evaluate",{expression:et,returnByValue:!0}),g=(m=(r=w==null?void 0:w.result)==null?void 0:r.value)==null?void 0:m.companyUrl;if(!g)throw f(new Error("company_not_found"),"not_found");if(await v(n).catch(()=>{}),i=!1,await chrome.tabs.update(n,{url:g}),await y(n),await p(2500),a=await chrome.tabs.get(n),a.url&&a.url.includes("/checkpoint"))throw f(new Error("checkpoint"),"checkpoint");await _(n),i=!0}const d=await l(n,"Runtime.evaluate",{expression:tt,returnByValue:!0}),s=(c=d==null?void 0:d.result)==null?void 0:c.value;if(!s||!s.companyId)throw f(new Error("company_id_not_found"),"no_id");const h=s.url??(await chrome.tabs.get(n)).url??o;return{companyId:s.companyId,resolvedName:s.resolvedName??null,slug:nt(h),matchedUrl:h}}finally{i&&await v(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await E()}}async function P(e,t){var n;const o=await l(e,"Runtime.evaluate",{expression:`(() => {
      const slug = ${JSON.stringify(t)};
      const all = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('button, a, [role="button"]')) all.push(el);
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      const inSidebar = (el) => {
        let p = el;
        while (p) {
          if (p.tagName === 'ASIDE') return true;
          const cls = typeof p.className === 'string' ? p.className : '';
          if (/similar|browsemap|pymk|discovery/i.test(cls)) return true;
          p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null;
        }
        return false;
      };
      const isConnect = (el) => {
        const t = (el.textContent || '').trim();
        const a = el.getAttribute('aria-label') || '';
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (href.includes('custom-invite')) return !(slug && !href.includes('vanityname=' + slug));
        if (/invite\\b.*\\bto connect/i.test(a) || /^connect$/i.test(a)) return true;
        if (/^(connect|התחבר)$/i.test(t)) return true;
        return false;
      };
      const cands = all.filter(isConnect);
      const slugMatch = cands.find(el => (el.getAttribute('href') || '').toLowerCase().includes('vanityname=' + slug));
      const mainCard = cands.find(el => !inSidebar(el));
      const target = slugMatch || mainCard || cands[0];
      if (target) { target.click(); return true; }
      return false;
    })()`,returnByValue:!0});return((n=o==null?void 0:o.result)==null?void 0:n.value)===!0}async function wt(e){var o;const t=await l(e,"Runtime.evaluate",{expression:`(() => {
      let dlg = null;
      const findDlg = (root) => {
        if (dlg) return;
        const m = root.querySelector('[role="dialog"], .artdeco-modal');
        if (m) { dlg = m; return; }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { findDlg(el.shadowRoot); if (dlg) return; }
      };
      findDlg(document);
      const scope = dlg || document;
      const SEND = [/^send\\b/i, /send without/i, /^שלח/, /שלח ללא/];
      const SKIP = /cancel|בטל|add a note|הוסף הערה|dismiss|got it|close|סגור/i;
      let found = null, primary = null;
      const collect = (root) => {
        if (found) return;
        for (const el of root.querySelectorAll('button,[role="button"]')) {
          const t = (el.textContent || '').trim();
          const a = el.getAttribute('aria-label') || '';
          if (SEND.some(p => p.test(t) || p.test(a))) { found = el; return; }
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!primary && /artdeco-button--primary/.test(cls) && !SKIP.test(t + ' ' + a)) primary = el;
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { collect(el.shadowRoot); if (found) return; }
      };
      collect(scope);
      // Only trust the primary-button fallback when we actually located the invite dialog, so we
      // never click a stray primary button elsewhere on the page when no dialog opened.
      const target = found || (dlg ? primary : null);
      if (target) { target.click(); return true; }
      return false;
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)===!0}async function ht(e){var n,i,r;const t=await A("about:blank",!1).catch(()=>{throw f(new Error("tab_create_failed"),"tab_load")});await x(t);let o=!1;try{await y(t),await _(t),o=!0,await l(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await l(t,"Page.navigate",{url:e}),await y(t),await p(4e3);const m=await chrome.tabs.get(t);if(m.url&&m.url.includes("/checkpoint"))throw f(new Error("checkpoint"),"checkpoint");const c=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let a=await P(t,c);if(console.log("[connect] clickConnectInPage:",a),!a){const s=await l(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(n=s==null?void 0:s.result)!=null&&n.value&&(await p(800),a=await P(t,c),console.log("[connect] clickConnectInPage after More:",a))}if(!a){const s=await l(t,"Runtime.evaluate",{expression:Z,returnByValue:!0}),h=(i=s==null?void 0:s.result)==null?void 0:i.value;if(h==="pending")throw f(new Error("invitation_already_pending"),"already_pending");if(h==="connected")throw f(new Error("already_connected"),"already_connected");const w=await l(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(r=w==null?void 0:w.result)!=null&&r.value?f(new Error("follow_only"),"follow_only"):f(new Error("connect_button_not_found"),"no_connect")}let d=!1;for(let s=0;s<6&&(await p(s===0?1500:800),d=await wt(t),!d);s++);if(console.log("[connect] clickSendInPage:",d),!d){const s=await S(t);console.log("[connect] afterButtons:",s.map(w=>`"${w.text}" aria="${w.aria}"`));const h=s.flatMap(w=>{const g=(w.text||w.aria||"").trim();return g?[g]:[]}).slice(0,12).join(" | ");throw f(new Error(`send_dialog_not_found; buttons=[${h}]`),"already_or_blocked")}return await p(800),{sentAt:new Date().toISOString()}}catch(m){const c=m,a=await chrome.tabs.get(t).catch(()=>null);if(a!=null&&a.url&&(c.message=`${c.message} (url=${a.url})`),o&&c.code!=="already_pending"&&c.code!=="already_connected"&&c.code!=="checkpoint")try{const[d,s]=await Promise.all([O(t),S(t)]);c.screenshot=d,c.buttons=s}catch{}throw c}finally{o&&await v(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await E()}}async function y(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((o,n)=>{let i=!1;const r=d=>{i||(i=!0,clearTimeout(m),clearInterval(a),chrome.tabs.onUpdated.removeListener(c),d())},m=setTimeout(()=>r(()=>n(f(new Error("tab_load_timeout"),"tab_load"))),3e4),c=(d,s)=>{d===e&&s.status==="complete"&&r(o)};chrome.tabs.onUpdated.addListener(c);const a=setInterval(async()=>{const d=await chrome.tabs.get(e).catch(()=>null);if(!d)return r(()=>n(f(new Error("tab_closed"),"tab_load")));d.status==="complete"&&r(o)},1e3)})}function p(e){return new Promise(t=>setTimeout(t,e))}function f(e,t){return e.code=t,e}
