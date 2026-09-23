# Hybrid RAG

Ask questions about your documents and get concise, cited answers grounded in the content you provide.

## The problem

Important information is often buried inside PDFs, Word documents, Markdown files, and text files. Finding a specific answer usually means manually searching across pages, tables, and sections.

Generic AI chat can also produce answers that are not supported by the source document.

## Solution

Document Desk combines document search with AI generation:

- Upload PDF, DOCX, Markdown, or TXT files
- Select a document and see a quick file insight
- Ask questions about the selected document
- Retrieve relevant passages using keyword and semantic search
- Generate answers with Google Gemini
- Show supporting citations and source excerpts
- Keep conversations scoped to the selected document

![Document Desk demo](docs/demo.gif)

## Architecture

```text
                 Upload document
                        |
                        v
              FastAPI ingestion service
                        |
          Extract text, pages, and DOCX tables
                        |
                        v
             Hybrid retrieval index
            /                       \
       BM25 keyword search     Dense feature search
            \                       /
             Combined relevant passages
                        |
                        v
                 Gemini generation
                        |
                        v
          Streamed answer with citations
```

The frontend is a static application hosted on GitHub Pages. The backend runs as a FastAPI service and can be deployed on Render.

## Run locally

### 1. Start the backend

```bash
cd backend
python -m venv .venv
```

Activate the environment:

```bash
# macOS/Linux
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create the environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Add your Google AI Studio key to `backend/.env`:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.6-flash
```

Start the API:

```bash
uvicorn app.main:app --reload --port 7860
```

### 2. Start the frontend

Open a second terminal from the repository root:

```bash
python -m http.server 5500 --directory frontend
```

Open:

```text
http://localhost:5500
```

Select a sample document or upload your own file, then ask a question.

## API service

The backend provides endpoints for:

- Health checks
- Document ingestion
- Document listing
- Document-scoped questions
- Source citations
- Document deletion and index reset

The Gemini API key must remain in the backend environment. Do not place it in frontend files or commit it to GitHub.

## License

MIT
