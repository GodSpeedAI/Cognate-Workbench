#!/usr/bin/env bash
# Install Cognate Workbench on Linux (x86_64 or aarch64) from a GitHub release.
#
#   bash install-cognate-workbench.sh            # the latest release
#   bash install-cognate-workbench.sh v0.1.0     # a specific release tag
#
# Downloads into a temporary directory under /tmp, checks the SHA-256 sums and the package architecture,
# installs the .deb with sudo, and confirms the bundled PostgreSQL manager is present and verified. The
# temporary directory is removed on exit. Nothing is written to your home directory by this script, and no
# system service is enabled: the application starts only when you run `cognate-workbench start`.
set -euo pipefail

REPO="GodSpeedAI/Cognate-Workbench"
TAG="${1:-latest}"

case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ "$TAG" = latest ]; then BASE="https://github.com/$REPO/releases/latest/download"; else BASE="https://github.com/$REPO/releases/download/$TAG"; fi

TMP="$(mktemp -d /tmp/cognate-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS"
DEB="$(sed -n "s/^[0-9a-f]*  \(cognate-workbench_[^ ]*_${ARCH}\.deb\)$/\1/p" "$TMP/SHA256SUMS" | head -1)"
[ -n "$DEB" ] || { echo "no ${ARCH} package in release $TAG" >&2; exit 1; }
curl -fsSL -o "$TMP/$DEB" "$BASE/$DEB"

(cd "$TMP" && grep "  $DEB\$" SHA256SUMS | sha256sum -c -)
PACKAGE_ARCH="$(dpkg-deb -f "$TMP/$DEB" Architecture)"
[ "$PACKAGE_ARCH" = "$ARCH" ] || { echo "package architecture $PACKAGE_ARCH does not match this machine ($ARCH)" >&2; exit 1; }
echo "verified $DEB ($PACKAGE_ARCH)"

sudo dpkg -i "$TMP/$DEB"

/usr/bin/cognate-workbench --version
REPORT="$(/usr/bin/cognate-workbench doctor || true)"
echo "$REPORT" | head -12
# The bundled pg0 is checked against the release manifest by doctor; its line must read ok.
echo "$REPORT" | grep -q '  ok  pg0 executable' || { echo "bundled pg0 could not be verified" >&2; exit 1; }
echo "installed. Start it with: cognate-workbench start   (then open http://127.0.0.1:3180)"
