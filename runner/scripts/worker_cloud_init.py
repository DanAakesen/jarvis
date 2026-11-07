"""Render non-secret, idempotent provisioning. Never reformat an existing volume."""
import base64
import json
from pathlib import Path


def render(config):
    launcher = Path(__file__).with_name('worker_boot.py').read_text()
    files = [('/etc/jarvis-worker.json', json.dumps(config)), ('/opt/jarvis-worker-boot.py', launcher),
             ('/etc/systemd/system/jarvis-factory.service', '''[Unit]
Description=Jarvis Factory disk-backed worker
After=docker.service network-online.target
Requires=docker.service
StartLimitIntervalSec=0
[Service]
ExecStart=/usr/bin/python3 /opt/jarvis-worker-boot.py
ExecStop=/usr/bin/docker stop --time 30 jarvis-factory
Restart=always
RestartSec=30
TimeoutStopSec=40
[Install]
WantedBy=multi-user.target
''')]
    content = '#cloud-config\npackage_update: true\npackages: [docker.io, python3]\nwrite_files:\n'
    for path, text in files:
        content += f'  - path: {path}\n    permissions: "0600"\n    encoding: b64\n    content: {base64.b64encode(text.encode()).decode()}\n'
    content += '''runcmd:
  - |
    set -eu
    disk=/dev/disk/azure/scsi1/lun0
    test -b "$disk"
    if ! blkid "$disk" >/dev/null 2>&1; then
      # Refuse a volume with any existing signature/partition table.
      test -z "$(wipefs --no-act --noheadings "$disk")"
      mkfs.ext4 -m 1 "$disk"
    fi
    test "$(blkid -s TYPE -o value "$disk")" = ext4
    mkdir -p /mnt/jarvis-workspace
    uuid=$(blkid -s UUID -o value "$disk")
    grep -q "UUID=$uuid " /etc/fstab || echo "UUID=$uuid /mnt/jarvis-workspace ext4 defaults 0 2" >> /etc/fstab
    mount /mnt/jarvis-workspace
    mkdir -p /mnt/jarvis-workspace/jarvis
    chown 1000:1000 /mnt/jarvis-workspace/jarvis
    systemctl daemon-reload
    systemctl enable --now docker jarvis-factory
'''
    return base64.b64encode(content.encode()).decode()
