#!/usr/bin/env bash
set -euo pipefail

# Check if tmux is installed
if ! command -v tmux &>/dev/null; then
  echo "tmux is not installed."
  read -rp "Would you like to install it? [y/N] " answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    echo "tmux is required. Exiting."
    exit 1
  fi

  # Detect OS and install
  if command -v brew &>/dev/null; then
    echo "Installing tmux via Homebrew..."
    brew install tmux
  elif command -v apt-get &>/dev/null; then
    echo "Installing tmux via apt..."
    sudo apt-get update && sudo apt-get install -y tmux
  elif command -v dnf &>/dev/null; then
    echo "Installing tmux via dnf..."
    sudo dnf install -y tmux
  elif command -v pacman &>/dev/null; then
    echo "Installing tmux via pacman..."
    sudo pacman -S --noconfirm tmux
  else
    echo "Could not detect a supported package manager. Please install tmux manually."
    exit 1
  fi

  echo "tmux installed successfully."
fi

echo "tmux is available: $(tmux -V)"
