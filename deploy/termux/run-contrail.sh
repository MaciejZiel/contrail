#!/data/data/com.termux/files/usr/bin/sh
# Supervisor in the style of the other services on this host (~/services/run-*.sh): restart after 5 s.
# Copy or link it to ~/services/run-contrail.sh and start it from ~/.termux/boot/start-services, e.g.
#   nohup "$HOME/services/run-contrail.sh" >> "$HOME/contrail.log" 2>&1 &
while true; do
    "$HOME/contrail/deploy/termux/start.sh" || true
    echo "contrail exited, restarting in 5 s" >&2
    sleep 5
done
