# Google Cloud Migration: CNC Web App & Rhino Compute Linux (src2)

This directory contains the modernized container architecture designed for deploying the **CoLab CNC Setup Tool** and **Rhino Compute on Linux** to **Google Cloud Platform (GCP)**.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |         User Browser / Client         |
                      +---------------------------------------+
                                          |
                                          | HTTPS (Port 443/8080)
                                          v
                      +---------------------------------------+
                      |   Container 1: CNC Web Server (GCP)   |
                      |   (Google Cloud Run / GKE / Docker)   |
                      |   - Serves CNC Setup Tool UI at /     |
                      |   - Formats GH DataTrees & solves     |
                      |   - Status & health monitoring        |
                      +---------------------------------------+
                                          |
                                          | Internal / Auth HTTP (Port 80)
                                          | Header: RhinoComputeKey
                                          v
                      +---------------------------------------+
                      |  Container 2: Rhino Compute Linux     |
                      |   (Google Cloud Run / GCE / GKE)      |
                      |   - Ubuntu 24.04 + Rhino.Inside       |
                      |   - McNeel Core-Hour Billing          |
                      |   - Plugins: Miller_Moth (.gha/.dll)  |
                      +---------------------------------------+
```

---

## Directory Layout

```
src2/
├── docker-compose.yml          # Multi-container orchestration for local development
├── README.md                   # This master documentation
├── web-server/                 # Container 1: Web App / CNC Page container
│   ├── Dockerfile              # Node.js 20 slim container (Cloud Run ready)
│   ├── package.json            # Slim dependencies (Express, CORS, Compression, Fetch)
│   ├── .env.example            # Environment variables template
│   ├── README.md               # Container-specific documentation
│   ├── src/
│   │   ├── server.js           # Express app (CNC tool at '/', API routes, graceful shutdown)
│   │   ├── definitions.js      # Grasshopper definition & sidecar JSON parser
│   │   ├── routes/             # /solve, /definition, /api, /wakeStatus
│   │   └── services/           # compute-status.js (Rhino Compute health check)
│   ├── public/                 # Shared UI assets (daisy themes, ui-components.js)
│   └── cnc/                    # Complete CNC Setup Tool frontend & Grasshopper definitions
└── rhino-compute/              # Container 2: Rhino Compute Linux container
    ├── Dockerfile              # Ubuntu 24.04 + Rhino Compute Linux
    ├── entrypoint.sh           # Environment loader & plugin synchronization
    ├── .env.example            # Environment variables (RHINO_TOKEN, RHINO_COMPUTE_KEY)
    ├── README.md               # Setup and licensing guide
    └── plugins/                # Grasshopper plugins directory
        └── README.md           # Instructions for adding Miller_Moth (.gha / .dll)
```

---

## Grasshopper Plugins for CNC Page

The CNC Tool uses the **Miller_Moth** plugin (`MillerMoth.gha` / `MillerMoth.dll` by Timothy Veske-McMahon):
- Components used: `Safeheight Injector`, `Set Milling GCode Stream`, `Generate GCode`, `GCode Visualizer`.
- **Installation**: Place the plugin assembly into `src2/rhino-compute/plugins/`. When the container boots, `entrypoint.sh` automatically installs it into Grasshopper's library directory (`~/.config/Grasshopper/Libraries`).

---

## Local Testing with Docker Compose

1. Clone or navigate to the repository:
   ```bash
   cd src2
   ```

2. Copy the environment template:
   ```bash
   export RHINO_TOKEN="your-mcneel-token"
   export RHINO_COMPUTE_KEY="0bb5131f-1dc8-46c0-9c52-e3bf0b7c83a6"
   ```

3. Launch both containers:
   ```bash
   docker compose up --build
   ```

4. Open [http://localhost:8080](http://localhost:8080) in your browser. The CNC Setup Tool will load immediately.

---

## Google Cloud Deployment Guide

### Prerequisites
- Google Cloud CLI installed (`gcloud`).
- A GCP project with Billing enabled.
- Cloud Run and Artifact Registry APIs enabled:
  ```bash
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
  ```

---

### Step 1: Deploy Rhino Compute Linux to Cloud Run

1. Build and push the Rhino Compute image:
   ```bash
   cd src2/rhino-compute
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/rhino-compute-linux
   ```

2. Deploy the container to Cloud Run:
   ```bash
   gcloud run deploy rhino-compute \
     --image gcr.io/YOUR_PROJECT_ID/rhino-compute-linux \
     --platform managed \
     --region us-central1 \
     --port 80 \
     --memory 4Gi \
     --cpu 2 \
     --timeout 300 \
     --set-env-vars RHINO_TOKEN="YOUR_MCNEEL_TOKEN",RHINO_COMPUTE_KEY="YOUR_KEY" \
     --allow-unauthenticated
   ```
   *Take note of the service URL returned (e.g., `https://rhino-compute-xxxxx-uc.a.run.app`).*

---

### Step 2: Deploy CNC Web Server to Cloud Run

1. Build and push the Web Server image:
   ```bash
   cd ../web-server
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/cnc-web-server
   ```

2. Deploy the container to Cloud Run:
   ```bash
   gcloud run deploy cnc-web-server \
     --image gcr.io/YOUR_PROJECT_ID/cnc-web-server \
     --platform managed \
     --region us-central1 \
     --port 8080 \
     --memory 1Gi \
     --cpu 1 \
     --set-env-vars RHINO_COMPUTE_URL="https://rhino-compute-xxxxx-uc.a.run.app/",RHINO_COMPUTE_KEY="YOUR_KEY" \
     --allow-unauthenticated
   ```

3. Open the resulting URL in your browser to access the live CNC Setup Tool on Google Cloud.
