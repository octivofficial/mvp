#!/bin/bash
# deploy-gcp.sh — Deploy Octiv Hub to Google Cloud VM
# Usage: ./scripts/deploy-gcp.sh [PROJECT_ID]
# Example: ./scripts/deploy-gcp.sh my-gcp-project-123

set -e

# ── Config (override via env or arg) ─────────────────────────
PROJECT_ID="${1:-${GCP_PROJECT_ID:-}}"
ZONE="${GCP_ZONE:-us-west2-a}"          # Los Angeles, USA
VM_NAME="${GCP_VM_NAME:-octiv-hub}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-e2-standard-4}"   # 4 vCPU, 16GB RAM
DISK_SIZE="${GCP_DISK_SIZE:-50}"
REPO="https://github.com/octivofficial/mvp.git"
BRANCH="main"

# ── Validate ─────────────────────────────────────────────────
if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: PROJECT_ID required."
  echo "Usage: $0 <project-id>"
  echo "   or: GCP_PROJECT_ID=my-project $0"
  exit 1
fi

if ! command -v gcloud &>/dev/null; then
  echo "ERROR: gcloud not installed. Run: brew install --cask google-cloud-sdk"
  exit 1
fi

echo "Octiv GCP Deployment"
echo "Project : $PROJECT_ID"
echo "Zone    : $ZONE"
echo "VM      : $VM_NAME ($MACHINE_TYPE)"

# ── 1. Create VM if not exists ────────────────────────────────
echo ""
echo "Step 1: VM setup"
if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
  echo "  Creating VM $VM_NAME..."
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size="${DISK_SIZE}GB" \
    --tags=octiv-server
  echo "  VM created. Waiting 30s for startup..."
  sleep 30
else
  echo "  VM $VM_NAME already exists — skipping creation."
fi

# ── 2. Firewall rules ─────────────────────────────────────────
echo ""
echo "Step 2: Firewall rules"
if ! gcloud compute firewall-rules describe octiv-allow-minecraft --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute firewall-rules create octiv-allow-minecraft \
    --project="$PROJECT_ID" \
    --allow=tcp:25565 \
    --target-tags=octiv-server \
    --description="Octiv: Minecraft client port"
  echo "  Created Minecraft firewall rule."
fi
if ! gcloud compute firewall-rules describe octiv-allow-dashboard --project="$PROJECT_ID" &>/dev/null; then
  gcloud compute firewall-rules create octiv-allow-dashboard \
    --project="$PROJECT_ID" \
    --allow=tcp:3000 \
    --target-tags=octiv-server \
    --description="Octiv: Web dashboard port"
  echo "  Created dashboard firewall rule."
fi
echo "  Firewall rules OK."

# ── 3. Copy .env to VM ────────────────────────────────────────
echo ""
echo "Step 3: Copying .env to VM"
if [ -f .env ]; then
  gcloud compute scp .env "$VM_NAME":/tmp/.env \
    --zone="$ZONE" --project="$PROJECT_ID"
  echo "  .env copied."
else
  echo "  WARNING: .env not found locally. Skipping."
fi

# ── 4. Deploy on VM ───────────────────────────────────────────
echo ""
echo "Step 4: Deploy on VM"
gcloud compute ssh "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" --command "
  set -e
  # Install Docker CE + compose plugin from official Docker repo
  if ! command -v docker &>/dev/null; then
    sudo apt-get update -q
    sudo apt-get install -y ca-certificates curl git
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -q
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo systemctl start docker && sudo systemctl enable docker
    sudo usermod -aG docker \$USER
  fi

  # Clone or update repo
  if [ -d /opt/octiv/.git ]; then
    cd /opt/octiv && sudo git fetch origin && sudo git reset --hard origin/${BRANCH}
  else
    sudo git clone ${REPO} /opt/octiv
  fi
  cd /opt/octiv

  # Place .env
  [ -f /tmp/.env ] && sudo cp /tmp/.env /opt/octiv/.env && rm /tmp/.env

  if [ ! -f .env ]; then
    echo 'ERROR: .env missing on VM. Aborting.'
    exit 1
  fi

  # Start all services (Redis + Minecraft + Bot)
  sudo docker compose pull --quiet
  sudo docker compose up -d --build

  echo 'Services started.'
  sleep 10
  sudo docker compose ps
"

# ── 5. Show access info ───────────────────────────────────────
echo ""
EXTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT_ID" \
  --format="get(networkInterfaces[0].accessConfigs[0].natIP)")

echo "Deployment complete."
echo ""
echo "  Minecraft : $EXTERNAL_IP:25565"
echo "  Dashboard : http://$EXTERNAL_IP:3000"
echo "  SSH       : gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "First run tip — fix Minecraft connection throttle after ~2 min:"
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command \\"
echo "  'cd /opt/octiv && sudo docker exec octiv-mc sed -i s/connection-throttle:.*/connection-throttle:0/ /data/bukkit.yml && sudo docker restart octiv-mc'"
