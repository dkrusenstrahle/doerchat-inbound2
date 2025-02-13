#!/bin/bash

# Exit on any error
set -e

echo "================================================"
echo "🚀 Starting SMTP Parsing Server Setup..."
echo "================================================"

# Update & Install Required System Packages
echo "================================================"
echo "📦 Updating system and installing dependencies..."
echo "================================================"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ufw unzip git

# Install Redis only if not installed
if ! command -v redis-server &> /dev/null; then
    echo "================================================"
    echo "📡 Installing Redis..."
    echo "================================================"
    sudo apt install -y redis
    sudo systemctl enable --now redis-server
else
    echo "================================================"
    echo "✅ Redis is already installed."
    echo "================================================"
fi

# Install Node.js & npm only if missing
if ! command -v node &> /dev/null; then
    echo "================================================"
    echo "📥 Installing Node.js..."
    echo "================================================"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "================================================"
    echo "✅ Node.js is already installed: $(node -v)"
    echo "================================================"
fi

echo "✅ npm version: $(npm -v)"

# Clone GitHub Repository if not exists, otherwise pull latest changes
if [ ! -d "$HOME/smtp-server" ]; then
    echo "================================================"
    echo "📂 Cloning SMTP Server from GitHub..."
    echo "================================================"
    git clone https://github.com/dkrusenstrahle/doerchat-inbound2.git "$HOME/smtp-server"
else
    echo "================================================"
    echo "🔄 Updating existing repository..."
    echo "================================================"
    cd "$HOME/smtp-server" && git pull
fi
cd "$HOME/smtp-server"

# Install Node.js Dependencies
echo "================================================"
echo "📦 Installing npm dependencies..."
echo "================================================"
npm install

# Configure Firewall (only if not already configured)
if ! sudo ufw status | grep -q "25/tcp"; then
    echo "================================================"
    echo "🔥 Configuring firewall..."
    echo "================================================"
    sudo ufw allow 25/tcp
    sudo ufw reload
else
    echo "================================================"
    echo "✅ Port 25 already allowed in the firewall."
    echo "================================================"
fi

# Install SpamAssassin only if not installed
if ! command -v spamassassin &> /dev/null; then
    echo "================================================"
    echo "🛡 Installing SpamAssassin..."
    echo "================================================"
    sudo apt install -y spamassassin
    sudo systemctl enable --now spamassassin
else
    echo "================================================"
    echo "✅ SpamAssassin is already installed."
    echo "================================================"
fi

# Configure SpamAssassin Sensitivity (Optional)
SPAM_CONF="/etc/spamassassin/local.cf"
if ! grep -q "required_score" "$SPAM_CONF"; then
    echo "================================================"
    echo "⚙️ Setting SpamAssassin sensitivity..."
    echo "================================================"
    echo "required_score 7.0" | sudo tee -a "$SPAM_CONF"
    sudo systemctl restart spamassassin
fi

# Install BullMQ for Background Jobs
echo "================================================"
echo "📥 Installing BullMQ..."
echo "================================================"
npm install bullmq

# Install PM2 if missing
if ! command -v pm2 &> /dev/null; then
    echo "================================================"
    echo "🚀 Installing PM2..."
    echo "================================================"
    npm install -g pm2
else
    echo "================================================"
    echo "✅ PM2 is already installed."
    echo "================================================"
fi

# Start & Save PM2 Processes
echo "================================================"
echo "🚀 Starting SMTP server..."
echo "================================================"
pm2 start server.js --name smtp-server || pm2 restart smtp-server

echo "================================================"
echo "⚙️ Setting up background job worker..."
echo "================================================"
pm2 start worker.js --name email-worker -i max || pm2 restart email-worker

echo "================================================"
echo "📊 Starting Bull Board Dashboard..."
echo "================================================"
pm2 start bull-board.js --name queue-dashboard || pm2 restart queue-dashboard

# Ensure PM2 starts on reboot
echo "================================================"
echo "🔄 Ensuring PM2 auto-restart..."
echo "================================================"
pm2 save
pm2 startup
eval $(pm2 startup | tail -n 1)
pm2 save

# Show running processes
echo "================================================"
echo "✅ SMTP Parsing Server Setup Complete!"
echo "================================================"
pm2 list
echo "🔎 Run 'pm2 list' to check running services."
echo "🔎 Run 'pm2 logs smtp-server --lines 50' to see server logs."
echo "🔎 Run 'pm2 logs email-worker --lines 50' to see worker logs."
echo "🔎 Run 'pm2 logs queue-dashboard --lines 50' to see Bull Board logs."
echo "🔗 Open Bull Board at: http://YOUR-SERVER-IP:3001/admin/queues"
