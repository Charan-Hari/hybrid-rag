const configuredApi = window.HYBRID_RAG_API_BASE || "";
const DEFAULT_API_BASE = configuredApi || (
  window.location.protocol === "http:" || window.location.protocol === "https:"
    ? window.location.origin
    : "http://localhost:7860"
);
const state = {
  apiBase: localStorage.getItem("hybridrag_api_base") || DEFAULT_API_BASE,
  apiKey: "",
  history: [],
  documents: [],
  activeFile: "",
  busy: false,
};

const SAMPLE_DOCUMENTS = [
  {
    id: "embedded-images-tables",
    filename: "embedded-images-tables.pdf",
    title: "Embedded images & tables",
    description: "PDF with a research figure, table, and scientific text.",
    source: "Unstructured example documents",
    sourceUrl: "https://github.com/Unstructured-IO/unstructured-ingest/tree/main/example-docs",
    path: "./samples/embedded-images-tables.pdf",
    summary: "A scientific corrosion study with extracted research text, a polarization table, and embedded figures.",
    signals: [["Research text", 88], ["Tables", 72], ["Figures", 64]],
    facts: [["Format", "Scientific PDF"], ["Content", "Text + table + figures"], ["Best question", "What does the table show?"]],
  },
  {
    id: "project-brief",
    filename: "sample-project-brief.docx",
    title: "Project brief",
    description: "DOCX with headings, priorities, owners, and a delivery table.",
    source: "Hybrid RAG sample pack",
    sourceUrl: "https://github.com/Charan-Hari/hybrid-rag",
    path: "./samples/sample-project-brief.docx",
    summary: "A delivery plan covering project goals, priorities, owners, milestones, and expected outcomes.",
    signals: [["Planning", 92], ["Actions", 78], ["Structure", 86]],
    facts: [["Format", "Delivery plan"], ["Content", "Goals + owners + milestones"], ["Best question", "What are the priorities?"]],
  },
  {
    id: "security-review",
    filename: "sample-security-review.docx",
    title: "Security review",
    description: "DOCX with risk ratings, controls, and review actions.",
    source: "Hybrid RAG sample pack",
    sourceUrl: "https://github.com/Charan-Hari/hybrid-rag",
    path: "./samples/sample-security-review.docx",
    summary: "A practical security review organized around risks, severity ratings, controls, and follow-up actions.",
    signals: [["Risk register", 94], ["Controls", 88], ["Actions", 76]],
    facts: [["Format", "Security review"], ["Content", "Risks + controls + actions"], ["Best question", "Which risks need attention?"]],
  },
  {
    id: "nasa-earth",
    filename: "sample-nasa-earth.md",
    title: "NASA Earth science",
    description: "A starter brief about Earth systems and climate observations.",
    source: "NASA Earth",
    sourceUrl: "https://science.nasa.gov/earth/",
    path: "./samples/sample-nasa-earth.md",
    summary: "An introduction to how NASA observes Earth systems, climate patterns, and changes over time.",
    signals: [["Science", 90], ["Climate", 82], ["Reference", 70]],
    facts: [["Format", "Earth science note"], ["Content", "Systems + observations"], ["Best question", "What does NASA observe?"]],
  },
  {
    id: "nist-cybersecurity",
    filename: "sample-nist-cybersecurity.md",
    title: "NIST cybersecurity basics",
    description: "A starter guide to the five cybersecurity functions.",
    source: "NIST Cybersecurity Framework",
    sourceUrl: "https://www.nist.gov/cyberframework",
    path: "./samples/sample-nist-cybersecurity.md",
    summary: "A concise guide to the NIST Cybersecurity Framework functions: identify, protect, detect, respond, and recover.",
    signals: [["Security", 95], ["Framework", 91], ["Guidance", 84]],
    facts: [["Format", "Cybersecurity guide"], ["Content", "Five framework functions"], ["Best question", "What are the five functions?"]],
  },
];

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

function showFilePreview(file, sample = null) {
  const preview = document.getElementById("filePreview");
  if (!preview) return;
  const extension = file.name.split(".").pop()?.toUpperCase() || "FILE";
  const icon = extension === "PDF" ? "▤" : extension === "DOCX" ? "▥" : "≡";
  const baseSignals = sample?.signals || (
    extension === "PDF"
      ? [["Text & pages", 82], ["Tables", 55], ["Figures", 38]]
      : extension === "DOCX"
        ? [["Headings", 78], ["Paragraphs", 86], ["Tables", 52]]
        : [["Text", 88], ["Keywords", 74], ["Sections", 62]]
  );
  preview.className = "file-preview";
  const facts = sample?.facts || [["Format", extension], ["Content", "Text extraction"], ["Next step", "Ask a question"]];
  preview.replaceChildren(
    element("div", { class: "preview-topline" }, [
      element("div", { class: "preview-file-icon" }, icon),
      element("div", { class: "preview-title" }, [
        element("div", { class: "preview-kicker" }, "SELECTED FILE"),
        element("strong", {}, file.name),
        element("span", {}, `${extension} · ${formatBytes(file.size)}`),
      ]),
      element("span", { class: "preview-badge" }, "ANALYZING"),
    ]),
    element("p", { id: "previewSummary", class: "preview-summary" }, sample?.summary || summaryForType(extension)),
    element("div", { class: "preview-facts" }, facts.map(([label, value]) =>
      element("div", { class: "preview-fact" }, [
        element("span", {}, label),
        element("strong", {}, value),
      ])
    )),
    element("div", { class: "preview-signals" }, baseSignals.map(([label, value]) =>
      element("div", { class: "preview-signal" }, [
        element("div", { class: "preview-signal-label" }, [element("span", {}, label), element("span", {}, `${value}%`)]),
        element("span", { class: "signal-meter" }, [element("span", { style: `width:${value}%` })]),
      ])
    )),
    element("p", { class: "preview-note" }, sample ? "This sample is ready to index. Ask for a summary or key takeaways after processing." : "The backend will extract text, headings, tables, and page references while indexing.")
  );
  if (!sample && ["MD", "MARKDOWN", "TXT"].includes(extension)) enrichTextPreview(file);
}

async function enrichTextPreview(file) {
  const summary = document.getElementById("previewSummary");
  if (!summary) return;
  try {
    const text = (await file.text()).replace(/\s+/g, " ").trim();
    if (!text) return;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const excerpt = sentences.slice(0, 2).join(" ").slice(0, 240);
    summary.textContent = excerpt + (excerpt.length < text.length ? "…" : "");
  } catch {
    summary.textContent = "The file is selected and ready for backend extraction.";
  }
}

function summaryForType(extension) {
  if (extension === "DOCX") return "A Word document selected. Its headings, paragraphs, and tables will be turned into searchable sections.";
  if (extension === "PDF") return "A PDF selected. Its readable text, page numbers, and table-like content will be analyzed.";
  return "A text-based document selected. Its sections and key terms will be analyzed immediately.";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function authHeaders(extra = {}) {
  return state.apiKey ? { ...extra, "X-API-Key": state.apiKey } : extra;
}

function readableError(error, fallback = "Please check the connection and try again.") {
  try {
    const detail = JSON.parse(error.message)?.detail;
    if (detail) return detail;
  } catch {
    // The response may be plain text.
  }
  if (error.name === "TypeError") return "The assistant is not connected yet. Check the backend URL in Advanced settings.";
  return error.message || fallback;
}

function render() {
  root.replaceChildren(
    element("main", { class: "shell" }, [
      element("header", { class: "topbar" }, [
        element("div", { class: "brand" }, [
          element("span", { class: "brand-mark", "aria-hidden": "true" }, "✦"),
          element("span", {}, "Document Desk"),
        ]),
        element("span", { class: "topbar-note" }, "Private, cited answers from your files"),
      ]),
      element("section", { class: "intro" }, [
        element("div", {}, [
          element("p", { class: "eyebrow" }, "HYBRID RAG WORKSPACE"),
          element("h1", {}, "Understand your documents."),
          element("p", { class: "hero-copy" }, "Upload a file, ask a question, and see the passages that support the answer. No setup is needed when the workspace is connected."),
        ]),
        element("div", { class: "intro-status", id: "healthStatus" }, [
          element("span", { class: "status-dot" }), "Connecting…",
        ]),
      ]),
      element("section", { class: "workspace" }, [
        element("section", { class: "card library-card" }, libraryContent()),
        element("section", { class: "card chat-card" }, chatContent()),
        insightsCard(),
        settingsCard(),
      ]),
      element("footer", {}, [
        "Open source · ",
        element("a", { href: "https://github.com/Charan-Hari/hybrid-rag", target: "_blank", rel: "noreferrer" }, "View source"),
      ]),
    ])
  );
  bindLibrary();
  bindChat();
  checkHealth();
  loadDocuments();
}

function cardHeading(icon, title, description, tone = "blue") {
  return element("div", { class: "card-heading" }, [
    element("div", { class: `icon-box ${tone}`, "aria-hidden": "true" }, icon),
    element("div", {}, [element("h2", {}, title), element("p", {}, description)]),
  ]);
}

function libraryContent() {
  const fileInput = element("input", { id: "fileInput", type: "file", accept: ".pdf,.docx,.md,.markdown,.txt", hidden: "true" });
  const dropzone = element("label", { class: "dropzone", for: "fileInput", tabindex: "0" }, [
    element("span", { class: "upload-icon", "aria-hidden": "true" }, "↑"),
    element("strong", {}, "Add a document"),
    element("span", { class: "muted" }, "Drop a PDF, DOCX, Markdown, or TXT file here"),
  ]);
  return [
    element("div", { class: "card-heading split" }, [
      cardHeading("▤", "Your documents", "Files become searchable sources.", "blue"),
      element("span", { id: "documentCount", class: "count-pill" }, "0 files"),
    ]),
    fileInput,
    dropzone,
    element("div", { id: "uploadStatus", class: "inline-status", role: "status" }),
    element("div", { class: "sample-heading" }, [
      element("strong", {}, "Try a sample"),
      element("span", { class: "muted" }, "No download required"),
    ]),
    element("div", { class: "sample-list" }, SAMPLE_DOCUMENTS.map(sampleCard)),
    element("div", { id: "documentList", class: "document-list" }, [
      element("div", { class: "empty-state" }, "Your library is empty. Add a document to begin."),
    ]),
  ];
}

function sampleCard(sample) {
  return element("article", { class: "sample-card" }, [
    element("div", { class: "sample-card-copy" }, [
      element("strong", {}, sample.title),
      element("span", {}, sample.description),
      element("a", { href: sample.sourceUrl, target: "_blank", rel: "noreferrer" }, `Source: ${sample.source}`),
    ]),
    element("button", {
      class: "sample-button",
      type: "button",
      onclick: () => useSample(sample),
    }, "Use sample"),
  ]);
}

async function useSample(sample) {
  resetConversation(sample.filename);
  const status = document.getElementById("uploadStatus");
  status.className = "inline-status pending";
  status.textContent = `Loading ${sample.filename}…`;
  try {
    const response = await fetch(sample.path);
    if (!response.ok) throw new Error(`Sample file unavailable (${response.status})`);
    const file = new File([await response.blob()], sample.filename);
    await uploadFile(file, sample);
  } catch (error) {
    status.className = "inline-status error";
    status.textContent = `Could not load the sample: ${readableError(error)}`;
  }
}

function bindLibrary() {
  const input = document.getElementById("fileInput");
  const dropzone = document.querySelector(".dropzone");
  input.addEventListener("change", () => uploadFile(input.files?.[0]));
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  }));
  dropzone.addEventListener("drop", (event) => uploadFile(event.dataTransfer.files?.[0]));
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
}

async function uploadFile(file, sample = null) {
  const status = document.getElementById("uploadStatus");
  if (!file) return;
  resetConversation(file.name);
  showFilePreview(file, sample);
  status.className = "inline-status pending";
  status.textContent = `Reading ${file.name}…`;
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${state.apiBase}/api/ingest`, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    state.activeFile = result.filename;
    status.className = "inline-status success";
    status.textContent = `${result.filename} is ready · ${result.chunks_added} searchable sections`;
    const badge = document.querySelector("#filePreview .preview-badge");
    if (badge) {
      badge.textContent = "READY";
      badge.className = "preview-badge ready";
    }
    showToast(`${file.name} analyzed and ready`);
    document.getElementById("fileInput").value = "";
    await loadDocuments();
    checkHealth();
  } catch (error) {
    status.className = "inline-status error";
    status.textContent = `Could not add the file: ${readableError(error)}`;
  }
}

function chatContent() {
  return [
    element("div", { class: "card-heading split" }, [
      cardHeading("✦", "Ask questions", "Answers stay grounded in your uploaded files.", "violet"),
      element("div", { class: "chat-actions" }, [
        element("span", { class: "grounded-pill" }, "CITED ANSWERS"),
        element("button", { id: "newChatButton", class: "secondary-button", type: "button", onclick: () => resetConversation() }, "New chat"),
      ]),
    ]),
    element("section", { id: "filePreview", class: "file-preview empty-preview" }, [
      element("div", { class: "preview-kicker" }, "FILE INSIGHT"),
      element("strong", {}, "Choose a file to see what it contains"),
      element("p", {}, "A quick local readout will appear here before indexing starts."),
    ]),
    element("div", { id: "chatLog", class: "chat-log" }, [
      message("assistant", "Hi! Add a document on the left, then ask me anything about it. I’ll include the supporting passages with every answer."),
    ]),
    element("div", { class: "suggestions" }, [
      suggestion("Give me a short summary"),
      suggestion("What are the key takeaways?"),
      suggestion("What evidence supports the main claim?"),
    ]),
    element("div", { class: "composer" }, [
      element("textarea", { id: "queryInput", rows: "2", placeholder: "Ask a question about your documents…", "aria-label": "Question" }),
      element("button", { class: "primary-button", id: "sendButton", type: "button" }, ["Ask", element("span", { "aria-hidden": "true" }, "↗")]),
    ]),
    element("div", { class: "composer-note" }, "Enter to send · Shift + Enter for a new line"),
  ];
}

function bindChat() {
  const input = document.getElementById("queryInput");
  const button = document.getElementById("sendButton");
  button.addEventListener("click", () => submitQuery(input, button));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuery(input, button);
    }
  });
}

function resetConversation(activeFile = "") {
  state.history = [];
  state.activeFile = activeFile;
  const log = document.getElementById("chatLog");
  if (log) {
    log.replaceChildren(message("assistant", activeFile
      ? `I’m focused on ${activeFile}. Ask about its contents, or choose another file to start a new chat.`
      : "Hi! Add a document, then ask me anything about it."));
  }
}

function showToast(text) {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const toast = element("div", { class: "toast", role: "status" }, [
    element("span", { class: "toast-check" }, "✓"),
    text,
  ]);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function suggestion(text) {
  return element("button", { class: "suggestion", type: "button", onclick: () => {
    const input = document.getElementById("queryInput");
    const button = document.getElementById("sendButton");
    input.value = text;
    submitQuery(input, button);
  } }, text);
}

function insightsCard() {
  return element("section", { class: "card insights-card" }, [
    cardHeading("▥", "Library overview", "A quick view of what is indexed.", "gold"),
    element("div", { id: "insightStats", class: "insight-stats" }),
    element("div", { id: "insightChart", class: "insight-chart" }),
  ]);
}

function settingsCard() {
  const apiInput = element("input", { id: "apiBase", type: "url", value: state.apiBase, placeholder: "https://your-backend.example.com" });
  const keyInput = element("input", { id: "apiKey", type: "password", placeholder: "Only if your administrator enabled one", autocomplete: "off" });
  const save = () => {
    state.apiBase = apiInput.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
    state.apiKey = keyInput.value.trim();
    localStorage.setItem("hybridrag_api_base", state.apiBase);
    checkHealth();
    loadDocuments();
  };
  apiInput.addEventListener("change", save);
  keyInput.addEventListener("change", save);
  return element("details", { class: "advanced-settings card" }, [
    element("summary", {}, ["Advanced connection settings", element("span", { "aria-hidden": "true" }, "⌄")]),
    element("p", { class: "settings-help" }, "Most users can ignore this. It is only needed when this page is not pre-connected to a backend."),
    element("label", {}, ["Backend URL", apiInput]),
    element("label", {}, ["Server key ", element("span", { class: "muted" }, "(optional)"), keyInput]),
  ]);
}

function message(role, text) {
  return element("div", { class: `message ${role}` }, [
    element("div", { class: "avatar", "aria-hidden": "true" }, role === "assistant" ? "✦" : "Y"),
    element("div", { class: "message-body" }, [
      element("div", { class: "message-label" }, role === "assistant" ? "DOCUMENT DESK" : "YOU"),
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
  const answer = addMessage(log, "assistant", "Searching your documents…");
  try {
    const response = await fetch(`${state.apiBase}/api/query`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, source: state.activeFile || null, history: state.history.slice(0, -1) }),
    });
    if (!response.ok || !response.body) throw new Error(await response.text());
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answerText = "";
    let citations = [];
    const handleBlock = (block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) return;
      const payload = JSON.parse(data);
      if (event === "citations") citations = payload;
      if (event === "token") {
        answerText += payload.text;
        answer.textContent = answerText;
        log.scrollTop = log.scrollHeight;
      }
      if (event === "error") {
        answer.textContent = payload.message || "Answer generation failed.";
        answer.parentElement.parentElement.classList.add("error-message");
      }
      if (event === "done") {
        state.history.push({ role: "assistant", content: answerText });
        renderCitations(answer.parentElement, citations);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      blocks.forEach(handleBlock);
    }
    if (buffer.trim()) handleBlock(buffer);
  } catch (error) {
    answer.textContent = readableError(error, "The assistant could not answer right now.");
    answer.parentElement.parentElement.classList.add("error-message");
  } finally {
    state.busy = false;
    button.disabled = false;
  }
}

function renderCitations(container, citations) {
  if (!citations.length) return;
  container.appendChild(element("div", { class: "citations" }, citations.map((citation) =>
    element("details", { class: "citation" }, [
      element("summary", {}, [`[${citation.index}] ${citation.source || "source"}${citation.page ? ` · page ${citation.page}` : ""}`]),
      element("p", {}, citation.excerpt || "Retrieved passage"),
    ])
  )));
}

async function checkHealth() {
  const status = document.getElementById("healthStatus");
  if (!status) return;
  status.className = "intro-status pending";
  status.replaceChildren(element("span", { class: "status-dot" }), "Checking workspace…");
  try {
    const response = await fetch(`${state.apiBase}/api/health`);
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    status.className = "intro-status online";
    status.replaceChildren(element("span", { class: "status-dot" }), `Ready · ${data.documents_indexed} sections indexed`);
  } catch {
    status.className = "intro-status offline";
    status.replaceChildren(element("span", { class: "status-dot" }), "Connect a workspace in Advanced settings");
  }
}

async function loadDocuments() {
  const list = document.getElementById("documentList");
  if (!list) return;
  try {
    const response = await fetch(`${state.apiBase}/api/documents`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await response.text());
    state.documents = await response.json();
    document.getElementById("documentCount").textContent = `${state.documents.length} file${state.documents.length === 1 ? "" : "s"}`;
    list.replaceChildren(...(state.documents.length ? state.documents.map(documentRow) : [
      element("div", { class: "empty-state" }, "Your library is empty. Add a document to begin."),
    ]));
    renderInsights();
  } catch {
    state.documents = [];
    document.getElementById("documentCount").textContent = "not connected";
    list.replaceChildren(element("div", { class: "empty-state error-state" }, "The workspace could not load documents. Check the backend status and try again."));
    renderInsights();
  }
}

function renderInsights() {
  const totalChunks = state.documents.reduce((sum, document) => sum + document.chunks, 0);
  const totalPages = state.documents.reduce((sum, document) => sum + (document.pages?.length || 0), 0);
  document.getElementById("insightStats").replaceChildren(
    stat("Files", state.documents.length),
    stat("Sections", totalChunks),
    stat("Pages", totalPages || "—"),
  );
  const chart = document.getElementById("insightChart");
  const max = Math.max(...state.documents.map((document) => document.chunks), 1);
  chart.replaceChildren(...state.documents.slice(0, 6).map((document) =>
    element("div", { class: "bar-row", title: `${document.source}: ${document.chunks} sections` }, [
      element("span", {}, document.source),
      element("span", { class: "bar-track" }, [
        element("span", { class: "bar-fill", style: `width:${Math.max(8, (document.chunks / max) * 100)}%` }),
      ]),
    ])
  ));
  if (!state.documents.length) chart.appendChild(element("div", { class: "empty-state" }, "Your indexed sections will appear here."));
}

function stat(label, value) {
  return element("div", { class: "stat" }, [element("strong", {}, String(value)), element("span", {}, label)]);
}

function documentRow(document) {
  return element("div", { class: "document-row" }, [
    element("span", { class: "file-icon", "aria-hidden": "true" }, "▧"),
    element("div", { class: "document-meta" }, [
      element("strong", {}, document.source),
      element("span", { class: "muted" }, `${document.chunks} sections${document.pages.length ? ` · ${document.pages.length} pages` : ""}`),
    ]),
    element("button", { class: "delete-button", type: "button", title: `Remove ${document.source}`, "aria-label": `Remove ${document.source}`, onclick: () => deleteDocument(document.source) }, "×"),
  ]);
}

async function deleteDocument(source) {
  if (!confirm(`Remove ${source} from this workspace?`)) return;
  const response = await fetch(`${state.apiBase}/api/documents/${encodeURIComponent(source)}`, { method: "DELETE", headers: authHeaders() });
  if (!response.ok) return;
  await loadDocuments();
  checkHealth();
}

render();
