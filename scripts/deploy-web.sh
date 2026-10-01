#!/usr/bin/env bash
# Builds the static export and deploys it to the Amplify app created by DiligenceIQ-Web.
# The app has no connected repository (same as TrustResponse), so each deploy is a zip
# upload: create-deployment → PUT zip → start-deployment → wait for the job.
#   pnpm deploy:web            # build + deploy
#   SKIP_BUILD=1 pnpm deploy:web
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK="DiligenceIQ-Web"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apps/web/out"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

APP_ID="$(output AmplifyAppId)"
BRANCH="$(output BranchName)"
if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
  echo "deploy-web: $STACK has no AmplifyAppId output; deploy the infrastructure first (pnpm deploy:infra)" >&2
  exit 1
fi

if [[ -z "${SKIP_BUILD:-}" ]]; then
  pnpm --dir "$ROOT" --filter @diligenceiq/web build
fi
[[ -f "$OUT/index.html" ]] || { echo "deploy-web: $OUT/index.html missing; build first" >&2; exit 1; }

ZIP="$(mktemp -d)/site.zip"
(cd "$OUT" && zip -qr "$ZIP" .)

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --region "$REGION" --app-id "$APP_ID" \
  --branch-name "$BRANCH" --query '[jobId, zipUploadUrl]' --output text)
curl -sSf -X PUT -H 'Content-Type: application/zip' --upload-file "$ZIP" "$UPLOAD_URL" >/dev/null
aws amplify start-deployment --region "$REGION" --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null
echo "deploy-web: job $JOB_ID started for $APP_ID/$BRANCH"

for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --region "$REGION" --app-id "$APP_ID" --branch-name "$BRANCH" \
    --job-id "$JOB_ID" --query 'job.summary.status' --output text)"
  case "$STATUS" in
    SUCCEED) echo "deploy-web: deployed → https://diligenceiq.mikemiller.ai"; exit 0 ;;
    FAILED | CANCELLED) echo "deploy-web: job $JOB_ID $STATUS" >&2; exit 1 ;;
  esac
  sleep 5
done
echo "deploy-web: timed out waiting for job $JOB_ID" >&2
exit 1
