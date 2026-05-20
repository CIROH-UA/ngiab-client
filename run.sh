#!/bin/bash

# Required by salt state tethyscore.sls (ownership of /run/asgi and tethys.log).
export NGINX_USER=www

tail_file() {
  echo "tailing file $1"
  ALIGN=27
  LENGTH=`echo $1 | wc -c`
  PADDING=`expr ${ALIGN} - ${LENGTH}`
  PREFIX=$1`perl -e "print ' ' x $PADDING;"`
  file="/var/log/$1"
  # each tail runs in the background but prints to stdout
  # sed outputs each line from tail prepended with the filename+padding
  tail -qF $file | sed --unbuffered "s|^|${PREFIX}:|g" &
}

echo_status() {
  local args="${@}"
  tput setaf 4
  tput bold
  echo -e "- $args"
  tput sgr0
}


echo_status "Starting up..."

# Default port banner for users migrating from -p 80:80.
if [ "${NGINX_PORT:-8080}" = "8080" ]; then
  echo_status "NGINX_PORT=8080 (default). If you were using -p 80:80, switch to -p 80:8080."
fi

echo_status "Enforcing start state... (This might take a bit)"
salt-call --local state.apply

# salt-call runs as root and creates the SQLite DB + portal_config.yml owned
# by root. Hand them to www, plus the parent dir so SQLite can create its
# journal/WAL siblings. Non-recursive: existing root-owned scripts stay root.
if [ -f "${TETHYS_HOME}/tethys_platform.sqlite" ]; then
  chown www:www "${TETHYS_HOME}" "${TETHYS_HOME}/tethys_platform.sqlite"* 2>/dev/null || true
fi

echo_status "Starting supervisor"

# Start Supervisor
/usr/bin/supervisord

echo_status "Done!"

# Watch Logs
echo_status "Watching logs. You can ignore errors from either apache (httpd) or nginx depending on which one you are using."

log_files=("httpd/access_log"
"httpd/error_log"
"nginx/access.log"
"nginx/error.log"
"supervisor/supervisord.log"
"tethys/tethys.log")

# When this exits, exit all background tail processes
trap 'kill $(jobs -p)' EXIT
for log_file in "${log_files[@]}"; do
tail_file "${log_file}"
done

# Read output from tail; wait for kill or stop command (docker waits here)
wait
