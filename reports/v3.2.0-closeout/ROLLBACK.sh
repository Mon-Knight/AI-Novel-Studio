#!/usr/bin/env sh
set -eu

target=${1:?usage: ROLLBACK.sh MODIFIED_FILE_COPY}

test "$(sed -n 's/^TARGET=//p' "$target")" = "package.json"
test "$(sed -n 's/^FIELD=//p' "$target")" = "version"
test "$(sed -n 's/^CURRENT=//p' "$target")" = "3.2.0"
test "$(sed -n 's/^STATUS=//p' "$target")" = "modified"

temporary="${target}.rollback-tmp"
sed \
  -e 's/^CURRENT=3\.2\.0$/CURRENT=3.1.0/' \
  -e 's/^STATUS=modified$/STATUS=restored/' \
  "$target" > "$temporary"
mv "$temporary" "$target"

test "$(sed -n 's/^CURRENT=//p' "$target")" = "3.1.0"
test "$(sed -n 's/^STATUS=//p' "$target")" = "restored"
printf '%s\n' 'restored package.version=3.1.0 status=restored'
