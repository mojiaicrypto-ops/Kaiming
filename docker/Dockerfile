# Fixed execution image for professional agents and tools.
#
# docs/architecture/execution.md §1 fixes the contents: "镜像由项目Dockerfile固定构建：
# Node24+Git+基础构建工具，使用非Root uid，read-only root filesystem、cap-drop=ALL、
# no-new-privileges、pid限制256、内存2GiB、CPU2。网络默认none。构建镜像和安装依赖属于
# 用户一次性配置授权，记录镜像digest；每次Attempt冻结digest。"
#
# The hardening flags are runtime controls and are applied by the Supervisor, not
# baked here; `docker/run-agentdev.sh` shows the exact invocation and
# `apps/cli doctor` reports the digest of the built image.
FROM node:24-slim

LABEL org.opencontainers.image.title="agentdev-exec" \
      org.opencontainers.image.description="AgentDev Workspace execution image (Node 24 + git + build tools, non-root)"

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    PNPM_HOME=/home/agentdev/.local/share/pnpm \
    PATH=/home/agentdev/.local/share/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        openssh-client \
        make \
        g++ \
        python3 \
        ripgrep \
        passwd \
    && rm -rf /var/lib/apt/lists/*

# Non-root execution account. Fixed uid keeps bind-mounted worktree ownership
# predictable for the Supervisor.
RUN groupadd --gid 10001 agentdev \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash agentdev

USER agentdev
WORKDIR /workspace

ENTRYPOINT ["/bin/bash"]
