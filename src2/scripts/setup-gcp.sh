#!/usr/bin/env bash
# ==============================================================================
# setup-gcp.sh — Idempotent Google Cloud Setup for CNC Web & Rhino Compute
# ==============================================================================
set -euo pipefail

REGION="${GCP_REGION:-us-central1}"
REPO_NAME="colab-containers"
SA_NAME="cnc-web-sa"

echo "=== 1. Verifying GCP Environment ==="
PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
    echo "❌ ERROR: No GCP project selected."
    echo "Run: gcloud config set project <PROJECT_ID>"
    exit 1
fi

ACCOUNT=$(gcloud config get-value account 2>/dev/null || true)
echo "✓ GCP Project : $PROJECT_ID"
echo "✓ Active User : $ACCOUNT"
echo "✓ Region      : $REGION"

echo ""
echo "=== 2. Enabling Required GCP APIs ==="
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com \
    --project="$PROJECT_ID" --quiet

echo "✓ APIs enabled successfully."

echo ""
echo "=== 3. Setting up Artifact Registry Repository ==="
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --project="$PROJECT_ID" --quiet >/dev/null 2>&1; then
    echo "Creating Artifact Registry repository '$REPO_NAME' in $REGION..."
    gcloud artifacts repositories create "$REPO_NAME" \
        --repository-format=docker \
        --location="$REGION" \
        --project="$PROJECT_ID" \
        --description="Docker container repository for CNC web server and Rhino Compute" \
        --quiet
else
    echo "✓ Artifact Registry repository '$REPO_NAME' already exists."
fi

echo ""
echo "=== 4. Setting up Service Account for Cloud Run ==="
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" --quiet >/dev/null 2>&1; then
    echo "Creating service account '$SA_NAME'..."
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="CNC Web Server Cloud Run SA" \
        --project="$PROJECT_ID" \
        --quiet
else
    echo "✓ Service account '$SA_NAME' already exists."
fi

# Allow Web Server to invoke Rhino Compute
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/run.invoker" \
    --condition=None --quiet >/dev/null

echo "✓ Assigned roles/run.invoker to ${SA_EMAIL}."

echo ""
echo "=== 5. Configuring Cloud Build Permissions ==="
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" --quiet)
CB_SA="${PROJECT_NUM}@cloudbuild.gserviceaccount.com"

# Modern Cloud Build SA or compute SA
for BUILDER in "$CB_SA" "${PROJECT_NUM}-compute@developer.gserviceaccount.com"; do
    if gcloud iam service-accounts describe "$BUILDER" --project="$PROJECT_ID" --quiet >/dev/null 2>&1; then
        echo "Granting Cloud Run Admin & SA User to $BUILDER..."
        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:${BUILDER}" \
            --role="roles/run.admin" \
            --condition=None --quiet >/dev/null || true
        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:${BUILDER}" \
            --role="roles/iam.serviceAccountUser" \
            --condition=None --quiet >/dev/null || true
    fi
done

echo ""
echo "=== 6. Configuring Google Secret Manager ==="
# Secret 1: rhino-compute-key
if ! gcloud secrets describe rhino-compute-key --project="$PROJECT_ID" --quiet >/dev/null 2>&1; then
    echo "Generating secure random 256-bit API key for rhino-compute-key..."
    API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo -n "$API_KEY" | gcloud secrets create rhino-compute-key --data-file=- --replication-policy=automatic --project="$PROJECT_ID" --quiet
    echo "✓ Created secret: rhino-compute-key"
else
    echo "✓ Secret 'rhino-compute-key' already exists."
fi

# Secret 2: rhino-token (McNeel Core-Hour Billing Token)
if ! gcloud secrets describe rhino-token --project="$PROJECT_ID" --quiet >/dev/null 2>&1; then
    echo "Creating placeholder secret 'rhino-token'..."
    echo -n "PENDING_TOKEN_SETUP" | gcloud secrets create rhino-token --data-file=- --replication-policy=automatic --project="$PROJECT_ID" --quiet
    echo "✓ Created secret: rhino-token (update anytime with: gcloud secrets versions add rhino-token --data-file=-)"
else
    echo "✓ Secret 'rhino-token' already exists."
fi

# Allow Default Compute SA and cnc-web-sa to access Secret Manager
for SEC_USER in "${PROJECT_NUM}-compute@developer.gserviceaccount.com" "${SA_EMAIL}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${SEC_USER}" \
        --role="roles/secretmanager.secretAccessor" \
        --condition=None --quiet >/dev/null || true
done

echo "✓ Secret Manager permissions configured."

echo ""
echo "=========================================================="
echo "🎉 GCP Infrastructure & IAM Setup Complete!"
echo "To trigger your first build and deployment, run:"
echo "   gcloud builds submit --config=src2/cloudbuild.yaml"
echo "=========================================================="
