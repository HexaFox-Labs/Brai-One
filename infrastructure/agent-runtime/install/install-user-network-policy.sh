#!/bin/sh
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' "network-policy installer must run as root" >&2
  exit 1
}
for command_name in install ip nft systemctl ufw
do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf '%s\n' "missing network dependency: $command_name" >&2
    exit 1
  }
done

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
RUNTIME_DIR=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)
uplinks=$(ip -o route show default |
  awk '$1 == "default" { for (i = 1; i <= NF; i++) if ($i == "dev") print $(i + 1) }' |
  sort -u)
[ "$(printf '%s\n' "$uplinks" | awk 'NF { count++ } END { print count + 0 }')" -eq 1 ] || {
  printf '%s\n' "expected exactly one default-route uplink" >&2
  exit 1
}
uplink=$uplinks
case $uplink in
  *[!0-9A-Za-z_.:-]*|'')
    printf '%s\n' "unsafe uplink name" >&2
    exit 1
    ;;
esac

install -d -o 0 -g 0 -m 0755 /etc/nftables.d /etc/systemd/network
install -o 0 -g 0 -m 0644 \
  "$RUNTIME_DIR/network/brai-user-sandboxes.nft" \
  /etc/nftables.d/brai-user-sandboxes.nft
install -o 0 -g 0 -m 0644 \
  "$RUNTIME_DIR/network/70-brai-user-veth.network" \
  /etc/systemd/network/70-brai-user-veth.network
install -o 0 -g 0 -m 0644 \
  "$RUNTIME_DIR/systemd/brai-user-firewall.service.example" \
  /etc/systemd/system/brai-user-firewall.service

nft -c -f /etc/nftables.d/brai-user-sandboxes.nft
systemctl daemon-reload
systemctl enable --now systemd-networkd.service brai-user-firewall.service

# nftables supplies the fine-grained deny policy. Public egress needs one UFW
# FORWARD exception after that filter. DHCP discovery is host input, so it
# needs one narrow interface/protocol exception before UFW's generic UDP/67
# drop. There is deliberately no application or reverse/inbound rule.
if ufw status | awk 'NR == 1 { exit !($2 == "active") }'; then
  if ! ufw status | awk '
    /ve-brai-u\+/ &&
    /Brai sandbox DHCP discovery only/ { found = 1 }
    END { exit !found }
  '; then
    ufw allow in on ve-brai-u+ proto udp \
      from 0.0.0.0 port 68 to 255.255.255.255 port 67 \
      comment 'Brai sandbox DHCP discovery only'
  fi
  if ! ufw status | awk '
    /ve-brai-u\+/ &&
    /Brai sandbox public egress after nft deny filter/ { found = 1 }
    END { exit !found }
  '; then
    ufw route allow in on ve-brai-u+ out on "$uplink" \
      comment 'Brai sandbox public egress after nft deny filter'
  fi
fi

systemctl is-active --quiet brai-user-firewall.service
nft list table inet brai_user_sandboxes >/dev/null
printf '%s\n' \
  "installed fail-closed sandbox policy: public IPv4 egress only; host/private/cross-user denied"
