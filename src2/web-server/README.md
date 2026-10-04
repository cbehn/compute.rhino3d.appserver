# CNC Web App Server Container

Containerized web frontend and API proxy for the **CoLab CNC Setup Tool** designed for **Google Cloud Run** and container runtimes.

---

## Features
- **Root CNC Access**: Serves the CNC tool directly at `/` and `/cnc`.
- **Rhino Compute Integration**: Proxies Grasshopper solves, definition inspection, and healthchecks to Rhino Compute.
- **Sidecar JSON Support**: Automatically attaches UI configuration (camera views, theme palettes, dropdown parameters) to Grasshopper definitions.
- **Cloud-Native**: Optimized container image using Node 20 slim, runs as non-root user, handles graceful shutdown (`SIGTERM`).

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Listening port (Google Cloud Run sets this automatically) | `8080` |
| `RHINO_COMPUTE_URL` | Upstream URL of Rhino Compute Linux instance | `http://localhost:6500/` |
| `RHINO_COMPUTE_KEY` | Rhino Compute API Key (`RhinoComputeKey`) | `""` |
| `NODE_ENV` | Environment mode (`production` / `development`) | `production` |

---

## Local Development & Docker Testing

### 1. Run with Node.js locally
```bash
npm install
RHINO_COMPUTE_URL=http://localhost:6500/ npm start
```

### 2. Build and run via Docker locally
```bash
docker build -t cnc-web-server .
docker run -d -p 8080:8080 \
  -e RHINO_COMPUTE_URL="http://host.docker.internal:6500/" \
  -e RHINO_COMPUTE_KEY="your-api-key" \
  --name cnc-web cnc-web-server
```

Open [http://localhost:8080](http://localhost:8080) to interact with the CNC tool.

---

## Deploy to Google Cloud Run

### 1. Authenticate with Google Cloud
```bash
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
```

### 2. Build and Deploy directly with Google Cloud Build / Cloud Run
```bash
# Submit build to Google Artifact Registry
gcloud builds submit --tag gcr.io/YOUR_GCP_PROJECT_ID/cnc-web-server

# Deploy to Cloud Run
gcloud run deploy cnc-web-server \
  --image gcr.io/YOUR_GCP_PROJECT_ID/cnc-web-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars RHINO_COMPUTE_URL="https://YOUR_RHINO_COMPUTE_SERVICE_URL/",RHINO_COMPUTE_KEY="YOUR_KEY"
```
