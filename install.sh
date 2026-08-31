#!/bin/sh
#
# openchat installer.
#
#   curl -fsSL https://raw.githubusercontent.com/n3xtpy/Openchat/main/install.sh | sh
#
# A note worth reading before you run it: piping a script from the internet into
# a shell is exactly the habit a security tool should not be teaching you. This
# script is deliberately small enough to read in full first, and all it does is
# check your Node version and run `npm install -g openchat`. If you would rather
# skip it, that one npm command is the whole installation.

set -eu

RED=''
GREEN=''
DIM=''
BOLD=''
RESET=''
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  DIM="$(printf '\033[2m')"
  BOLD="$(printf '\033[1m')"
  RESET="$(printf '\033[0m')"
fi

say () { printf '%s\n' "$*"; }
step () { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
fail () { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

REQUIRED_MAJOR=22
PACKAGE=openchat

say ""
say "${BOLD}openchat${RESET} — serverless, end-to-end encrypted chat for your terminal"
say ""

# --- prerequisites ----------------------------------------------------------

step "Checking Node.js"

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed.
  openchat needs Node.js $REQUIRED_MAJOR or newer.
    macOS      brew install node
    Debian     https://github.com/nodesource/distributions
    Arch       sudo pacman -S nodejs npm
    Anywhere   https://nodejs.org/en/download"
fi

NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"

if [ "$NODE_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  fail "Node.js $NODE_VERSION is too old — openchat needs $REQUIRED_MAJOR or newer.
  Upgrade Node, then run this again."
fi
say "    ${GREEN}ok${RESET} node $NODE_VERSION"

if ! command -v npm >/dev/null 2>&1; then
  fail "npm is not installed. It normally ships with Node.js — install it and try again."
fi
say "    ${GREEN}ok${RESET} npm $(npm --version)"

# --- install ----------------------------------------------------------------
#
# Prefer a prefix the user owns. Installing globally into a root-owned prefix
# needs sudo, and asking for root is worth avoiding when it can be.

step "Installing $PACKAGE"

NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo '')"
NEEDS_SUDO=no

if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX" ] && [ ! -w "$NPM_PREFIX" ]; then
  NEEDS_SUDO=yes
fi

if [ "$NEEDS_SUDO" = yes ]; then
  say "    ${DIM}$NPM_PREFIX is not writable by you, so this needs sudo.${RESET}"
  say "    ${DIM}To avoid that, point npm somewhere you own:${RESET}"
  say "    ${DIM}  npm config set prefix ~/.local${RESET}"
  say ""
  sudo npm install -g "$PACKAGE"
else
  npm install -g "$PACKAGE"
fi

# --- verify -----------------------------------------------------------------

step "Checking the install"

if ! command -v openchat >/dev/null 2>&1; then
  BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
  say ""
  say "${RED}openchat installed, but it is not on your PATH.${RESET}"
  say "Add this to your shell profile:"
  say ""
  say "    export PATH=\"$BIN_DIR:\$PATH\""
  say ""
  exit 1
fi

say "    ${GREEN}ok${RESET} $(command -v openchat)"
say ""
say "${GREEN}Done.${RESET} Start with:"
say ""
say "    ${BOLD}openchat${RESET}                      set up your account and open the app"
say "    ${BOLD}openchat room create <name>${RESET}   create a room and print its invite"
say "    ${BOLD}openchat whoami${RESET}               show the key people use to reach you"
say ""
say "${DIM}Docs: https://github.com/n3xtpy/Openchat${RESET}"
say ""
