# Builds the fixed execution image and prints its digest.
#
# Usage: docker/build-image.sh [tag]
set -euo pipefail

TAG="${1:-agentdev/exec:0.0.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build --file "$ROOT/docker/Dockerfile" --tag "$TAG" "$ROOT"

DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$TAG" 2>/dev/null || true)"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$TAG")"
echo "tag:      $TAG"
echo "imageId:  $IMAGE_ID"
echo "repoDigest: ${DIGEST:-<none: the image was built locally and never pushed>}"
