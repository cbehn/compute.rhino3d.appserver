# Rhino Compute Linux Container

Official containerized environment for **Rhino Compute on Linux**, optimized for deployment on **Google Cloud Platform (Cloud Run, GKE, or Compute Engine Container VM)**.

---

## Overview

McNeel officially supports Rhino Compute on Linux using **Ubuntu Server 24.04** (Noble Numbat) and Microsoft **.NET 9.0.102**.
Official documentation: [Getting Started with Rhino.Compute on Linux](https://developer.rhino3d.com/guides/compute/compute-linux-getting-started/)

The container package is distributed via McNeel's Amazon S3 debian repository (`mcneel-packages.s3.amazonaws.com/deb`) and includes:
- `rhino-compute` (native ASP.NET Core server `/usr/lib/rhino-compute/rhino.compute/rhino.compute`)
- `rhino3d` core geometry engine
- `yak-cli` (McNeel package manager)

---

## Prerequisites & Licensing

Unlike desktop Rhino, Rhino Compute on Linux requires **McNeel Core-Hour Billing**:

1. Log in to [https://www.rhino3d.com/compute](https://www.rhino3d.com/compute).
2. Create or retrieve your **Core-Hour Billing Token**.
3. Set this token as the `RHINO_TOKEN` environment variable in your deployment.
   - Rhino Compute writes this to `/etc/rhino-compute/environment`.
   - Also set `RHINO_COMPUTE_KEY` as a custom secret key to authenticate client requests.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `RHINO_TOKEN` | McNeel Core-Hour Billing token (mandatory for Linux compute) | `""` |
| `RHINO_COMPUTE_KEY` | Secret API key to authenticate requests from the web app server | `""` |
| `PORT` | HTTP port the compute service listens on | `80` (or `8080` for Cloud Run) |

---

## Grasshopper Plugins (e.g. MillerMoth for CNC)

Grasshopper definitions for the CNC Profiler tool require the **Miller_Moth** plugin (`MillerMoth.gha` / `MillerMoth.dll` by Timothy Veske-McMahon).

To include plugins:
1. Place the `.gha` and `.dll` files in `src2/rhino-compute/plugins/`.
2. When the container starts, `entrypoint.sh` automatically synchronizes them into:
   - `/root/.config/Grasshopper/Libraries/`
   - `/usr/share/rhino/Libraries/`

---

## Local Docker Testing

```bash
cd src2/rhino-compute

# Build the container
docker build -t rhino-compute-linux .

# Run container locally
docker run -d -p 6500:80 \
  -e RHINO_TOKEN="your-mcneel-token" \
  -e RHINO_COMPUTE_KEY="0bb5131f-1dc8-46c0-9c52-e3bf0b7c83a6" \
  --name rhino-compute rhino-compute-linux

# Test health
curl -H "RhinoComputeKey: 0bb5131f-1dc8-46c0-9c52-e3bf0b7c83a6" http://localhost:6500/healthcheck
```

---

## Deploying to Google Cloud

### Option 1: Google Cloud Run (Serverless)

```bash
# 1. Build & Push Image to Google Artifact Registry
gcloud builds submit --tag gcr.io/YOUR_GCP_PROJECT_ID/rhino-compute-linux

# 2. Deploy to Cloud Run
gcloud run deploy rhino-compute \
  --image gcr.io/YOUR_GCP_PROJECT_ID/rhino-compute-linux \
  --platform managed \
  --region us-central1 \
  --port 80 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars RHINO_TOKEN="YOUR_MCNEEL_TOKEN",RHINO_COMPUTE_KEY="YOUR_KEY" \
  --allow-unauthenticated
```

### Option 2: Google Compute Engine (Container-Optimized OS VM)

For high-throughput or long-running computational workloads, deploy as a container on a GCE VM:

```bash
gcloud compute instances create-with-container rhino-compute-vm \
  --container-image gcr.io/YOUR_GCP_PROJECT_ID/rhino-compute-linux \
  --container-env RHINO_TOKEN="YOUR_MCNEEL_TOKEN",RHINO_COMPUTE_KEY="YOUR_KEY",PORT="80" \
  --machine-type e2-standard-4 \
  --zone us-central1-a \
  --tags http-server
```
