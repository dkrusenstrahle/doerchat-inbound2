#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting SMTP Parsing Server Setup..."

# Update & Install Required System Packages
echo "📦 Updating system and installing dependencies..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ufw unzip git redis

# Install Node.js & npm
echo "📥 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v

# Clone GitHub Repository
echo "📂 Cloning SMTP Server from GitHub..."
cd ~
git clone https://github.com/dkrusenstrahle/doerchat-inbound2.git smtp-server || (cd smtp-server && git pull)
cd smtp-server

# Install Node.js Dependencies
echo "📦 Installing npm dependencies..."
npm install

# Configure Firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 25/tcp
sudo ufw reload
sudo ufw status

# Start & Enable Redis
echo "📡 Setting up Redis..."
sudo systemctl start redis-server
sudo systemctl enable redis-server
systemctl status redis-server || true

# Install BullMQ for Background Jobs
echo "📥 Installing BullMQ..."
npm install bullmq

# Install PM2 & Start SMTP Server
echo "🚀 Installing PM2 & starting SMTP server..."
npm install -g pm2
pm2 start server.js --name smtp-server
pm2 save
pm2 startup

# Execute suggested startup command
echo "🔄 Running PM2 startup..."
eval $(pm2 startup | tail -n 1)
pm2 save

# Enable Multi-Threading (Cluster Mode)
echo "💪 Running SMTP server in multi-threaded mode..."
pm2 restart smtp-server -i max

# Setup Background Worker
echo "⚙️ Setting up background job worker..."
pm2 start worker.js --name email-worker -i max

# Save all PM2 processes for auto-restart
echo "🔄 Ensuring auto-restart on reboot..."
pm2 save
pm2 list

echo "✅ SMTP Parsing Server Setup Complete!"
echo "🔎 Run 'pm2 list' to check running services."
echo "🔎 Run 'pm2 logs smtp-server --lines 50' to see server logs."
echo "🔎 Run 'pm2 logs email-worker --lines 50' to see worker logs."
