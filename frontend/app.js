const DEFAULT_API_BASE = "http://localhost:7860";
const state = {
  apiBase: localStorage.getItem("hybridrag_api_base") || DEFAULT_API_BASE,
  apiKey: "",
  history: [],
  busy: false,
};

const root = document.getElementById("root");

function element(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function authHeaders(extra = {}) {
  return state.apiKey ? { ...extra, "X-API-Key": state.apiKey } : extra;
}

function render() {
  root.replaceChildren(
    element("main", { class: "shell" }, [
      element("header", { class: "hero" }, [
        element("div", { class: "eyebrow" }, ["OPEN-SOURCE RAG LAB", element("span", { class: "live-dot" })]),
        element("h1", {}, ["Ask your documents ", element("span", { class: "gradient-text" }, "better.")]),
        element("p", { class: "hero-copy" }, "Hybrid dense + keyword retrieval, cross-encoder reranking, and cited streaming answers in one transparent demo."),
        element("div", { class: "hero-badges" }, [
          element("span", { class: "badge" }, "Hybrid search"),
          element("span", { class: "badge" }, "Citations"),
          element("span", { class: "badge" }, "Open source"),
        ]),
      ]),
      element("section", { class: "workspace" }, [
        settingsCard(),
        libraryCard(),
        chatCard(),
      ]),
      element("footer", {}, [
        "Built for learning and showcasing production-minded RAG · ",
        element("a", { href: "https://github.com/Charan-Hari/hybrid-rag", target: "_blank", rel: "noreferrer" }, "View source"),
      ]),
    ])
  );
  checkHealth();
  loadDocuments();
}

function settingsCard() {
  const apiInput = element("input", { id: "apiBase", type: "url", value: state.apiBase, placeholder: "https://your-api.example.com" });
  const keyInput = element("input", { id: "apiKey", type: "password", placeholder: "Optional server key" });
  const status = element("div", { id: "healthStatus", class: "connection-status pending" }, [
    element("span", { class: "status-dot" }), "Checking backend…",
  ]);
  const save = () => {
    state.apiBase = apiInput.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
    state.apiKey = keyInput.value.trim();
    localStorage.setItem("hybridrag_api_base", state.apiBase);
    checkHealth();
    loadDocuments();
  };
  apiInput.addEventListener("change", save);
  keyInput.addEventListener("change", save);
  return element("section", { class: "card settings-card" }, [
    element("div", { class: "card-heading" }, [
      element("div", { class: "icon-box purple" }, "⚙"),
      element("div", {}, [element("h2", {}, "Connection"), element("p", {}, "Point the UI at your running FastAPI backend.")]),
    ]),
    element("label", {}, ["Backend URL", apiInput]),
    element("label", {}, ["API key ", element("span", { class: "muted" }, "(not stored)"), keyInput]),
    status,
  ]);
}

function libraryCard() {
  const fileInput = element("input", { id: "fileInput", type: "file", accept: ".pdf,.docx,.md,.markdown,.txt", hidden: "true" });
  const dropzone = element("label", { class: "dropzone", for: "fileInput" }, [
    element("span", { class: "upload-icon" }, "↑"),
    element("strong", {}, "Drop a document here"),
    element("span", { class: "muted" }, "or click to browse · PDF, DOCX, MD, TXT"),
  ]);
  const uploadStatus = element("div", { id: "uploadStatus", class: "inline-status" });
  const list = element("div", { id: "documentList", class: "document-list" }, [
    element("div", { class: "empty-state" }, "No documents indexed yet."),
  ]);
  const upload = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadStatus.textContent = `Indexing ${file.name}…`;
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${state.apiBase}/api/ingest`, { method: "POST", headers: authHeaders(), body: form });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      uploadStatus.textContent = `${result.filename} indexed · ${result.chunks_added} chunks`;
      fileInput.value = "";
      await loadDocuments();
      checkHealth();
    } catch (error) {
      uploadStatus.textContent = `Upload failed: ${error.message}`;
    }
  };
  fileInput.addEventListener("change", upload);
  return element("section", { class: "card library-card" }, [
    element("div", { class: "card-heading split" }, [
      element("div", { class: "heading-group" }, [
        element("div", { class: "icon-box cyan" }, "▤"),
        element("div", {}, [element("h2", {}, "Document library"), element("p", {}, "Add sources for grounded answers.")]),
      ]),
      element("span", { id: "documentCount", class: "count-pill" }, "0 sources"),
    ]),
    fileInput,
    dropzone,
    uploadStatus,
    list,
  ]);
}

function chatCard() {
  const log = element("div", { id: "chatLog", class: "chat-log" }, [
    message("assistant", "Welcome. Upload a document, then ask me a question. I’ll show which passages supported the answer."),
  ]);
  const input = element("textarea", { id: "queryInput", rows: "2", placeholder: "Ask anything about your documents…" });
  const sendButton = element("button", { class: "primary-button", id: "sendButton", onclick: () => submitQuery(input, sendButton) }, ["Send", element("span", { class: "send-arrow" }, "↗")]);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuery(input, sendButton);
    }
  });
  return element("section", { class: "card chat-card" }, [
    element("div", { class: "card-heading split" }, [
      element("div", { class: "heading-group" }, [
        element("div", { class: "icon-box orange" }, "✦"),
        element("div", {}, [element("h2", {}, "Ask your knowledge base"), element("p", {}, "Answers are streamed and grounded in retrieved passages.")]),
      ]),
      element("span", { class: "secure-pill" }, "● GROUNDED MODE"),
    ]),
    log,
    element("div", { class: "suggestions" }, [
      suggestion("Summarize this document"),
      suggestion("What are the key takeaways?"),
      suggestion("What evidence supports the main claim?"),
    ]),
    element("div", { class: "composer" }, [input, sendButton]),
    element("div", { class: "composer-note" }, "Enter to send · Shift + Enter for a new line"),
  ]);
}

function suggestion(text) {
  return element("button", { class: "suggestion", onclick: () => {
    const input = document.getElementById("queryInput");
    input.value = text;
    input.focus();
  } }, text);
}

function message(role, text) {
  const avatar = role === "assistant" ? "✦" : "Y";
  return element("div", { class: `message ${role}` }, [
    element("div", { class: "avatar" }, avatar),
    element("div", { class: "message-body" }, [
      element("div", { class: "message-label" }, role === "assistant" ? "HYBRID RAG" : "YOU"),
      element("div", { class: "message-text" }, text),
    ]),
  ]);
}

function addMessage(log, role, text) {
  const node = message(role, text);
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  return node.querySelector(".message-text");
}

async function submitQuery(input, button) {
  const query = input.value.trim();
  if (!query || state.busy) return;
  state.busy = true;
  button.disabled = true;
  input.value = "";
  const log = document.getElementById("chatLog");
  addMessage(log, "user", query);
  state.history.push({ role: "user", content: query });
  const answer = addMessage(log, "assistant", "Thinking…");
  try {
    const response = await fetch(`${state.apiBase}/api/query`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, history: state.history.slice(0, -1) }),
    });
    if (!response.ok || !response.body) throw new Error(await response.text());
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answerText = "";
    let citations = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === "citations") citations = payload;
        if (event === "token") {
          answerText += payload.text;
          answer.textContent = answerText;
          log.scrollTop = log.scrollHeight;
        }
        if (event === "done") {
          state.history.push({ role: "assistant", content: answerText });
          renderCitations(answer.parentElement, citations);
        }
      }
    }
  } catch (error) {
    answer.textContent = `Unable to reach the backend: ${error.message}`;
    answer.parentElement.parentElement.classList.add("error-message");
  } finally {
    state.busy = false;
    button.disabled = false;
  }
}

function renderCitations(container, citations) {
  if (!citations.length) return;
  const list = element("div", { class: "citations" }, citations.map((citation) =>
    element("details", { class: "citation" }, [
      element("summary", {}, [`[${citation.index}] ${citation.source || "source"}${citation.page ? ` · page ${citation.page}` : ""}`]),
      element("p", {}, citation.excerpt || "Retrieved passage"),
    ])
  ));
  container.appendChild(list);
}

async function checkHealth() {
  const status = document.getElementById("healthStatus");
  if (!status) return;
  try {
    const response = await fetch(`${state.apiBase}/api/health`);
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    status.className = "connection-status online";
    status.replaceChildren(element("span", { class: "status-dot" }), `Backend online · ${data.documents_indexed} chunks indexed`);
  } catch {
    status.className = "connection-status offline";
    status.replaceChildren(element("span", { class: "status-dot" }), "Backend offline · set the API URL above");
  }
}

async function loadDocuments() {
  const list = document.getElementById("documentList");
  if (!list) return;
  try {
    const response = await fetch(`${state.apiBase}/api/documents`, { headers: authHeaders() });
    if (!response.ok) throw new Error("unavailable");
    const documents = await response.json();
    document.getElementById("documentCount").textContent = `${documents.length} source${documents.length === 1 ? "" : "s"}`;
    list.replaceChildren(...(documents.length ? documents.map(documentRow) : [
      element("div", { class: "empty-state" }, "No documents indexed yet."),
    ]));
  } catch {
    document.getElementById("documentCount").textContent = "offline";
    list.replaceChildren(element("div", { class: "empty-state" }, "Connect a backend to view your library."));
  }
}

function documentRow(document) {
  return element("div", { class: "document-row" }, [
    element("span", { class: "file-icon" }, "▧"),
    element("div", { class: "document-meta" }, [
      element("strong", {}, document.source),
      element("span", { class: "muted" }, `${document.chunks} chunks${document.pages.length ? ` · ${document.pages.length} pages` : ""}`),
    ]),
    element("button", { class: "delete-button", title: `Delete ${document.source}`, onclick: () => deleteDocument(document.source) }, "×"),
  ]);
}

async function deleteDocument(source) {
  if (!confirm(`Remove ${source} from the knowledge base?`)) return;
  const response = await fetch(`${state.apiBase}/api/documents/${encodeURIComponent(source)}`, { method: "DELETE", headers: authHeaders() });
  if (!response.ok) return;
  await loadDocuments();
  checkHealth();
}

render();
