#!/usr/bin/env bash
# Releases setlist's page half from one commit, so it ships with the API release of the same commit.
#
#   bash scripts/releasePages.sh [commit]     (default: HEAD)
#
# The build runs in a temporary worktree and the shared checkout is not touched. The folder goes
# to atheist under /srv/www/giglist.dfg.rocks/, and homelab-site's route names it. Serving the new
# folder still needs `ops rebuild atheist`, which the operator runs with sudo.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
homelab=$HOME/build/homelab-site
sites=$homelab/routes/sites.toml
host=atheist
remote_root=/srv/www/giglist.dfg.rocks

commit=$(git -C "$root" rev-parse --verify --quiet "${1:-HEAD}^{commit}") || {
  echo "not a commit: ${1:-HEAD}" >&2
  exit 1
}
short=$(git -C "$root" rev-parse --short=7 "$commit")

scratch=$(mktemp -d)
cleanup() {
  if [[ -e $scratch/src ]]; then
    git -C "$root" worktree remove --force "$scratch/src" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

# Same two steps as the Containerfile. Its base image, localhost/bun-base:1, exists on no host.
git -C "$root" worktree add --quiet --detach "$scratch/src" "$commit"
(
  cd "$scratch/src"
  bun install --frozen-lockfile --ignore-scripts
  bun node_modules/vite/bin/vite.js build
)
dist=$scratch/src/dist

# The route's X-Site-Fallback serves this file for a path with no file, and it must match index.html.
cp "$dist/index.html" "$dist/__spa-fallback.html"

# A browser checks the CSP hash against the exact bytes between <script> and </script>.
perl -0777 -ne 'print $1 if /<script>(.*?)<\/script>/s' "$dist/index.html" > "$scratch/inline.js"
[[ -s $scratch/inline.js ]] || {
  echo "no inline <script> in $dist/index.html" >&2
  exit 1
}
hash=sha256-$(openssl dgst -sha256 -binary "$scratch/inline.js" | base64 -w0)
csp=$(awk '/^\[http\.middlewares\.giglist-dfg-rocks-security\./ {s = 1} s && /^Content-Security-Policy = / {print; exit}' "$sites")
script_src=$(grep -o "script-src [^;\"]*" <<<"$csp" || true)
if [[ $script_src != *"'$hash'"* ]]; then
  echo "refused: giglist script-src in $sites does not name the build's inline script hash" >&2
  echo "  build:  $hash" >&2
  echo "  sites:  ${script_src:-(no script-src)}" >&2
  exit 1
fi
echo "inline script hash $hash is named by $sites"

# The route commit uses a pathspec, so an uncommitted edit to this file would be committed with it.
if [[ -n $(git -C "$homelab" status --porcelain -- routes/sites.toml) ]]; then
  echo "refused: $sites has uncommitted changes; commit or discard them first" >&2
  exit 1
fi
current=$(grep -o '^X-Site-Release = "giglist\.dfg\.rocks/[^"]*"' "$sites" || true)

# Folders are never changed once written. An existing folder for this commit is reused only when
# it holds exactly the build; --delete makes an extra remote file count as a difference.
# find, not a shell glob: atheist's login shell is zsh, which fails the whole command on a glob with no match.
existing=$(ssh -o BatchMode=yes "$host" "find $remote_root -maxdepth 1 -name '*-$short'")
if [[ -n $existing ]]; then
  if [[ $(wc -l <<<"$existing") -ne 1 ]]; then
    echo "refused: more than one folder for $short on $host:" >&2
    echo "$existing" >&2
    exit 1
  fi
  differences=$(rsync -rcn --delete --itemize-changes -e 'ssh -o BatchMode=yes' "$dist/" "$host:$existing/")
  if [[ -n $differences ]]; then
    echo "refused: $host:$existing differs from the build of $short:" >&2
    head -n 20 <<<"$differences" >&2
    exit 1
  fi
  folder=$(basename "$existing")
  echo "reusing $host:$existing, identical to the build"
else
  # Upload under a dot name and rename, so an interrupted upload never sits under a release name.
  folder=$(date +%F)-$short
  partial=$remote_root/.$folder.partial
  rsync -rtp --delete -e 'ssh -o BatchMode=yes' --chmod=Da+rx,Fa+r "$dist/" "$host:$partial/"
  ssh -o BatchMode=yes "$host" "mv $partial $remote_root/$folder"
  echo "wrote $host:$remote_root/$folder"
fi

# Point the route at the folder. A commit is made only when the route changes.
want="X-Site-Release = \"giglist.dfg.rocks/$folder\""
if [[ $current == "$want" ]]; then
  echo "homelab-site already serves $folder; no commit"
else
  sed -i "s|^X-Site-Release = \"giglist\.dfg\.rocks/[^\"]*\"|$want|" "$sites"
  git -C "$homelab" commit --quiet -m "feat(routes): giglist pages serve release $folder" \
    -m "Points the giglist.dfg.rocks route at the folder scripts/releasePages.sh wrote for setlist commit $short." \
    -- routes/sites.toml
  echo "committed homelab-site: $want"
fi

echo "Next, on the operator's shell: ops rebuild atheist"
echo "Then: bash scripts/checkProduction.sh https://giglist.dfg.rocks"
