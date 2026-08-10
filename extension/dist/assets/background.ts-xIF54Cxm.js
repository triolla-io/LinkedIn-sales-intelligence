import{a as q,h as I,i as H,p as Y,r as U}from"./api-BmYRdt7d.js";const z="1.3",E="automationWindowId";async function F(e){try{return await chrome.windows.get(e),!0}catch{return!1}}var B;typeof chrome<"u"&&((B=chrome.debugger)!=null&&B.onEvent)&&chrome.debugger.onEvent.addListener((e,t)=>{t!=="Page.javascriptDialogOpening"||e.tabId===void 0||chrome.debugger.sendCommand({tabId:e.tabId},"Page.handleJavaScriptDialog",{accept:!0},()=>{chrome.runtime.lastError})});async function J(){const t=(await chrome.storage.local.get(E))[E];if(t!==void 0&&await F(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const n=await chrome.windows.create({focused:!1,state:"minimized"});if(!(n!=null&&n.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[E]:n.id}),n.id}async function k(e,t=!0){const n=await J(),a=await chrome.tabs.create({windowId:n,url:e,active:t});if(!a.id)throw new Error("tab_create_failed");return await chrome.windows.update(n,{focused:!1,state:"minimized"}).catch(()=>{}),a.id}async function j(){const t=(await chrome.storage.local.get(E))[E];t!==void 0&&!await F(t)&&await chrome.storage.local.remove(E)}async function _(e){await new Promise((t,n)=>{chrome.debugger.attach({tabId:e},z,()=>{chrome.runtime.lastError?n(new Error(chrome.runtime.lastError.message)):t()})}),await s(e,"Page.enable").catch(()=>{})}async function v(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function s(e,t,n={}){return await new Promise((a,o)=>{chrome.debugger.sendCommand({tabId:e},t,n,r=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):a(r)})})}async function G(e,t,n){await s(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:n,button:"none",buttons:0}),await R(50),await s(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:n,button:"left",buttons:1,clickCount:1}),await R(50),await s(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:n,button:"left",buttons:0,clickCount:1})}async function X(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??null}async function Q(e,t){var a;const n=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(a=n==null?void 0:n.result)!=null&&a.value?(await s(e,"Input.insertText",{text:t}),!0):!1}async function D(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??{diag:"eval_failed"}}async function Z(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}const tt='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function C(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${tt}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)??[]}function et(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function nt(e){const t=await C(e),n=et(t);return n?(await G(e,n.x+Math.round(n.w/2),n.y+Math.round(n.h/2)),!0):!1}async function at(e,t){var r;const n=await s(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:a,h:o}=((r=n==null?void 0:n.result)==null?void 0:r.value)??{w:1440,h:900};await s(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(a/2),y:Math.round(o/2),deltaX:0,deltaY:t})}async function ot(e){for(let t=0;t<5;t++)await s(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await R(50),await s(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await R(150)}async function L(e){return(await s(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function R(e){return new Promise(t=>setTimeout(t,e))}const rt=`(() => {
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
})()`,it=`(() => {
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
})()`,ct=`(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
  const seen = new Set();
  const out = [];
  for (const a of links) {
    const url = a.href.split('?')[0];
    if (!/linkedin\\.com\\/company\\/[^/?#]+\\/?$/.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const card = a.closest('li') || a.parentElement;
    const text = (card ? card.textContent : a.textContent) || '';
    const name = text.split('\\n').map((s) => s.trim()).filter(Boolean)[0] || null;
    out.push({ companyUrl: url, name });
    if (out.length >= 5) break;
  }
  return out;
})()`;function st(e){const t=e.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);return t?decodeURIComponent(t[1]).toLowerCase():null}function lt(e){return`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e)}`}const ut=new Set(["il","israel","ישראל","group","ltd","holdings","inc","corp","co"]);function T(e){return e.toLowerCase().replace(/[.,'"()|/\\־-]+/g," ").split(/\s+/).map(t=>t.trim()).filter(t=>t.length>0&&!ut.has(t))}function dt(e,t){const n=[...new Set(T(e))];if(n.length===0)return 0;const a=new Set(T(t));return n.filter(r=>a.has(r)).length/n.length}const mt=.5;function ft(e,t,n=mt){if(t.length===0)return null;if(T(e).length===0)return t[0];let a=null,o=-1;for(const r of t){const i=dt(e,r.name??"");i>o&&(o=i,a=r)}return o>=n?a:null}function wt(e,t){const n=u=>(u||"").replace(/[‎‏‪-‮⁦-⁩]/g,""),a=t.map(u=>n(u).replace(/\s+/g," ").trim()).filter(Boolean),o=a.filter((u,g)=>g===0||u!==a[g-1]),r=n(e).split("•")[0].replace(/\s*★.*/,"").replace(/\+\d+/g," ").replace(/\s+/g," ").trim();if(!r||r.length<2)return null;const i=n(e).replace(/\s+/g," ").trim();let c=null;for(const u of o){const g=u.match(/\b(1st|2nd|3rd\+?)\b/);if(g){c=g[1].charAt(0)==="3"?"3rd":g[1];break}const P=u.match(/•\s*(ראשון|שני|שלישי)/);if(P){c=P[1]==="ראשון"?"1st":P[1]==="שני"?"2nd":"3rd";break}}let l=null;for(const u of o){const g=u.match(/^(connect|follow|following|pending|message)$/i);if(g){l=g[1].toLowerCase();break}if(/^(התחבר|להתחבר|התחברות)$/.test(u)){l="connect";break}if(/^עוקב$/.test(u)){l="following";break}if(/^(עקוב|מעקב|לעקוב)$/.test(u)){l="follow";break}if(/^(ממתין|בהמתנה)$/.test(u)){l="pending";break}if(/הודעה/.test(u)){l="message";break}}const m=/(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\bfollowers?$|^status is |^• )/i,f=o.filter(u=>u!==r&&u!==i&&!m.test(u)&&!/^(1st|2nd|3rd\+?)$/.test(u)&&!/^(התחבר|להתחבר|התחברות|עוקב|עקוב|מעקב|לעקוב|ממתין|בהמתנה|הודעה|שליחת הודעה)$/.test(u)),p=f[0]||null;let w=null,b=null;if(p){const u=p.match(/^(.*?)\s+at\s+(.+)$/);u?(w=u[1].trim(),b=u[2].trim()):w=p}let x=null;for(let u=1;u<f.length;u++){const g=f[u];if(/,/.test(g)||/israel|ישראל/i.test(g)){x=g;break}}return{name:r,headline:p,title:w,company:b,location:x,degree:c,cardAction:l}}const ht=`(() => {
  const parseCardFields = ${wt.toString()};
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
})()`;function pt(e,t){const n=e.filter(a=>a.current);if(n.length>0){const a=n.reduce((o,r)=>(r.startDate??"")>(o.startDate??"")?r:o);return{title:a.title??null,company:a.company??null}}if(t){const a=t.match(/^(.*?)\s+at\s+(.+)$/i);return a?{title:a[1].trim(),company:a[2].trim()}:{title:t,company:null}}return{title:null,company:null}}const gt=`(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const titleName = clean((document.title || '').split('|')[0]);

  // Current company — anchored on the topcard company icon (id starts with "company-accent").
  let company = null;
  const compIcon = document.querySelector('svg[id^="company-accent"]');
  if (compIcon) {
    const fig = compIcon.closest('figure');
    const container = fig && fig.parentElement;
    if (container) {
      const t = clean(container.innerText || '');
      if (t) company = t.split('\\n')[0];
    }
  }

  // Topcard = the <section> whose <h2> text matches the profile name.
  let topcard = null;
  const sections = Array.from(document.querySelectorAll('section'));
  for (const s of sections) {
    const h2 = s.querySelector('h2');
    if (h2 && clean(h2.textContent) === titleName && titleName) { topcard = s; break; }
  }

  let headline = null;
  if (topcard) {
    const ps = Array.from(topcard.querySelectorAll('p'))
      .map((p) => clean(p.textContent))
      .filter(Boolean)
      .filter((t) =>
        t !== titleName &&
        !t.startsWith('\\u00b7') &&              // "· 1st" / "· 2nd" degree markers
        !/^[0-9,]+\\+?$/.test(t) &&              // "500+" connection count
        !/connections?$/i.test(t) &&
        !/contact info/i.test(t));
    if (ps.length) headline = ps[0];
    if (!company && ps.length > 1) company = ps[1];
  }

  // Represent the topcard current role as a single current entry for parseProfileRole.
  const entries = (headline || company)
    ? [{ title: headline, company: company, current: true, startDate: '9999-99' }]
    : [];

  return { entries, headline };
})()`;async function yt(e){var a;const t=await k(e,!1);let n=!1;try{await bt(t),await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await _(t),n=!0,await s(t,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await s(t,"Page.enable",{}).catch(()=>{}),await s(t,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{}),await V(1500);const o=await s(t,"Runtime.evaluate",{expression:gt,returnByValue:!0}),{entries:r,headline:i}=((a=o==null?void 0:o.result)==null?void 0:a.value)??{entries:[],headline:null};return pt(r,i)}finally{n&&await v(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{})}}async function bt(e,t=3e4){const n=Date.now();for(;Date.now()-n<t;){const a=await chrome.tabs.get(e).catch(()=>null);if(!a)throw new Error("tab_closed");if(a.status==="complete")return;await V(500)}throw new Error("tab_load_timeout")}function V(e){return new Promise(t=>setTimeout(t,e))}const vt=30,_t=60,M="0.5.0";let N=!1;async function A(e){await chrome.storage.local.set({swActiveTabId:e})}async function S(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await j().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await S())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:vt/60}),chrome.alarms.create("hb",{periodInMinutes:_t/60})});q().then(e=>{e&&I(M)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&I(M)});chrome.alarms.onAlarm.addListener(async e=>{if(await q()&&!await H()){if(e.name==="hb"){await I(M);return}if(e.name==="poll"){if(N){console.log("[poll] task already running, skipping");return}for(;await Et(););}}});async function Et(){let e;try{e=await Y()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;N=!0;try{const t=await kt(e);await U(e.id,{ok:!0,result:t})}catch(t){const n=t.code??"unknown",a=t.screenshot,o=t.buttons,r=t.diag;await U(e.id,{ok:!1,errorCode:n,errorMessage:t.message,...a||o||r?{result:{debugScreenshot:a,buttons:o,diag:r}}:{}})}finally{N=!1}return!0}async function kt(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw d(new Error("missing_payload"),"bad_payload");return await St(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="PREPARE_MESSAGE"){if(!t.linkedinUrl||!t.text)throw d(new Error("missing_payload"),"bad_payload");return await Ct(t.linkedinUrl,t.text)}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw d(new Error("missing_payload"),"bad_payload");return await xt(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw d(new Error("missing_payload"),"bad_payload");return await Tt(t.profileUrl)}if(e.kind==="RESOLVE_COMPANY"){if(!t.linkedinUrl&&!t.name)throw d(new Error("missing_payload"),"bad_payload");return await Rt(t.linkedinUrl??null,t.name??null)}if(e.kind==="SCRAPE_PROFILE"){if(!t.linkedinUrl)throw d(new Error("missing_payload"),"bad_payload");return await yt(t.linkedinUrl)}throw d(new Error("unknown_kind"),"unsupported_kind")}async function W(e){var n;const t={};try{const a=await chrome.tabs.get(e);t.tabUrl=a.url??null,t.tabStatus=a.status??null,t.tabTitle=a.title??null,t.windowId=a.windowId??null}catch(a){t.tabGetError=String((a==null?void 0:a.message)??a)}try{if((n=chrome.management)!=null&&n.getAll){const a=await chrome.management.getAll();t.extensions=a.flatMap(o=>o.type==="extension"?[{id:o.id,name:o.name,enabled:o.enabled}]:[])}else t.extensions="management_api_unavailable"}catch(a){t.managementError=String((a==null?void 0:a.message)??a)}return t}async function St(e,t,n=""){const a=await k("about:blank",!1);await A(a);let o=!1,r=null;try{await y(a),await _(a),o=!0,await K(a,e,t);const i=await Z(a);if(console.log("[agent] clickSendButton:",i),!i)throw d(new Error("send_button_not_found"),"send_button_not_found");return await h(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(i){r=i;const c=await chrome.tabs.get(a).catch(()=>null);if(c!=null&&c.url&&(r.message=`${r.message} (url=${c.url})`),r.diag=await W(a).catch(()=>({diagError:!0})),o)try{const[l,m]=await Promise.all([L(a),C(a)]);r.screenshot=l,r.buttons=m}catch{}throw r}finally{o&&(await s(a,"Page.navigate",{url:"about:blank"}).catch(()=>{}),await h(300),await v(a).catch(()=>{})),await chrome.tabs.remove(a).catch(()=>{}),await S()}}async function K(e,t,n){await s(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(e,"Page.navigate",{url:t}),await y(e),await h(2500);const a=await chrome.tabs.get(e);if(a.url&&a.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await ot(e),await h(500),await nt(e)&&(console.log("[agent] dismissed popup before Message click"),await h(500));const r=await X(e);if(!r)throw d(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",r),await chrome.tabs.update(e,{url:r}),await y(e);let i=await D(e);const c=Date.now()+15e3;for(;Date.now()<c&&i.msgForm===0&&i.anyEditable===0;)await h(500),i=await D(e);console.log("[agent] post-nav diag:",i);const l=await Q(e,n);if(console.log("[agent] typeIntoCompose:",l),!l)throw d(new Error(`compose_insert_failed diag=${JSON.stringify(i)}`),"compose_insert_failed");await h(600)}async function Ct(e,t){const n=await k("about:blank",!1);await A(n);let a=!1,o=!1;try{return await y(n),await _(n),a=!0,await K(n,e,t),await s(n,"Emulation.clearDeviceMetricsOverride").catch(()=>{}),await v(n).catch(()=>{}),await At(n),o=!0,{preparedAt:new Date().toISOString(),conversationUrl:e}}catch(r){const i=r,c=await chrome.tabs.get(n).catch(()=>null);if(c!=null&&c.url&&(i.message=`${i.message} (url=${c.url})`),i.diag=await W(n).catch(()=>({diagError:!0})),a)try{const[l,m]=await Promise.all([L(n),C(n)]);i.screenshot=l,i.buttons=m}catch{}throw i}finally{o||(a&&(await s(n,"Page.navigate",{url:"about:blank"}).catch(()=>{}),await h(300),await v(n).catch(()=>{})),await chrome.tabs.remove(n).catch(()=>{})),await S()}}async function At(e){const t=await chrome.tabs.get(e),a=(await chrome.windows.getAll({windowTypes:["normal"]}).catch(()=>[])).filter(r=>r.id!==void 0&&r.id!==t.windowId),o=a.find(r=>r.state!=="minimized")??a[0];(o==null?void 0:o.id)!==void 0?(await chrome.tabs.move(e,{windowId:o.id,index:-1}),await chrome.tabs.update(e,{active:!0}),await chrome.windows.update(o.id,{focused:!0,...o.state==="minimized"?{state:"normal"}:{}})):await chrome.windows.create({tabId:e,focused:!0})}async function $(e){await s(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(e,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await s(e,"Page.enable",{}).catch(()=>{}),await s(e,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{})}async function xt(e){var a,o;const t=await k(e,!1).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await A(t);let n=!1;try{await y(t),await h(1500);const r=await chrome.tabs.get(t);if(r.url&&r.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await _(t),n=!0,await $(t);let i;for(let c=0;c<12;c++){await at(t,1500),await h(1200);const l=await s(t,"Runtime.evaluate",{expression:ht,returnByValue:!0});if(i=(a=l==null?void 0:l.result)==null?void 0:a.value,i&&(i.candidates.length>0||((o=i.debug)==null?void 0:o.noResults)===!0))break}if(!i)throw d(new Error("scrape_returned_null"),"scrape_failed");return i}finally{n&&await v(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await S()}}async function Rt(e,t){var r,i;const n=e??lt(t??""),a=await k(n,!1).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await A(a);let o=!1;try{await y(a),await h(2500);let c=await chrome.tabs.get(a);if(c.url&&c.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");if(await _(a),o=!0,await $(a),!e){const p=await s(a,"Runtime.evaluate",{expression:ct,returnByValue:!0}),w=((r=p==null?void 0:p.result)==null?void 0:r.value)??[];if(w.length===0)throw d(new Error("company_not_found"),"not_found");const b=ft(t??"",w);if(!b)throw d(new Error("ambiguous_match"),"ambiguous_match");const x=b.companyUrl;if(await v(a).catch(()=>{}),o=!1,await chrome.tabs.update(a,{url:x}),await y(a),await h(2500),c=await chrome.tabs.get(a),c.url&&c.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");await _(a),o=!0,await $(a)}const l=await s(a,"Runtime.evaluate",{expression:it,returnByValue:!0}),m=(i=l==null?void 0:l.result)==null?void 0:i.value;if(!m||!m.companyId)throw d(new Error("company_id_not_found"),"no_id");const f=m.url??(await chrome.tabs.get(a)).url??n;return{companyId:m.companyId,resolvedName:m.resolvedName??null,slug:st(f),matchedUrl:f}}finally{o&&await v(a).catch(()=>{}),await chrome.tabs.remove(a).catch(()=>{}),await S()}}async function O(e,t){var a;const n=await s(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((a=n==null?void 0:n.result)==null?void 0:a.value)===!0}async function Pt(e){var n;const t=await s(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=t==null?void 0:t.result)==null?void 0:n.value)===!0}async function Tt(e){var a,o,r;const t=await k("about:blank",!1).catch(()=>{throw d(new Error("tab_create_failed"),"tab_load")});await A(t);let n=!1;try{await y(t),await _(t),n=!0,await s(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await s(t,"Page.navigate",{url:e}),await y(t),await h(4e3);const i=await chrome.tabs.get(t);if(i.url&&i.url.includes("/checkpoint"))throw d(new Error("checkpoint"),"checkpoint");const c=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let l=await O(t,c);if(console.log("[connect] clickConnectInPage:",l),!l){const f=await s(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(a=f==null?void 0:f.result)!=null&&a.value&&(await h(800),l=await O(t,c),console.log("[connect] clickConnectInPage after More:",l))}if(!l){const f=await s(t,"Runtime.evaluate",{expression:rt,returnByValue:!0}),p=(o=f==null?void 0:f.result)==null?void 0:o.value;if(p==="pending")throw d(new Error("invitation_already_pending"),"already_pending");if(p==="connected")throw d(new Error("already_connected"),"already_connected");const w=await s(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(r=w==null?void 0:w.result)!=null&&r.value?d(new Error("follow_only"),"follow_only"):d(new Error("connect_button_not_found"),"no_connect")}let m=!1;for(let f=0;f<6&&(await h(f===0?1500:800),m=await Pt(t),!m);f++);if(console.log("[connect] clickSendInPage:",m),!m){const f=await C(t);console.log("[connect] afterButtons:",f.map(w=>`"${w.text}" aria="${w.aria}"`));const p=f.flatMap(w=>{const b=(w.text||w.aria||"").trim();return b?[b]:[]}).slice(0,12).join(" | ");throw d(new Error(`send_dialog_not_found; buttons=[${p}]`),"already_or_blocked")}return await h(800),{sentAt:new Date().toISOString()}}catch(i){const c=i,l=await chrome.tabs.get(t).catch(()=>null);if(l!=null&&l.url&&(c.message=`${c.message} (url=${l.url})`),n&&c.code!=="already_pending"&&c.code!=="already_connected"&&c.code!=="checkpoint")try{const[m,f]=await Promise.all([L(t),C(t)]);c.screenshot=m,c.buttons=f}catch{}throw c}finally{n&&await v(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await S()}}async function y(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((n,a)=>{let o=!1;const r=m=>{o||(o=!0,clearTimeout(i),clearInterval(l),chrome.tabs.onUpdated.removeListener(c),m())},i=setTimeout(()=>r(()=>a(d(new Error("tab_load_timeout"),"tab_load"))),3e4),c=(m,f)=>{m===e&&f.status==="complete"&&r(n)};chrome.tabs.onUpdated.addListener(c);const l=setInterval(async()=>{const m=await chrome.tabs.get(e).catch(()=>null);if(!m)return r(()=>a(d(new Error("tab_closed"),"tab_load")));m.status==="complete"&&r(n)},1e3)})}function h(e){return new Promise(t=>setTimeout(t,e))}function d(e,t){return e.code=t,e}
