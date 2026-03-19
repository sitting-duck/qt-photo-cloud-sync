#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking required tools"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it with Homebrew:"
  echo "  brew install node"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed."
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is not installed."
  echo "Install it with Homebrew:"
  echo "  brew install awscli"
  exit 1
fi

if ! command -v cdk >/dev/null 2>&1; then
  echo "AWS CDK not found globally. Installing..."
  npm install -g aws-cdk
fi

echo "==> Tool versions"
node --version
npm --version
aws --version
cdk --version

echo "==> Installing project dependencies"
npm install

echo "==> Done"
echo
echo "Next steps:"
echo "  1. aws login"
echo "  2. cdk deploy"
echo "  3. cd frontend && python3 -m http.server 8000"

