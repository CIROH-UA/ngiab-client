#!/bin/bash

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


echo_status "Enforcing start state... (This might take a bit)"
salt-call --local state.apply


# echo_status "Fixing permissions"

chown -R www: /usr/lib/tethys
chown -R www: /var/log/tethys
chmod -R 777 /var/lib/nginx

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
