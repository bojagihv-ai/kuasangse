# 상세페이지 생성기 ver.1

This repository checkpoint preserves the first stable working version of the detail page generator.

## Restore Point

- Branch: `codex/detail-page-generator-v1`
- Tag: `detail-page-generator-v1`
- Source branch at creation time: `codex/workflow-upgrades`

## What This Version Contains

- Local single-file app in `app.html`
- OpenAI LLM support and Gemini/Vertex image generation support
- Token/cost tracking UI
- Google Drive automation UI and server automation controls
- Preview editing, layer-like direct manipulation, and layered SVG export
- Secret handling hardened through `.gitignore`

## Restore Commands

```bash
git fetch origin --tags
git checkout detail-page-generator-v1
```

Or download the tag ZIP from GitHub:

```text
https://github.com/bojagihv-ai/kuasangse/archive/refs/tags/detail-page-generator-v1.zip
```

## Secret Policy

Real API keys, `.env` files, service account JSON files, and local Vertex config files are intentionally excluded from Git.
After restoring this version, configure local secrets again through the app settings or local backend environment files.
