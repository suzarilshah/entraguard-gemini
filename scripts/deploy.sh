#!/usr/bin/env bash
# Deploy EntraGuard-Gemini: the Cloud Run analyst, Firestore rules/indexes, and Firebase Hosting.
#
#   PROJECT=my-firebase-project ./scripts/deploy.sh
#
# Gemini auth: by default the Cloud Run service account calls Vertex AI with no key at all.
# Set USE_API_KEY=1 to use a Vertex AI express-mode key stored in Secret Manager as
# "gemini-api-key" instead (create it with: gcloud secrets create gemini-api-key --data-file=-).
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT to the Firebase / Google Cloud project ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="entraguard-analyst"
MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
SA="entraguard-analyst@${PROJECT}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Project ${PROJECT}, region ${REGION}"
gcloud config set project "${PROJECT}" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com firestore.googleapis.com secretmanager.googleapis.com \
  firebasehosting.googleapis.com --project "${PROJECT}"

echo "==> Runtime service account (least privilege)"
gcloud iam service-accounts describe "${SA}" --project "${PROJECT}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create entraguard-analyst --project "${PROJECT}" \
    --display-name "EntraGuard Gemini analyst (Cloud Run)"
for role in roles/datastore.user roles/aiplatform.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT}" --member "serviceAccount:${SA}" \
    --role "${role}" --condition None >/dev/null
done

SECRET_FLAGS=()
if [[ "${USE_API_KEY:-0}" == "1" ]]; then
  gcloud secrets add-iam-policy-binding gemini-api-key --project "${PROJECT}" \
    --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor >/dev/null
  SECRET_FLAGS=(--set-secrets "GEMINI_API_KEY=gemini-api-key:latest")
fi

echo "==> Cloud Run: ${SERVICE}"
# Scales to zero between judges; Firebase Hosting fronts it, so it must accept public traffic.
# The app itself requires a Firebase ID token on every route except /api/health.
gcloud run deploy "${SERVICE}" --project "${PROJECT}" --region "${REGION}" \
  --source "${ROOT}/service" --service-account "${SA}" \
  --allow-unauthenticated --min-instances "${MIN_INSTANCES:-0}" --max-instances 3 \
  --cpu 1 --memory 512Mi --concurrency 40 --timeout 60 \
  --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=${PROJECT}|GOOGLE_CLOUD_LOCATION=${REGION}|GEMINI_MODEL=${MODEL}|ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://placeholders.my}|OPERATOR_EMAILS=${OPERATOR_EMAILS:-}" \
  "${SECRET_FLAGS[@]}"

echo "==> Firestore rules + indexes, Firebase Hosting"
(cd "${ROOT}" && firebase deploy --project "${PROJECT}" --only firestore,hosting --non-interactive)

echo "==> Done: https://${PROJECT}.web.app"
