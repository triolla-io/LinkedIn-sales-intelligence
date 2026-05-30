import { clearToken, getApiBase, getToken, setApiBase, setToken, isPaused, setPaused } from "./lib/storage";
import { validateToken } from "./lib/api";

async function render() {
  const token = await getToken();
  const base = await getApiBase();
  const paused = await isPaused();
  (document.getElementById("api") as HTMLInputElement).value = base;
  const disconnectBtn = document.getElementById("disconnect") as HTMLButtonElement;
  const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
  disconnectBtn.style.display = token ? "" : "none";
  pauseBtn.style.display = token ? "" : "none";
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  document.getElementById("status")!.textContent = token
    ? paused ? "Paused" : "Connected"
    : "Disconnected";
}

document.getElementById("connect")!.addEventListener("click", async () => {
  const token = (document.getElementById("token") as HTMLInputElement).value.trim();
  const base = (document.getElementById("api") as HTMLInputElement).value.trim();
  if (!token) { alert("Paste your token first"); return; }
  const r = await validateToken(token, base);
  if (!r.ok) { alert("Invalid token — check the app and try again"); return; }
  await setApiBase(base);
  await setToken(token);
  (document.getElementById("token") as HTMLInputElement).value = "";
  await render();
});

document.getElementById("disconnect")!.addEventListener("click", async () => {
  await clearToken();
  await render();
});

document.getElementById("pause")!.addEventListener("click", async () => {
  await setPaused(!(await isPaused()));
  await render();
});

render();
