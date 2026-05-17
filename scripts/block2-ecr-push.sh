#!/usr/bin/env bash
# Block 2: build and push initial image to ECR (info.md A10–A14).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-802749364652}"
ECR_REPOSITORY="${ECR_REPOSITORY:-amiqus-faq-allianz}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_LOCAL="amiqus-faq-allianz"
IMAGE_REMOTE="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

if [[ -f "$ROOT/.aws-local.env" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$ROOT/.aws-local.env" && set +a
fi

export PATH="${HOME}/Library/Python/3.9/bin:${PATH}"

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: AWS CLI not found. Run: python3 -m pip install --user awscli"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found. Install Docker Desktop, start it, then re-run this script."
  echo "  https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi

echo "Checking AWS credentials..."
aws sts get-caller-identity --region "$AWS_REGION" >/dev/null

echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Building image..."
docker build -t "$IMAGE_LOCAL" .

echo "Tagging ${IMAGE_REMOTE}..."
docker tag "${IMAGE_LOCAL}:latest" "$IMAGE_REMOTE"

echo "Pushing (may take several minutes)..."
docker push "$IMAGE_REMOTE"

echo ""
echo "Verifying image in ECR..."
aws ecr describe-images \
  --repository-name "$ECR_REPOSITORY" \
  --region "$AWS_REGION" \
  --image-ids imageTag="$IMAGE_TAG" \
  --query 'imageDetails[0].imageTags' \
  --output text

echo ""
echo "Done: $IMAGE_REMOTE"
echo "Notify Haris: Image latest pushed to ECR. Ready for ECS service creation."
