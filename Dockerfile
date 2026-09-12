# Only needed if you uncomment the `app` service in docker-compose.yml
# to containerize the Node server itself (Ollama runs in its own
# container regardless — see docker-compose.yml).

FROM node:20-slim

# better-sqlite3 needs build tools to compile its native binding
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
