import { clearToken, getApiBase, getToken, setApiBase, setToken, isPaused, setPaused } from "./lib/storage";
import { validateToken } from "./lib/api";

async function render() {
  const token = await getToken();
  const paused = await isPaused();
  const storedBase = await getApiBase();
  const apiBaseInput = document.getElementById("api-base") as HTMLInputElement;
  if (apiBaseInput && !apiBaseInput.value) apiBaseInput.value = storedBase;

  const card = document.getElementById("status-card")!;
  const label = document.getElementById("status-label")!;
  const desc = document.getElementById("status-desc")!;
  const headerSub = document.getElementById("header-sub")!;
  const connectForm = document.getElementById("connect-form")!;
  const actions = document.getElementById("actions")!;
  const pauseBtn = document.getElementById("pause-btn")!;

  card.className = "status-card";
  // Which server the extension is actually talking to. Without this the popup looks
  // identical whether it is pointed at prod or a dev server, and a reconnect silently
  // falls back to prod when the field is left empty.
  const baseHost = (() => {
    try { return new URL(storedBase).host; } catch { return storedBase; }
  })();

  if (!token) {
    card.classList.add("disconnected");
    label.textContent = "לא מחובר";
    desc.textContent = "הדבק token כדי להתחיל לשלוח הודעות LinkedIn אוטומטית.";
    headerSub.textContent = "נדרש חיבור";
    connectForm.style.display = "";
    actions.style.display = "none";
  } else if (paused) {
    card.classList.add("paused");
    label.textContent = "מושהה";
    desc.textContent = `שליחת הודעות מושהית. לחצי על "המשך" כדי לחדש. · ${baseHost}`;
    headerSub.textContent = "פועל ב-background";
    connectForm.style.display = "none";
    actions.style.display = "";
    pauseBtn.textContent = "המשך";
  } else {
    card.classList.add("connected");
    label.textContent = "פעיל";
    desc.textContent = `הודעות LinkedIn ישלחו אוטומטית כשיש משימות ממתינות. · ${baseHost}`;
    headerSub.textContent = "פועל ב-background";
    connectForm.style.display = "none";
    actions.style.display = "";
    pauseBtn.textContent = "השהה";
  }
}

document.getElementById("connect-btn")!.addEventListener("click", async () => {
  const tokenInput = document.getElementById("token") as HTMLInputElement;
  const apiBaseInput = document.getElementById("api-base") as HTMLInputElement;
  const token = tokenInput.value.trim();
  const apiBase = (apiBaseInput.value.trim() || "https://sales.triolla.io").replace(/\/$/, "");
  if (!token) { alert("הדבק token תחילה"); return; }

  const btn = document.getElementById("connect-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "מתחבר...";

  const r = await validateToken(token, apiBase);
  if (!r.ok) {
    alert("Token לא תקין — בדקי בהגדרות ונסי שוב");
    btn.disabled = false;
    btn.textContent = "התחברות";
    return;
  }

  await setApiBase(apiBase);
  await setToken(token);
  tokenInput.value = "";
  chrome.runtime.sendMessage({ type: "heartbeat" });
  await render();
});

document.getElementById("disconnect-btn")!.addEventListener("click", async () => {
  if (!confirm("להתנתק? תצטרכי token חדש כדי להתחבר שוב.")) return;
  await clearToken();
  await render();
});

document.getElementById("pause-btn")!.addEventListener("click", async () => {
  await setPaused(!(await isPaused()));
  await render();
});

render();
