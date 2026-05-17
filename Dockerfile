FROM mcr.microsoft.com/playwright:v1.60.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]
