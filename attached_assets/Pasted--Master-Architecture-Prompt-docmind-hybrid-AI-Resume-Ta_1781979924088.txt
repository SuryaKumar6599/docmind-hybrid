# 🚀 Master Architecture Prompt: `docmind-hybrid` (AI Resume Tailoring & Tracker)

## 🛑 CRITICAL INSTRUCTION: DESIGN FIRST
**Act as a Principal AI Architect and Expert Full-Stack Engineer.** 
Your primary directive is to **design the system architecture first and wait for my explicit approval before writing any implementation code.** 
- Follow industry best practices for clean code, type safety (Python/TypeScript), testing, and comprehensive documentation.
- Do not output implementation code (like full React components or FastAPI routes) in your first response. Only output the architectural design, database schemas, API contracts, and prompt templates.
- Once I approve the design, I will ask you to proceed with the implementation.

---

## 🧠 Context & Token Optimization Strategy (`claude.md`)
To build a world-class system, you must optimize both the application's context window and your own reasoning context. The application will utilize the following token-optimization stack, which should be documented in a root-level `claude.md` file for future AI assistants working on this repo:

1. **microsoft/LLMLingua**: Used in the Local FastAPI worker to compute token perplexity and strip low-entropy boilerplate (e.g., "Responsible for collaborating with...") from resumes and JDs before LLM inference.
2. **yamadashy/repomix**: Used to pack the `docmind-hybrid` codebase into a single clean text file when requesting complex refactors from AI agents.
3. **open-compress/claw-compactor**: Used to compress dense JSON payloads (like structured extraction outputs) traveling between Supabase and the Local FastAPI worker via AST-aware compression.
4. **felixsim/bonsai-memory**: Conceptually applied to the Application Tracker. Instead of flat text history, we use progressive disclosure to manage long-term user interaction and application states, cutting active context usage by 70-95%.

---

## 1. Existing Codebase (`docmind-hybrid`)
**Current Architecture:**
- **Frontend:** Next.js hosted on Vercel (Free Tier).
- **Database:** Supabase (PostgreSQL + `pgvector` + Storage Buckets + Realtime).
- **AI Engine:** Local Python FastAPI backend running on Apple Silicon (M4), using Ollama (`qwen2.5:7b` for text, `qwen2.5vl:7b` for vision). Exposed to Vercel via a secure tunnel (Cloudflare/ngrok).
- **Core Parsing:** Microsoft `markitdown` to convert PDF/DOCX/PPTX to Markdown.
- **Guardrails:** `instructor` + `pydantic` to force the LLM to output strictly validated, structured JSON (Finite State Machine/Context-Free Grammar principles).

---

## 2. New Requirements (Input)
1. **Document Ingestion:** Convert different doc types to Markdown for LLM inputs to save tokens. Add guardrails to the Qwen LLM, strict system prompts, and utilize `markitdown`.
2. **Resume Upload:** Allow users to upload their base resume in DOCX and PDF formats.
3. **Resume Tailoring & Download:** Compare the uploaded resume with a Job Description (JD). Extract specific skillsets, recommend relevant personal projects, and generate an updated resume. **Crucial:** Allow the user to download the tailored resume in both DOCX and PDF formats.
4. **Application Tracker:** Track application status (Company Name, Role, Application Date, Status, Match Score, etc.). The actual job application is **manual** (user clicks apply externally); the tool only prepares the assets and tracks the workflow.
5. **LLM Extraction & Tokenization:** Use the LLM to extract key skills, recommend projects from JDs/documents, and implement prompt tokenization to ensure Resume + JD fits within the LLM's context window without degradation.

---

## 3. Objectives & Theoretical Foundations
The architecture must align with established academic theories and production-grade patterns:
- **"Lost in the Middle" Mitigation:** When combining a massive JD with a resume, place extracted Key Job Requirements at the absolute top (System/Context) and the candidate's core matching highlights at the very bottom.
- **Information Entropy & Surprise-Based Compression:** Use local perplexity models (LLMLingua) to strip low-entropy tokens while strictly preserving high-entropy data (specific metrics, exact technologies).
- **Structured Generation via FSMs:** Utilize `instructor` + `pydantic` to ensure the local Ollama engine never returns unparseable text to the Supabase JSONB database.

---

## 4. Feature Lists & Design Patterns
Implement the following features using these specific expert design patterns:

### Feature A: Async Ingestion Worker (Bypassing Vercel Timeouts)
- **Pattern:** *The Async Workers Pattern*.
- **Flow:** Next.js saves raw file to Supabase Storage -> Writes row to `job_applications` (Status: `Pending_Processing`) -> Local FastAPI polls Supabase (or uses webhooks) -> Processes locally via MarkItDown + LLMLingua -> Updates row to `Ready` -> Next.js updates UI via Supabase Realtime listeners.

### Feature B: Token-Aware Dynamic Budget Allocator
- **Pattern:** *Token-Aware Context Management*.
- **Flow:** Treat the 8k context window as a financial budget. Allocate fixed budget for System Prompt (800) and JSON Schema (1200). Allocate dynamic budget to JD (max 3000). Use `context_manager.py` to compute remaining space and intelligently slice/summarize the user's oldest resume bullets using LLMLingua until it perfectly fits the remaining budget.

### Feature C: Multi-Stage Resume Tailoring Pipeline
- **Pattern:** *Multi-Stage Generation Pipeline* (Avoid single-prompt overload).
- **Stage 1 (Analytical):** Feed Compressed Resume + Compressed JD → Output strictly guardrailed JSON of missing keywords, matched skills, and alignment score.
- **Stage 2 (Creative):** Feed original Resume Summary + Stage 1's missing keywords → Output only the rewritten summary text and reordered bullet points.
- **Stage 3 (Structural):** Take text outputs and inject them directly into a `python-docx` template. Export to DOCX and PDF. *Never let the LLM write XML/HTML.*

### Feature D: Application Tracker Dashboard
- **Pattern:** *Bonsai Memory (Progressive Disclosure)*.
- **Flow:** Next.js dashboard querying Supabase. Display high-level status (To Apply, Applied, Interview) with progressive disclosure to view the tailored resume, match score, and JD analysis without overwhelming the UI context.

---

## 5. Constraints
- **100% Free Tier / Local Compute:** Maximize Vercel and Supabase free tiers. All LLM inference must happen locally via Ollama (Zero API costs).
- **Vercel Timeout Limit:** Vercel Free Tier has a strict 10-second execution limit. All heavy AI processing **must** use the Async Worker pattern via Supabase Storage/Queue.
- **Privacy:** No PII (resume data) sent to paid cloud LLMs.
- **Manual Application:** The tool assists in preparation, tailoring, and tracking, but the user manually clicks "Apply" on external portals to avoid bot-detection.

---

## 6. Output Format Requested (Phase 1: Design Confirmation)
Since you must confirm the design before implementation, your response must strictly follow this structure:

1. **Architectural Overview:** A brief summary of how the Async Worker, Token-Aware Budget, and Multi-Stage Pipeline interact.
2. **Supabase Database Schema:** The exact SQL migrations for `job_applications`, `resumes`, and `document_chunks` (including `pgvector` setup).
3. **API Contract:** The JSON payload structure between Next.js, Supabase Storage, and the Local FastAPI Worker.
4. **Multi-Stage Prompt Templates:** The exact System Prompts and Guardrailed Pydantic schemas for Stage 1 (Analytical) and Stage 2 (Creative).
5. **`claude.md` Draft:** A proposed markdown file to be placed in the root of the repo to guide future AI agents on the token-optimization stack and architecture rules.

**STOP AFTER PROVIDING THE DESIGN. Ask me: "Does this architecture meet your approval to proceed with Phase 2 (Implementation Code)?"**