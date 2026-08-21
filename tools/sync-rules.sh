#!/bin/sh
# ONE RULE SET, EVERY PROJECT THAT SHARES THE DATABASE.
#
# gzowos-games is a single Realtime Database shared by Ducks, SatisFarm, the
# wyspy walkers and Sentinel City, because the Google Cloud project quota on
# this account is used up. A deploy replaces the ENTIRE rule set -- there is no
# per-branch deploy -- so a project that ships only its own branch silently
# deletes every other game's rules.
#
# That is not hypothetical: on 21 August the SatisFarm file, which names only
# `rooms` and `wyspy`, went up and took the `ducks` branch with it. Multiplayer
# in Ducks stopped working and nothing in Ducks had changed.
#
# So: edit database.rules.json here, run this, then deploy from anywhere.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/database.rules.json"
for DEST in \
  "$HERE/../SatisFarm/database.rules.json" \
  ; do
  if [ -f "$DEST" ]; then
    cp "$SRC" "$DEST"
    echo "synced -> $DEST"
  fi
done
echo "now run:  npx firebase deploy --only database --project gzowos-games"
