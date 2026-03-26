#!/bin/bash
# Run cloudflared tunnel using the user's config
# Expects tunnel ID as first argument, or reads from ~/.cloudflared/config.yml
exec /opt/homebrew/bin/cloudflared tunnel --config "$HOME/.cloudflared/config.yml" run "$@"
