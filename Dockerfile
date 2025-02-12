# Use an official Node.js runtime as the base image
FROM node:22

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Remove any pre-existing node_modules (if exists, useful in rebuilds)
RUN rm -rf node_modules

# Install the application dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Ensure node_modules are removed again to avoid conflicts
RUN rm -rf node_modules

# Install the dependencies again to ensure a clean state
RUN npm install --production

# Define the environment variable for the port
ENV PORT=25

# Expose port 80
EXPOSE 25

# Use dumb-init to properly handle signals
RUN apt-get update && apt-get install -y dumb-init

# Command to run the application
CMD ["dumb-init", "node", "server.js"]

# If using Node.js to listen on port 80, we need to run it with elevated privileges
USER root
