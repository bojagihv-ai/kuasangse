# kuasangse

## Vertex AI Billing Route Setup

This project now supports both Gemini billing routes:

- Vertex AI route (recommended for GCP billing/credits)
- Gemini Developer API route (API key billing)

## Secrets policy

Do not commit real API keys, service account JSON files, or local credential files to GitHub.
Use `backend/.env` locally and keep only placeholder examples such as `backend/.env.example` in the repository.

For GitHub Actions or hosted deployments, put values like `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SERPAPI_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` in the platform's secret manager instead of source files.

### 1) Configure backend env

Edit `backend/.env`:

```env
GOOGLE_GENAI_USE_VERTEXAI=True
GOOGLE_CLOUD_PROJECT=your_gcp_project_id
GOOGLE_CLOUD_LOCATION=global
SERPAPI_KEY=your_serpapi_key_here
```

If you want the old API-key route instead, set:

```env
GOOGLE_GENAI_USE_VERTEXAI=False
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2) Authenticate for Vertex AI (recommended: Service Account JSON)

Option A: Service Account JSON key (server/batch friendly)

1. Create a Service Account in GCP.
2. Grant `Vertex AI User` (or stricter custom role as needed).
3. Create and download JSON key.
4. Set `GOOGLE_APPLICATION_CREDENTIALS` to that JSON path.

Windows PowerShell:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\secure\\vertex-sa.json"
```

macOS/Linux:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/secure/vertex-sa.json"
```

Option B: User ADC login (quick local test)

```bash
gcloud auth application-default login
```

### 3) Run backend

```bash
cd backend
python app.py
```

When `GOOGLE_GENAI_USE_VERTEXAI=True`, all Gemini calls from backend go through Vertex AI (`project/location` endpoint path), not AI Studio API key billing.

### 4) Verify active billing route

Check backend route status:

```bash
curl http://localhost:5000/api/provider
```

Expected: `"gemini_route": "vertex_ai"`

## Important for `app.html` (GitHub Pages)

`app.html` now supports Vertex via backend proxy:

- Open app settings modal.
- Set `Vertex Backend URL` (example: `http://localhost:5000` or your deployed backend URL).
- API key is optional fallback only.

When backend URL is set, Gemini requests are sent to `/api/gemini/generate-content` on backend, and backend forwards to Vertex AI with ADC credentials.
