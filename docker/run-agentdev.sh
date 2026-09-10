# Runs one command inside the fixed execution image with the hardening flags the
# specification requires (docs/architecture/execution.md §1):
# read-only root filesystem, cap-drop=ALL, no-new-privileges, pid limit 256,
# 2GiB memory, 2 CPUs and no network by default.
#
# The workspace is mounted read-write because this helper runs a Task worktree;
# read-only source mounts and the per-role ACL are the Supervisor's policy and
# land with WP-07 (`docs/architecture/execution.md` §3).
#
# Usage: docker/run-agentdev.sh <workspace-dir> <command...>
set -euo pipefail

IMAGE="${AGENTDEV_EXEC_IMAGE:-agentdev/exec:0.0.0}"
WORKSPACE="${1:?usage: run-agentdev.sh <workspace-dir> <command...>}"
shift

exec docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --memory 2g \
  --cpus 2 \
  --network none \
  --user 10001:10001 \
  --volume "$WORKSPACE:/workspace:rw" \
  --workdir /workspace \
  "$IMAGE" -lc "$*"
