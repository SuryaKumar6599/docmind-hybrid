# API

Base URL:

- Local: `http://localhost:8000`
- Vercel production: your Cloudflare tunnel URL

## GET /health

Checks that the local backend is alive.

Response:

```json
{
  "status": "ok",
  "runtime": "local-fastapi-ollama"
}
```

## POST /index

Uploads, converts, chunks, embeds, and stores a document.

Request:

- Content type: `multipart/form-data`
- Field: `file`

Example:

```bash
curl -X POST http://localhost:8000/index \
  -F "file=@/path/to/document.pdf"
```

Response:

```json
{
  "document_id": "uuid",
  "document_name": "document.pdf",
  "chunks": 12
}
```

## POST /ask

Retrieves relevant chunks and asks local Qwen for a cited answer.

Request:

```json
{
  "question": "What are the payment terms?",
  "match_count": 5
}
```

Example:

```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the payment terms?","match_count":5}'
```

Response:

```json
{
  "answer": "Payment is due within 30 days.",
  "citations": [
    {
      "chunk_id": "uuid",
      "document_name": "invoice.pdf",
      "quote": "Payment is due within 30 days"
    }
  ],
  "sources": [
    {
      "id": "uuid",
      "document_id": "uuid",
      "document_name": "invoice.pdf",
      "chunk_index": 3,
      "content": "Source text...",
      "metadata": {},
      "similarity": 0.82
    }
  ]
}
```
