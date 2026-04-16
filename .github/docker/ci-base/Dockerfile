# Lace VS Code Extension CI base image.
#
# Extends the pinned Playwright container with the OS-level tools our
# workflows need before anything else can run:
#   - unzip, ca-certificates — prerequisites for installing AWS CLI v2
#   - AWS CLI v2             — R2 (S3-compatible) downloads
#   - corepack enabled       — so `pnpm` resolves via package.json's
#                              `packageManager` field, locally and in CI
#
# Published by .github/workflows/ci-image.yml to:
#   ghcr.io/lace-cloud/vs-code-extension-ci:playwright-v1.59.1-jammy
#
# Multi-arch (linux/amd64 + linux/arm64) so Apple Silicon devs can use
# the same image as the GitHub runners via VS Code devcontainers.

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN arch="$(uname -m)" \
 && case "$arch" in \
      x86_64)  awscli_arch=x86_64  ;; \
      aarch64) awscli_arch=aarch64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac \
 && curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-${awscli_arch}.zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli \
 && rm -rf /tmp/awscliv2.zip /tmp/aws

RUN corepack enable

ENV AWS_REGION=auto \
    AWS_EC2_METADATA_DISABLED=true
