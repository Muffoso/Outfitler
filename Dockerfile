FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

CMD ["sh", "-c", "node src/scripts/migrate.js && npm start"]
