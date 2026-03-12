#!/bin/bash
# deploy-gcp.sh — Setup and deploy Octiv Hub to Google Cloud VM

# Variables (User should adjust these)
PROJECT_ID="your-project-id"
ZONE="us-central1-a"
VM_NAME="octiv-hub"
MACHINE_TYPE="e2-standard-4"

echo "🚀 Octiv GCP Deployment Starter"
echo "────────────────────────────────"

# 1. Create VM (if not exists)
echo "Checking VM status..."
if ! gcloud compute instances describe $VM_NAME --zone=$ZONE > /dev/null 2>&1; then
    echo "Creating VM $VM_NAME..."
    gcloud compute instances create $VM_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud \
        --boot-disk-size=50GB \
        --tags=http-server,https-server
else
    echo "VM already exists."
fi

# 2. Setup VM environment (ssh and run commands)
echo "Preparing VM environment..."
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command "
    sudo apt-get update && sudo apt-get install -y docker.io git
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker \$USER
"

# 3. Build and push image (Local build or Cloud Build)
echo "Building and pushing Octiv image..."
# For simplicity, we assume the user will git clone on the VM and run docker-compose or docker build
# Alternatively, push to Artifact Registry:
# gcloud builds submit --tag gcr.io/$PROJECT_ID/octiv-hub .

# 4. Success and Security
echo ""
echo "✅ Deployment script executed."
echo "Suggested next steps:"
echo "1. SSH into the VM: gcloud compute ssh $VM_NAME"
echo "2. Set up your SECRET KEYS (ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.)"
echo "   TIP: Use GCP Secret Manager for better security."
echo "3. Run Octiv via Docker:"
echo "   docker build -t octiv-hub ."
echo "   docker run -d --name octiv-hub \\"
echo "     -e GOOGLE_API_KEY=your_key \\"
echo "     -e ANTHROPIC_API_KEY=your_key \\"
echo "     -v \$(pwd)/vault:/app/vault \\"
echo "     octiv-hub"
