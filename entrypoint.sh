#!/bin/sh
set -e

# aria2 downloads directory
DIR="${ARIA2_DIR:-/downloads}"
mkdir -p "$DIR"

# default: aria2 runs as root (reads /root/.config/aria2/aria2.conf, can write anywhere).
# set PUID (and PGID) to run aria2 + web server as that unprivileged uid instead.
RUN=""
if [ -n "$PUID" ]; then
  PGID="${PGID:-$PUID}"
  groupmod -o -g "$PGID" dummy
  usermod -o -u "$PUID" -g "$PGID" dummy
  chown dummy:dummy "$DIR" 2>/dev/null || true
  if ! gosu dummy test -w "$DIR"; then
    echo "WARNING: $DIR is not writable by uid $PUID, downloads will fail with a permission error." >&2
  fi
  RUN="gosu dummy "
fi

# optional aria2 config file: the first one the run user can read.
# command line options below win over the file.
CONF=""
for f in /root/.config/aria2/aria2.conf /etc/aria2.conf /aria2.conf; do
  if [ -f "$f" ] && ${RUN}test -r "$f"; then
    CONF="--conf-path=$f"
    break
  fi
done
if [ -z "$CONF" ] && [ -n "$RUN" ] && [ -f /root/.config/aria2/aria2.conf ]; then
  echo "NOTE: /root/.config/aria2/aria2.conf is not readable by uid $PUID and is ignored, mount the file at /etc/aria2.conf instead." >&2
fi

PROCFILE=/tmp/Procfile
printf 'web: %sbusybox httpd -f -p 8080 -h /webui-aria2\nbackend: %saria2c --enable-rpc --rpc-listen-all --dir=%s %s\n' \
  "$RUN" "$RUN" "$DIR" "$CONF" > "$PROCFILE"

exec /usr/local/bin/goreman -f "$PROCFILE" "$@"
