// Hybrid RAG frontend — plain JS, no build step, deployable directly to GitHub Pages.
// Configure the backend API base URL below (or via the Settings panel, stored in localStorage).

const DEFAULT_API_BASE = "http://localhost:7860";

const state = {
  apiBase: localStorage.getItem("hybridrag_api_base") || DEFAULT_API_BASE,
  apiKey: localStorage.getItem("hybridrag_api_key") || "",
  history: [], // [{role, content}]
};

const root = document.getElementById("root");

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function render() {
  root.innerHTML = "";
  root.appendChild(
    el("div", { class: "app" }, [
      el("header", { class: "app-header" }, [
        el("h1", {}, "Hybrid RAG"),
        el("p", {}, "Hybrid search + re-ranking + streaming, grounded answers with citations."),
      ]),
      settingsPanel(),
      uploadPanel(),
      chatPanel(),
      el("footer", {}, [
        "Built as a hybrid-RAG showcase. Backend must be running and reachable at the API base above. ",
        el("a", { href: "https://github.com/Charan-Hari/hybrid-rag", target: "_blank" }, "Source on GitHub"),
      ]),
    ])
  );
}

function settingsPanel() {
  const apiBaseInput = el("input", {
    type: "text",
    id: "apiBase",
    value: state.apiBase,
  });
  const apiKeyInput = el("input", {
    type: "password",
    id: "apiKey",
    value: state.apiKey,
    placeholder: "optional",
  });

  const save = () => {
    state.apiBase = apiBaseInput.value.trim().replace(/\/$/, "");
    state.apiKey = apiKeyInput.value.trim();
    localStorage.setItem("hybridrag_api_base", state.apiBase);
    localStorage.setItem("hybridrag_api_key", state.apiKey);
    checkHealth();
  };

  apiBaseInput.addEventListener("change", save);
  apiKeyInput.addEventListener("change", save);

  return el("div", { class: "panel" }, [
    el("div", { class: "settings-grid" }, [
      el("div", {}, [el("label", {}, "Backend API base URL"), apiBaseInput]),
      el("div", {}, [el("label", {}, "API key (if configured on server)"), apiKeyInput]),
    ]),
    el("p", { class: "status-line", id: "healthStatus" }, "Checking backend..."),
  ]);
}

function uploadPanel() {
  const fileInput = el("input", { type: "file", id: "fileInput", accept: ".pdf,.docx,.md,.markdown,.txt" });
  const statusEl = el("span", { class: "status-line", id: "uploadStatus" }, "");

  const uploadBtn = el(
    "button",
    {
      onclick: async () => {
        const file = fileInput.files[0];
        if (!file) {
          statusEl.textContent = "Choose a file first.";
          return;
        }
        uploadBtn.disabled = true;
        statusEl.textContent = `Uploading ${file.name}...`;
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch(`${state.apiBase}/api/ingest`, {
            method: "POST",
            headers: authHeaders(),
            body: form,
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          statusEl.textContent = `Indexed ${data.filename}: ${data.chunks_added} chunks added.`;
        } catch (err) {
          statusEl.textContent = `Upload failed: ${err.message}`;
        } finally {
          uploadBtn.disabled = false;
        }
      },
    },
    "Upload & Index"
  );

  return el("div", { class: "panel" }, [
    el("div", { class: "upload-row" }, [fileInput, uploadBtn, statusEl]),
  ]);
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.apiKey) headers["X-API-Key"] = state.apiKey;
  return headers;
}

function chatPanel() {
  const log = el("div", { class: "chat-log", id: "chatLog" });
  const textarea = el("textarea", { id: "queryInput", placeholder: "Ask a question about your uploaded documents..." });

  const send = async () => {
    const query = textarea.value.trim();
    if (!query) return;
    textarea.value = "";
    appendMessage(log, "user", query);
    state.history.push({ role: "user", content: query });

    const assistantMsg = appendMessage(log, "assistant", "");
    await streamQuery(query, assistantMsg);
  };

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const sendBtn = el("button", { onclick: send }, "Send");

  return el("div", { class: "panel" }, [log, el("div", { class: "query-row" }, [textarea, sendBtn])]);
}

function appendMessage(log, role, text) {
  const msg = el("div", { class: `msg ${role}` }, text);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

async function streamQuery(query, assistantMsg) {
  try {
    const res = await fetch(`${state.apiBase}/api/query`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, history: state.history.slice(0, -1) }),
    });
    if (!res.ok || !res.body) throw new Error(await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answerText = "";
    let citations = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const block of events) {
        const lines = block.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event:"));
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!eventLine || !dataLine) continue;

        const eventName = eventLine.slice(6).trim();
        const data = JSON.parse(dataLine.slice(5).trim());

        if (eventName === "citations") {
          citations = data;
        } else if (eventName === "token") {
          answerText += data.text;
          assistantMsg.textContent = answerText;
        } else if (eventName === "done") {
          state.history.push({ role: "assistant", content: answerText });
          if (citations.length) {
            const citeBox = el(
              "div",
              { class: "citations" },
              citations.map((c) =>
                el("div", { class: "citation" }, [
                  el("b", {}, `[${c.index}] `),
                  `${c.source || "unknown"}${c.page ? `, p.${c.page}` : ""} — score ${c.score}`,
                ])
              )
            );
            assistantMsg.appendChild(citeBox);
          }
          if (answerText.includes("don't have enough relevant information")) {
            assistantMsg.classList.add("fallback");
          }
        }
      }
    }
  } catch (err) {
    assistantMsg.textContent = `Error: ${err.message}`;
    assistantMsg.classList.add("fallback");
  }
}

async function checkHealth() {
  const statusEl = document.getElementById("healthStatus");
  try {
    const res = await fetch(`${state.apiBase}/api/health`);
    const data = await res.json();
    statusEl.textContent = `Backend reachable — ${data.documents_indexed} chunks indexed.`;
  } catch {
    statusEl.textContent = "Backend unreachable. Check the API base URL and that the server is running.";
  }
}

render();
checkHealth();
  
