#!/bin/bash
# Gate E-C: curl against the DEPLOYED rules, both directions.
#
# KEY is the Firebase WEB API key -- byte-identical to the one in
# src/net/firebase-config.js, which ships in the bundle of every Firebase web
# app by design. It is a public client identifier, not a credential: it
# identifies the project and grants nothing. What actually protects the data is
# database.rules.json, which is exactly what this script exists to test.
# A secret scanner flags it because there is no surrounding Firebase config to
# recognise -- hence this comment.
KEY=AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY
DB=https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app
ROOM=curltest$RANDOM
NOW=$(python3 -c 'import time;print(int(time.time()*1000))')

anon() {
  curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$KEY" \
    -H 'Content-Type: application/json' -d '{"returnSecureToken":true}'
}
A=$(anon); B=$(anon); C=$(anon)
T1=$(echo "$A" | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
U1=$(echo "$A" | python3 -c 'import sys,json;print(json.load(sys.stdin)["localId"])')
T2=$(echo "$B" | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
U2=$(echo "$B" | python3 -c 'import sys,json;print(json.load(sys.stdin)["localId"])')
T3=$(echo "$C" | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
U3=$(echo "$C" | python3 -c 'import sys,json;print(json.load(sys.stdin)["localId"])')
echo "room=$ROOM  host=$U1  client=$U2  stranger=$U3"
echo

PASS=0; FAIL=0
# want = ALLOW or DENY
t() {
  local want=$1 name=$2 method=$3 url=$4 body=$5
  local out code
  if [ -n "$body" ]; then
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$url" -d "$body")
  else
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$url")
  fi
  code=$(echo "$out" | tail -1)
  local resp=$(echo "$out" | sed '$d' | head -c 160)
  local got=ALLOW
  [ "$code" != "200" ] && got=DENY
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); echo "  ok   [$want] $name -> HTTP $code $resp";
  else FAIL=$((FAIL+1)); echo "  FAIL [want $want got $got] $name -> HTTP $code $resp"; fi
}

echo "--- 1. host creates the room"
t ALLOW "host writes meta" PUT "$DB/ducks/rooms/$ROOM/meta.json?auth=$T1" \
  "{\"hostUid\":\"$U1\",\"hostPid\":\"$U1:tab1\",\"hostNick\":\"jurek\",\"players\":1,\"public\":true,\"createdAt\":$NOW,\"lastSeen\":$NOW}"
t ALLOW "host lists the room in the lobby" PUT "$DB/ducks/lobby/$ROOM.json?auth=$T1" \
  "{\"hostUid\":\"$U1\",\"hostNick\":\"jurek\",\"players\":1,\"lastSeen\":$NOW}"

echo "--- 2. forbidden writes to someone else's room"
t DENY "stranger overwrites meta" PUT "$DB/ducks/rooms/$ROOM/meta.json?auth=$T3" \
  "{\"hostUid\":\"$U3\",\"players\":1,\"lastSeen\":$NOW}"
t DENY "stranger hijacks hostUid" PUT "$DB/ducks/rooms/$ROOM/meta/hostUid.json?auth=$T3" "\"$U3\""
t DENY "stranger deletes the room" DELETE "$DB/ducks/rooms/$ROOM.json?auth=$T3"
t DENY "stranger fakes a lobby entry" PUT "$DB/ducks/lobby/$ROOM.json?auth=$T3" \
  "{\"hostUid\":\"$U3\",\"hostNick\":\"x\",\"players\":4,\"lastSeen\":$NOW}"
t DENY "unauthenticated read of meta" GET "$DB/ducks/rooms/$ROOM/meta.json"
t DENY "meta with a nickname over 24 chars" PUT "$DB/ducks/rooms/$ROOM/meta/hostNick.json?auth=$T1" \
  '"0123456789012345678901234567890"'

echo "--- 3. reservation slots"
t ALLOW "anyone signed in reads the slot list" GET "$DB/ducks/rooms/$ROOM/reservation/slots.json?auth=$T2"
t ALLOW "client claims slot 1" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/1.json?auth=$T2" \
  "{\"uid\":\"$U2\",\"pid\":\"$U2:tabA\",\"ts\":$NOW}"
t DENY "stranger steals a fresh slot" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/1.json?auth=$T3" \
  "{\"uid\":\"$U3\",\"pid\":\"$U3:tabZ\",\"ts\":$NOW}"
t DENY "stranger deletes a fresh slot" DELETE "$DB/ducks/rooms/$ROOM/reservation/slots/1.json?auth=$T3"
t DENY "slot claimed under someone else's uid" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/2.json?auth=$T3" \
  "{\"uid\":\"$U2\",\"pid\":\"$U2:tabQ\",\"ts\":$NOW}"
t DENY "pid that does not begin with the uid" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/2.json?auth=$T3" \
  "{\"uid\":\"$U3\",\"pid\":\"someoneelse:tabQ\",\"ts\":$NOW}"
t DENY "slot timestamp far in the past" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/2.json?auth=$T3" \
  "{\"uid\":\"$U3\",\"pid\":\"$U3:tabQ\",\"ts\":1}"
t ALLOW "second tab of the same uid takes a DIFFERENT slot" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/2.json?auth=$T2" \
  "{\"uid\":\"$U2\",\"pid\":\"$U2:tabB\",\"ts\":$NOW}"
t DENY "second tab evicts the first tab from slot 1" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/1.json?auth=$T2" \
  "{\"uid\":\"$U2\",\"pid\":\"$U2:tabB\",\"ts\":$NOW}"
t ALLOW "the owning tab refreshes its own slot" PUT "$DB/ducks/rooms/$ROOM/reservation/slots/1.json?auth=$T2" \
  "{\"uid\":\"$U2\",\"pid\":\"$U2:tabA\",\"ts\":$NOW}"

echo "--- 4. the private peers branch"
t ALLOW "slot owner writes its offer" PUT "$DB/ducks/rooms/$ROOM/peers/1/offer.json?auth=$T2" '"v=0 fake-sdp"'
t ALLOW "host reads the offer" GET "$DB/ducks/rooms/$ROOM/peers/1/offer.json?auth=$T1"
t ALLOW "host answers" PUT "$DB/ducks/rooms/$ROOM/peers/1/answer.json?auth=$T1" '"v=0 fake-answer"'
t ALLOW "client pushes an ICE candidate" POST "$DB/ducks/rooms/$ROOM/peers/1/ice/c.json?auth=$T2" '"{\"candidate\":\"a=x\"}"'
t DENY "stranger reads the peer mailbox" GET "$DB/ducks/rooms/$ROOM/peers/1.json?auth=$T3"
t DENY "stranger writes an offer" PUT "$DB/ducks/rooms/$ROOM/peers/1/offer.json?auth=$T3" '"v=0 hijack"'
t DENY "ICE under a side other than h or c" POST "$DB/ducks/rooms/$ROOM/peers/1/ice/x.json?auth=$T2" '"{}"'
t DENY "junk key in the peer mailbox" PUT "$DB/ducks/rooms/$ROOM/peers/1/junk.json?auth=$T2" '"x"'
BIG=$(python3 -c 'print("v="+"a"*12100)')
t DENY "offer over the 12000 char ceiling" PUT "$DB/ducks/rooms/$ROOM/peers/1/offer.json?auth=$T2" "\"$BIG\""
BIGICE=$(python3 -c 'print("c="+"a"*1300)')
t DENY "ICE candidate over the 1200 char ceiling" POST "$DB/ducks/rooms/$ROOM/peers/1/ice/c.json?auth=$T2" "\"$BIGICE\""

echo "--- 5. blast radius: the other games' branches"
t DENY "read the whole database root" GET "$DB/.json?auth=$T1"
t DENY "read the whole ducks branch" GET "$DB/ducks.json?auth=$T1"
t ALLOW "read the public lobby" GET "$DB/ducks/lobby.json?auth=$T3"
# Nine other games share this database. A Ducks player is an ordinary anonymous
# user here, so these prove the merge did not widen anyone else's branch.
t DENY "write into another game's branch (satisfarm)" PUT "$DB/satisfarm/ducksWasHere.json?auth=$T1" '"x"'
t DENY "write into another game's branch (sentinelCity)" PUT "$DB/sentinelCity/ducksWasHere.json?auth=$T1" '"x"'
t DENY "write a new top-level branch" PUT "$DB/ducksEscaped.json?auth=$T1" '"x"'
t DENY "write at the ducks branch root" PUT "$DB/ducks.json?auth=$T1" '{"rooms":{}}'
t DENY "read another game's branch" GET "$DB/satisfarm.json?auth=$T1"

echo "--- 6. host cleanup"
t ALLOW "host deletes its own room" DELETE "$DB/ducks/rooms/$ROOM.json?auth=$T1"
t ALLOW "host deletes its lobby entry" DELETE "$DB/ducks/lobby/$ROOM.json?auth=$T1"
echo
echo "E-C: $PASS passed, $FAIL failed"
