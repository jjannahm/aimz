#!/usr/bin/env bash
#
# Everything a load generator must prove before it is allowed to generate load.
#
# Run it on the VM, from the loadtest directory, after copying accounts.json
# across. It installs nothing and changes nothing except the socket limit for
# the current shell; it only checks, and it stops at the first thing that would
# make a run untrustworthy.
#
#   ./preflight.sh https://aimz-api-staging.shared-links.workers.dev
#
set -uo pipefail

BASE="${1:-https://aimz-api-staging.shared-links.workers.dev}"
ACCOUNTS="${ACCOUNTS:-./accounts.json}"
FAIL=0

say()  { printf '  %-28s %s\n' "$1" "$2"; }
bad()  { printf '  %-28s FAIL — %s\n' "$1" "$2"; FAIL=1; }

echo "PREFLIGHT"
echo

# ---------------------------------------------------------------- the target
echo "target"
say "url" "$BASE"
case "$BASE" in
  *prod*|*production*|*live*) bad "url" "looks like production — refusing"; ;;
  *staging*|*localhost*|*127.0.0.1*) say "recognised as" "staging or local" ;;
  *) bad "url" "not recognisably staging; pass it explicitly if intended" ;;
esac
echo

# ------------------------------------------------------------- the generator
echo "generator"
if command -v k6 >/dev/null 2>&1; then say "k6" "$(k6 version 2>&1 | head -1)"; else bad "k6" "not installed"; fi
CPUS=$(nproc 2>/dev/null || echo 0)
say "vCPU" "$CPUS"
[ "$CPUS" -lt 4 ] && bad "vCPU" "want 4 or more for 1,000+ VUs"
if command -v free >/dev/null 2>&1; then
  TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}'); AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
  say "RAM total" "${TOTAL_MB} MB"
  say "RAM available" "${AVAIL_MB} MB"
  [ "${AVAIL_MB:-0}" -lt 4000 ] && bad "RAM" "want 4 GB free or more for 1,500 VUs"
fi
NOFILE=$(ulimit -n)
say "ulimit -n" "$NOFILE"
if [ "$NOFILE" -lt 65535 ]; then
  echo "    raising it for this shell…"
  ulimit -n 1048576 2>/dev/null || ulimit -n 65535 2>/dev/null
  NOFILE=$(ulimit -n); say "ulimit -n (now)" "$NOFILE"
  [ "$NOFILE" -lt 65535 ] && bad "ulimit -n" "still below 65535; see /etc/security/limits.conf"
fi
PORTS=$(cat /proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || echo "unknown")
say "ephemeral ports" "$PORTS"
echo

# ---------------------------------------------------------- reaching the API
echo "connectivity"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/v1/health" || echo 000)
if [ "$CODE" = "200" ]; then say "GET /health" "200"; else bad "GET /health" "got $CODE"; fi
RTT=$(curl -s -o /dev/null -w '%{time_starttransfer}' --max-time 15 "$BASE/api/v1/health" || echo 0)
say "round trip" "${RTT}s"
READY=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/v1/health/ready" || echo 000)
if [ "$READY" = "200" ]; then say "GET /health/ready" "200 (database reachable)"; else bad "GET /health/ready" "got $READY"; fi
echo

# ------------------------------------------------------------- the accounts
echo "accounts"
if [ ! -f "$ACCOUNTS" ]; then
  bad "$ACCOUNTS" "missing — copy it across; never commit it"
else
  N=$(python3 -c "import json;print(len(json.load(open('$ACCOUNTS'))))" 2>/dev/null || echo 0)
  say "pool size" "$N"
  [ "$N" -lt 12 ] && bad "pool size" "want at least 12, ideally 20"
  OK=0; BADC=0
  # Paced: a burst of logins from one address would meet LOGIN_BY_IP (100/60s),
  # which is not what this is testing.
  while IFS= read -r EMAIL; do
    PASS=$(python3 -c "
import json,sys
for a in json.load(open('$ACCOUNTS')):
    if a['email']=='$EMAIL': print(a['password']); break
")
    STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$BASE/api/v1/auth/login" || echo 000)
    if [ "$STATUS" = "200" ]; then OK=$((OK+1)); else BADC=$((BADC+1)); printf '    %-44s %s\n' "$EMAIL" "$STATUS"; fi
    sleep 0.4
  done < <(python3 -c "
import json
for a in json.load(open('$ACCOUNTS')): print(a['email'])
")
  say "signed in" "$OK"
  [ "$BADC" -gt 0 ] && bad "signed in" "$BADC account(s) could not authenticate"
fi
echo

if [ "$FAIL" -eq 0 ]; then
  echo "READY — every check passed. Safe to run the ladder."
else
  echo "NOT READY — fix the FAIL lines above before generating load."
  exit 1
fi
