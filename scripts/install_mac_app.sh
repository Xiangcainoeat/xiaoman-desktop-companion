#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/.." && pwd)
source_app=${1:-"$root/release/mac-arm64/小满桌面伴侣.app"}
target_app="/Applications/小满桌面伴侣.app"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ ! -d "$source_app" ]; then
  printf '%s\n' "Source app not found: $source_app" >&2
  printf '%s\n' 'Run npm run pack:mac or npm run dist:mac first.' >&2
  exit 1
fi

if [ ! -x "$lsregister" ]; then
  printf '%s\n' 'LaunchServices registration tool is unavailable.' >&2
  exit 1
fi

bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source_app/Contents/Info.plist")

# Close any existing instance before replacing its bundle on disk. This also
# handles an older registered copy that LaunchServices selected by mistake.
osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
sleep 1
running=$(ps axww | awk '/Contents\/MacOS\/小满桌面伴侣/ && !/awk/ {print}')
if [ -n "$running" ]; then
  printf '%s\n' 'A Xiaoman process is still running; close it before installing.' >&2
  printf '%s\n' "$running" >&2
  exit 1
fi

# Preserve the previous installed bundle outside normal application search
# locations, so it cannot become a second Launchpad entry.
source_real=$(CDPATH= cd -- "$source_app" && pwd -P)
if [ -d "$target_app" ]; then
  target_real=$(CDPATH= cd -- "$target_app" && pwd -P)
  if [ "$source_real" != "$target_real" ]; then
    backup_dir="/private/tmp/xiaoman-install-backups-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    mv "$target_app" "$backup_dir/小满桌面伴侣.app.previous"
  fi
fi

if [ "$source_real" != "$target_app" ]; then
  ditto "$source_app" "$target_app"
fi

# A build directory, a worktree, or a backup can carry the same bundle ID as
# the installed app. Unregister every existing non-canonical app bundle before
# refreshing Launchpad/Dock. The files themselves are left intact so a build
# can still be inspected or rolled back without becoming a second app entry.
unregister_duplicate_app() {
  candidate=$1
  [ -n "$candidate" ] || return 0
  [ "$candidate" = "$target_app" ] && return 0
  [ -f "$candidate/Contents/Info.plist" ] || return 0
  candidate_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist" 2>/dev/null || true)
  [ "$candidate_id" = "$bundle_id" ] || return 0
  "$lsregister" -u "$candidate" >/dev/null 2>&1 || true
}

unregister_duplicate_list() {
  while IFS= read -r candidate; do
    unregister_duplicate_app "$candidate"
  done
}

unregister_duplicate_plist_list() {
  while IFS= read -r plist; do
    [ -n "$plist" ] || continue
    unregister_duplicate_app "${plist%/Contents/Info.plist}"
  done
}

cleanup_duplicate_registrations() {
  # Spotlight catches bundles outside this checkout. The explicit scans cover
  # freshly-created build/work/backup folders before Spotlight has indexed them.
  mdfind "kMDItemCFBundleIdentifier == \"$bundle_id\"" 2>/dev/null | sort -u | unregister_duplicate_list
  for scan_root in \
    "$root/release" \
    "$root/work" \
    "/Applications"; do
    [ -d "$scan_root" ] || continue
    find "$scan_root" -type f -path '*/Contents/Info.plist' -print 2>/dev/null | sort -u | unregister_duplicate_plist_list
  done
  find /private/tmp -maxdepth 5 -type f -path '*/Contents/Info.plist' -print 2>/dev/null | sort -u | unregister_duplicate_plist_list
}

# Restart Dock before cleanup. Dock can re-register applications from its
# recent-items cache while restarting; a second cleanup after LaunchServices
# garbage collection handles records it discovers during that pass.
killall Dock >/dev/null 2>&1 || true
sleep 1
cleanup_duplicate_registrations

"$lsregister" -f "$target_app" >/dev/null 2>&1
"$lsregister" -gc >/dev/null 2>&1 || true
cleanup_duplicate_registrations
sleep 1
cleanup_duplicate_registrations

installed_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$target_app/Contents/Info.plist")
installed_hash=$(shasum -a 256 "$target_app/Contents/Resources/app.asar" | awk '{print $1}')
printf 'installed=%s\n' "$target_app"
printf 'bundle=%s\n' "$bundle_id"
printf 'source_version=%s\n' "$version"
printf 'version=%s\n' "$installed_version"
printf 'app_asar_sha256=%s\n' "$installed_hash"
printf '%s\n' 'launch_services=refreshed'
