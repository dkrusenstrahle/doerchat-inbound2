#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting SMTP Parsing Server Setup..."

# Update & Install Required System Packages
echo "📦 Updating system and installing dependencies..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ufw unzip git

# Install Redis only if not installed
if ! command -v redis-server &> /dev/null; then
    echo "📡 Installing Redis..."
    sudo apt install -y redis
    sudo systemctl enable --now redis-server
else
    echo "✅ Redis is already installed."
fi

# Install Node.js & npm only if missing
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "✅ Node.js is already installed: $(node -v)"
fi

echo "✅ npm version: $(npm -v)"

# Clone GitHub Repository if not exists, otherwise pull latest changes
if [ ! -d "$HOME/smtp-server" ]; then
    echo "📂 Cloning SMTP Server from GitHub..."
    git clone https://github.com/dkrusenstrahle/doerchat-inbound2.git "$HOME/smtp-server"
else
    echo "🔄 Updating existing repository..."
    cd "$HOME/smtp-server" && git pull
fi
cd "$HOME/smtp-server"

# Install Node.js Dependencies
echo "📦 Installing npm dependencies..."
npm install

# Configure Firewall (only if not already configured)
if ! sudo ufw status | grep -q "25/tcp"; then
    echo "🔥 Configuring firewall..."
    sudo ufw allow 25/tcp
    sudo ufw reload
else
    echo "✅ Port 25 already allowed in the firewall."
fi

# Install BullMQ for Background Jobs
echo "📥 Installing BullMQ..."
npm install bullmq

# Install PM2 if missing
if ! command -v pm2 &> /dev/null; then
    echo "🚀 Installing PM2..."
    npm install -g pm2
else
    echo "✅ PM2 is already installed."
fi

# Start & Save PM2 Processes
echo "🚀 Starting SMTP server..."
pm2 start server.js --name smtp-server || pm2 restart smtp-server

echo "⚙️ Setting up background job worker..."
pm2 start worker.js --name email-worker -i max || pm2 restart email-worker

# Ensure PM2 starts on reboot
echo "🔄 Ensuring PM2 auto-restart..."
pm2 save
pm2 startup
eval $(pm2 startup | tail -n 1)
pm2 save

# Show running processes
echo "✅ SMTP Parsing Server Setup Complete!"
pm2 list
echo "🔎 Run 'pm2 list' to check running services."
echo "🔎 Run 'pm2 logs smtp-server --lines 50' to see server logs."
echo "🔎 Run 'pm2 logs email-worker --lines 50' to see worker logs."
