#!/usr/bin/env bash
# Manual first push to ECR (Block 2 in info.md). Requires AWS CLI + Docker.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-802749364652}"
ECR_REPOSITORY="${ECR_REPOSITORY:-amiqus-faq-allianz}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_LOCAL="amiqus-faq-allianz"
IMAGE_REMOTE="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Building image..."
docker build -t "$IMAGE_LOCAL" .

echo "Tagging ${IMAGE_REMOTE}..."
docker tag "${IMAGE_LOCAL}:latest" "$IMAGE_REMOTE"

echo "Pushing..."
docker push "$IMAGE_REMOTE"

echo "Done: $IMAGE_REMOTE"
