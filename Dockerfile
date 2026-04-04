FROM node:20-alpine
WORKDIR /app
# Copy package files
COPY package*.json ./
# Install dependencies (including prod only)
RUN npm install --omit=dev
# Copy rest of code
COPY . .
# Backend app port number
EXPOSE 5000
CMD ["npm", "start"]
