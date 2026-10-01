#!/usr/bin/env bash
# usage: qa-pay5-cpuburn.sh start|stop <mode: spin|bcrypt> <n>   -- CPU contention generators for the [#13] timing study (kills only its own pids via pidfile)
PF=/tmp/qa-pay5-burn.pids
case "$1" in
 start) : > $PF
  for i in $(seq 1 $3); do
    if [ "$2" = spin ]; then (setsid nohup node -e 'for(;;){}' >/dev/null 2>&1 & echo $! >> $PF)
    else (cd /workspace/qa-pay5 && setsid nohup node -e 'const b=require("bcryptjs");(async()=>{for(;;)await b.hash("qa-pay5-contention",12)})()' >/dev/null 2>&1 & echo $! >> $PF); fi
  done;;
 stop) [ -f $PF ] && xargs -r kill < $PF; rm -f $PF;;
esac
