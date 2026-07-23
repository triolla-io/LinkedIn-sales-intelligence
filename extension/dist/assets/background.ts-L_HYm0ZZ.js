import{a as B,h as $,i as K,p as W,r as M}from"./api-BmYRdt7d.js";const H="1.3",_="automationWindowId";async function q(e){try{return await chrome.windows.get(e),!0}catch{return!1}}var U;typeof chrome<"u"&&((U=chrome.debugger)!=null&&U.onEvent)&&chrome.debugger.onEvent.addListener((e,t)=>{t!=="Page.javascriptDialogOpening"||e.tabId===void 0||chrome.debugger.sendCommand({tabId:e.tabId},"Page.handleJavaScriptDialog",{accept:!0},()=>{chrome.runtime.lastError})});async function Y(){const t=(await chrome.storage.local.get(_))[_];if(t!==void 0&&await q(t))return t;t!==void 0&&await chrome.windows.remove(t).catch(()=>{});const o=await chrome.windows.create({focused:!1,state:"minimized"});if(!(o!=null&&o.id))throw new Error("automation_window_create_failed");return await chrome.storage.local.set({[_]:o.id}),o.id}async function k(e,t=!0){const o=await Y(),n=await chrome.tabs.create({windowId:o,url:e,active:t});if(!n.id)throw new Error("tab_create_failed");return await chrome.windows.update(o,{focused:!1,state:"minimized"}).catch(()=>{}),n.id}async function z(){const t=(await chrome.storage.local.get(_))[_];t!==void 0&&!await q(t)&&await chrome.storage.local.remove(_)}async function v(e){await new Promise((t,o)=>{chrome.debugger.attach({tabId:e},H,()=>{chrome.runtime.lastError?o(new Error(chrome.runtime.lastError.message)):t()})}),await i(e,"Page.enable").catch(()=>{})}async function E(e){await new Promise(t=>{chrome.debugger.detach({tabId:e},()=>{chrome.runtime.lastError,t()})})}async function i(e,t,o={}){return await new Promise((n,a)=>{chrome.debugger.sendCommand({tabId:e},t,o,r=>{chrome.runtime.lastError?a(new Error(chrome.runtime.lastError.message)):n(r)})})}async function J(e,t,o){await i(e,"Input.dispatchMouseEvent",{type:"mouseMoved",x:t,y:o,button:"none",buttons:0}),await R(50),await i(e,"Input.dispatchMouseEvent",{type:"mousePressed",x:t,y:o,button:"left",buttons:1,clickCount:1}),await R(50),await i(e,"Input.dispatchMouseEvent",{type:"mouseReleased",x:t,y:o,button:"left",buttons:0,clickCount:1})}async function j(e){var o;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
      const el = document.querySelector('a[href*="/messaging/compose/"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return el.href || null;
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??null}async function X(e,t){var n;const o=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return(n=o==null?void 0:o.result)!=null&&n.value?(await i(e,"Input.insertText",{text:t}),!0):!1}async function D(e){var o;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??{diag:"eval_failed"}}async function G(e){var o;const t=await i(e,"Runtime.evaluate",{expression:`(function() {
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
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)===!0}const Q='[role="dialog"],[aria-modal="true"],.artdeco-modal,.artdeco-toast-item,.artdeco-hovercard';async function A(e){var o;const t=await i(e,"Runtime.evaluate",{expression:`[...document.querySelectorAll('button,[role="button"]')].map(b=>{const r=b.getBoundingClientRect();return{cls:b.className.slice(0,80),aria:b.getAttribute('aria-label')||'',text:b.textContent?.trim().slice(0,30)||'',x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),inModal:!!b.closest('${Q}')}}).filter(b=>b.w>0&&b.h>0&&b.y<800)`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)??[]}function Z(e){for(const t of e)if(/^(dismiss|close|cancel)$/i.test(t.aria)||/artdeco-modal__dismiss/i.test(t.cls)||/dismiss/i.test(t.cls)||t.text==="×"||t.text==="✕"||t.text==="✖")return t;return e.find(t=>t.inModal&&t.w<50&&t.h<50)??null}async function tt(e){const t=await A(e),o=Z(t);return o?(await J(e,o.x+Math.round(o.w/2),o.y+Math.round(o.h/2)),!0):!1}async function et(e,t){var r;const o=await i(e,"Runtime.evaluate",{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}),{w:n,h:a}=((r=o==null?void 0:o.result)==null?void 0:r.value)??{w:1440,h:900};await i(e,"Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.round(n/2),y:Math.round(a/2),deltaX:0,deltaY:t})}async function nt(e){for(let t=0;t<5;t++)await i(e,"Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await R(50),await i(e,"Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27}),await R(150)}async function F(e){return(await i(e,"Page.captureScreenshot",{format:"png",quality:80})).data}function R(e){return new Promise(t=>setTimeout(t,e))}const ot=`(() => {
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
})()`,at=`(() => {
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
})()`,rt=`(() => {
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
})()`;function it(e){const t=e.split("?")[0].match(/linkedin\.com\/company\/([^/?#]+)/i);return t?decodeURIComponent(t[1]).toLowerCase():null}function ct(e){return`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e)}`}const lt=new Set(["il","israel","ישראל","group","ltd","holdings","inc","corp","co"]);function T(e){return e.toLowerCase().replace(/[.,'"()|/\\־-]+/g," ").split(/\s+/).map(t=>t.trim()).filter(t=>t.length>0&&!lt.has(t))}function st(e,t){const o=[...new Set(T(e))];if(o.length===0)return 0;const n=new Set(T(t));return o.filter(r=>n.has(r)).length/o.length}const ut=.5;function dt(e,t,o=ut){if(t.length===0)return null;if(T(e).length===0)return t[0];let n=null,a=-1;for(const r of t){const d=st(e,r.name??"");d>a&&(a=d,n=r)}return a>=o?n:null}function mt(e,t){const o=u=>(u||"").replace(/[‎‏‪-‮⁦-⁩]/g,""),n=t.map(u=>o(u).replace(/\s+/g," ").trim()).filter(Boolean),a=n.filter((u,g)=>g===0||u!==n[g-1]),r=o(e).split("•")[0].replace(/\s*★.*/,"").replace(/\+\d+/g," ").replace(/\s+/g," ").trim();if(!r||r.length<2)return null;const d=o(e).replace(/\s+/g," ").trim();let l=null;for(const u of a){const g=u.match(/\b(1st|2nd|3rd\+?)\b/);if(g){l=g[1].charAt(0)==="3"?"3rd":g[1];break}const I=u.match(/•\s*(ראשון|שני|שלישי)/);if(I){l=I[1]==="ראשון"?"1st":I[1]==="שני"?"2nd":"3rd";break}}let c=null;for(const u of a){const g=u.match(/^(connect|follow|following|pending|message)$/i);if(g){c=g[1].toLowerCase();break}if(/^(התחבר|להתחבר|התחברות)$/.test(u)){c="connect";break}if(/^עוקב$/.test(u)){c="following";break}if(/^(עקוב|מעקב|לעקוב)$/.test(u)){c="follow";break}if(/^(ממתין|בהמתנה)$/.test(u)){c="pending";break}if(/הודעה/.test(u)){c="message";break}}const s=/(^view .*profile$|^message$|^connect$|^follow$|^following$|^pending$|^save$|^more$|degree connection$|mutual connection|other mutual|\bfollowers?$|^status is |^• )/i,f=a.filter(u=>u!==r&&u!==d&&!s.test(u)&&!/^(1st|2nd|3rd\+?)$/.test(u)&&!/^(התחבר|להתחבר|התחברות|עוקב|עקוב|מעקב|לעקוב|ממתין|בהמתנה|הודעה|שליחת הודעה)$/.test(u)),h=f[0]||null;let w=null,b=null;if(h){const u=h.match(/^(.*?)\s+at\s+(.+)$/);u?(w=u[1].trim(),b=u[2].trim()):w=h}let C=null;for(let u=1;u<f.length;u++){const g=f[u];if(/,/.test(g)||/israel|ישראל/i.test(g)){C=g;break}}return{name:r,headline:h,title:w,company:b,location:C,degree:l,cardAction:c}}const ft=`(() => {
  const parseCardFields = ${mt.toString()};
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
})()`;function wt(e,t){const o=e.filter(n=>n.current);if(o.length>0){const n=o.reduce((a,r)=>(r.startDate??"")>(a.startDate??"")?r:a);return{title:n.title??null,company:n.company??null}}if(t){const n=t.match(/^(.*?)\s+at\s+(.+)$/i);return n?{title:n[1].trim(),company:n[2].trim()}:{title:t,company:null}}return{title:null,company:null}}const ht=`(() => {
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
})()`;async function pt(e){var n;const t=await k(e,!1);let o=!1;try{await gt(t),await i(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await v(t),o=!0,await i(t,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await i(t,"Page.enable",{}).catch(()=>{}),await i(t,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{}),await V(1500);const a=await i(t,"Runtime.evaluate",{expression:ht,returnByValue:!0}),{entries:r,headline:d}=((n=a==null?void 0:a.result)==null?void 0:n.value)??{entries:[],headline:null};return wt(r,d)}finally{o&&await E(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{})}}async function gt(e,t=3e4){const o=Date.now();for(;Date.now()-o<t;){const n=await chrome.tabs.get(e).catch(()=>null);if(!n)throw new Error("tab_closed");if(n.status==="complete")return;await V(500)}throw new Error("tab_load_timeout")}function V(e){return new Promise(t=>setTimeout(t,e))}const bt=30,yt=60,L="0.4.3";let P=!1;async function x(e){await chrome.storage.local.set({swActiveTabId:e})}async function S(){await chrome.storage.local.remove("swActiveTabId")}(async()=>{try{await z().catch(()=>{});const{swActiveTabId:e}=await chrome.storage.local.get("swActiveTabId");e&&(console.log("[startup] closing orphaned tab",e),await chrome.tabs.remove(e).catch(()=>{}),await S())}catch(e){console.warn("[startup] cleanup error",e)}})();chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create("poll",{periodInMinutes:bt/60}),chrome.alarms.create("hb",{periodInMinutes:yt/60})});B().then(e=>{e&&$(L)});chrome.runtime.onMessage.addListener(e=>{(e==null?void 0:e.type)==="heartbeat"&&$(L)});chrome.alarms.onAlarm.addListener(async e=>{if(await B()&&!await K()){if(e.name==="hb"){await $(L);return}if(e.name==="poll"){if(P){console.log("[poll] task already running, skipping");return}for(;await _t(););}}});async function _t(){let e;try{e=await W()}catch(t){return console.warn("poll error",t),!1}if(!e)return!1;P=!0;try{const t=await vt(e);await M(e.id,{ok:!0,result:t})}catch(t){const o=t.code??"unknown",n=t.screenshot,a=t.buttons,r=t.diag;await M(e.id,{ok:!1,errorCode:o,errorMessage:t.message,...n||a||r?{result:{debugScreenshot:n,buttons:a,diag:r}}:{}})}finally{P=!1}return!0}async function vt(e){const t=e.payload;if(e.kind==="SEND"){if(!t.linkedinUrl||!t.text)throw m(new Error("missing_payload"),"bad_payload");return await kt(t.linkedinUrl,t.text,t.recipientName??"")}if(e.kind==="CHECK_REPLY")return{replyDetected:!1,replies:[]};if(e.kind==="SEARCH"){if(!t.searchUrl)throw m(new Error("missing_payload"),"bad_payload");return await St(t.searchUrl)}if(e.kind==="CONNECT"){if(!t.profileUrl)throw m(new Error("missing_payload"),"bad_payload");return await Rt(t.profileUrl)}if(e.kind==="RESOLVE_COMPANY"){if(!t.linkedinUrl&&!t.name)throw m(new Error("missing_payload"),"bad_payload");return await Ct(t.linkedinUrl??null,t.name??null)}if(e.kind==="SCRAPE_PROFILE"){if(!t.linkedinUrl)throw m(new Error("missing_payload"),"bad_payload");return await pt(t.linkedinUrl)}throw m(new Error("unknown_kind"),"unsupported_kind")}async function Et(e){var o;const t={};try{const n=await chrome.tabs.get(e);t.tabUrl=n.url??null,t.tabStatus=n.status??null,t.tabTitle=n.title??null,t.windowId=n.windowId??null}catch(n){t.tabGetError=String((n==null?void 0:n.message)??n)}try{if((o=chrome.management)!=null&&o.getAll){const n=await chrome.management.getAll();t.extensions=n.flatMap(a=>a.type==="extension"?[{id:a.id,name:a.name,enabled:a.enabled}]:[])}else t.extensions="management_api_unavailable"}catch(n){t.managementError=String((n==null?void 0:n.message)??n)}return t}async function kt(e,t,o=""){const n=await k("about:blank",!1);await x(n);let a=!1,r=null;try{await y(n),await v(n),a=!0,await i(n,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(n,"Page.navigate",{url:e}),await y(n),await p(2500);const d=await chrome.tabs.get(n);if(d.url&&d.url.includes("/checkpoint"))throw m(new Error("checkpoint"),"checkpoint");await nt(n),await p(500),await tt(n)&&(console.log("[agent] dismissed popup before Message click"),await p(500));const c=await j(n);if(!c)throw m(new Error("message_button_not_found"),"not_messageable");console.log("[agent] composeUrl:",c),await chrome.tabs.update(n,{url:c}),await y(n);let s=await D(n);const f=Date.now()+15e3;for(;Date.now()<f&&s.msgForm===0&&s.anyEditable===0;)await p(500),s=await D(n);console.log("[agent] post-nav diag:",s);const h=await X(n,t);if(console.log("[agent] typeIntoCompose:",h),!h)throw m(new Error(`compose_insert_failed diag=${JSON.stringify(s)}`),"compose_insert_failed");await p(600);const w=await G(n);if(console.log("[agent] clickSendButton:",w),!w)throw m(new Error("send_button_not_found"),"send_button_not_found");return await p(1500),{sentAt:new Date().toISOString(),conversationUrl:e,steps:3}}catch(d){r=d;const l=await chrome.tabs.get(n).catch(()=>null);if(l!=null&&l.url&&(r.message=`${r.message} (url=${l.url})`),r.diag=await Et(n).catch(()=>({diagError:!0})),a)try{const[c,s]=await Promise.all([F(n),A(n)]);r.screenshot=c,r.buttons=s}catch{}throw r}finally{a&&(await i(n,"Page.navigate",{url:"about:blank"}).catch(()=>{}),await p(300),await E(n).catch(()=>{})),await chrome.tabs.remove(n).catch(()=>{}),await S()}}async function N(e){await i(e,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(e,"Emulation.setFocusEmulationEnabled",{enabled:!0}).catch(()=>{}),await i(e,"Page.enable",{}).catch(()=>{}),await i(e,"Page.setWebLifecycleState",{state:"active"}).catch(()=>{})}async function St(e){var n,a;const t=await k(e,!1).catch(()=>{throw m(new Error("tab_create_failed"),"tab_load")});await x(t);let o=!1;try{await y(t),await p(1500);const r=await chrome.tabs.get(t);if(r.url&&r.url.includes("/checkpoint"))throw m(new Error("checkpoint"),"checkpoint");await v(t),o=!0,await N(t);let d;for(let l=0;l<12;l++){await et(t,1500),await p(1200);const c=await i(t,"Runtime.evaluate",{expression:ft,returnByValue:!0});if(d=(n=c==null?void 0:c.result)==null?void 0:n.value,d&&(d.candidates.length>0||((a=d.debug)==null?void 0:a.noResults)===!0))break}if(!d)throw m(new Error("scrape_returned_null"),"scrape_failed");return d}finally{o&&await E(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await S()}}async function Ct(e,t){var r,d;const o=e??ct(t??""),n=await k(o,!1).catch(()=>{throw m(new Error("tab_create_failed"),"tab_load")});await x(n);let a=!1;try{await y(n),await p(2500);let l=await chrome.tabs.get(n);if(l.url&&l.url.includes("/checkpoint"))throw m(new Error("checkpoint"),"checkpoint");if(await v(n),a=!0,await N(n),!e){const h=await i(n,"Runtime.evaluate",{expression:rt,returnByValue:!0}),w=((r=h==null?void 0:h.result)==null?void 0:r.value)??[];if(w.length===0)throw m(new Error("company_not_found"),"not_found");const b=dt(t??"",w);if(!b)throw m(new Error("ambiguous_match"),"ambiguous_match");const C=b.companyUrl;if(await E(n).catch(()=>{}),a=!1,await chrome.tabs.update(n,{url:C}),await y(n),await p(2500),l=await chrome.tabs.get(n),l.url&&l.url.includes("/checkpoint"))throw m(new Error("checkpoint"),"checkpoint");await v(n),a=!0,await N(n)}const c=await i(n,"Runtime.evaluate",{expression:at,returnByValue:!0}),s=(d=c==null?void 0:c.result)==null?void 0:d.value;if(!s||!s.companyId)throw m(new Error("company_id_not_found"),"no_id");const f=s.url??(await chrome.tabs.get(n)).url??o;return{companyId:s.companyId,resolvedName:s.resolvedName??null,slug:it(f),matchedUrl:f}}finally{a&&await E(n).catch(()=>{}),await chrome.tabs.remove(n).catch(()=>{}),await S()}}async function O(e,t){var n;const o=await i(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((n=o==null?void 0:o.result)==null?void 0:n.value)===!0}async function At(e){var o;const t=await i(e,"Runtime.evaluate",{expression:`(() => {
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
    })()`,returnByValue:!0});return((o=t==null?void 0:t.result)==null?void 0:o.value)===!0}async function Rt(e){var n,a,r;const t=await k("about:blank",!1).catch(()=>{throw m(new Error("tab_create_failed"),"tab_load")});await x(t);let o=!1;try{await y(t),await v(t),o=!0,await i(t,"Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:!1}).catch(()=>{}),await i(t,"Page.navigate",{url:e}),await y(t),await p(4e3);const d=await chrome.tabs.get(t);if(d.url&&d.url.includes("/checkpoint"))throw m(new Error("checkpoint"),"checkpoint");const l=(e.split("/in/")[1]??"").replace(/[/?#].*/,"").toLowerCase();let c=await O(t,l);if(console.log("[connect] clickConnectInPage:",c),!c){const f=await i(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const more = btns.find(b => /^more$/i.test((b.textContent||'').trim()) || /^more actions$/i.test(b.getAttribute('aria-label')||''));
          if (more) { more.click(); return true; }
          return false;
        })()`,returnByValue:!0});(n=f==null?void 0:f.result)!=null&&n.value&&(await p(800),c=await O(t,l),console.log("[connect] clickConnectInPage after More:",c))}if(!c){const f=await i(t,"Runtime.evaluate",{expression:ot,returnByValue:!0}),h=(a=f==null?void 0:f.result)==null?void 0:a.value;if(h==="pending")throw m(new Error("invitation_already_pending"),"already_pending");if(h==="connected")throw m(new Error("already_connected"),"already_connected");const w=await i(t,"Runtime.evaluate",{expression:`(() => {
          const btns = [...document.querySelectorAll('button,[role="button"]')];
          const hasFollow = btns.some(b => /^follow$/i.test((b.textContent||'').trim()) || /^follow\\b/i.test(b.getAttribute('aria-label')||''));
          const hasConnect = btns.some(b => /^connect$/i.test((b.textContent||'').trim()) || /\\bto connect$/i.test(b.getAttribute('aria-label')||''));
          return hasFollow && !hasConnect;
        })()`,returnByValue:!0});throw(r=w==null?void 0:w.result)!=null&&r.value?m(new Error("follow_only"),"follow_only"):m(new Error("connect_button_not_found"),"no_connect")}let s=!1;for(let f=0;f<6&&(await p(f===0?1500:800),s=await At(t),!s);f++);if(console.log("[connect] clickSendInPage:",s),!s){const f=await A(t);console.log("[connect] afterButtons:",f.map(w=>`"${w.text}" aria="${w.aria}"`));const h=f.flatMap(w=>{const b=(w.text||w.aria||"").trim();return b?[b]:[]}).slice(0,12).join(" | ");throw m(new Error(`send_dialog_not_found; buttons=[${h}]`),"already_or_blocked")}return await p(800),{sentAt:new Date().toISOString()}}catch(d){const l=d,c=await chrome.tabs.get(t).catch(()=>null);if(c!=null&&c.url&&(l.message=`${l.message} (url=${c.url})`),o&&l.code!=="already_pending"&&l.code!=="already_connected"&&l.code!=="checkpoint")try{const[s,f]=await Promise.all([F(t),A(t)]);l.screenshot=s,l.buttons=f}catch{}throw l}finally{o&&await E(t).catch(()=>{}),await chrome.tabs.remove(t).catch(()=>{}),await S()}}async function y(e){const t=await chrome.tabs.get(e).catch(()=>null);(t==null?void 0:t.status)!=="complete"&&await new Promise((o,n)=>{let a=!1;const r=s=>{a||(a=!0,clearTimeout(d),clearInterval(c),chrome.tabs.onUpdated.removeListener(l),s())},d=setTimeout(()=>r(()=>n(m(new Error("tab_load_timeout"),"tab_load"))),3e4),l=(s,f)=>{s===e&&f.status==="complete"&&r(o)};chrome.tabs.onUpdated.addListener(l);const c=setInterval(async()=>{const s=await chrome.tabs.get(e).catch(()=>null);if(!s)return r(()=>n(m(new Error("tab_closed"),"tab_load")));s.status==="complete"&&r(o)},1e3)})}function p(e){return new Promise(t=>setTimeout(t,e))}function m(e,t){return e.code=t,e}
