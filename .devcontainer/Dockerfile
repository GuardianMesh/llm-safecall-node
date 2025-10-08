FROM node:22-slim
WORKDIR /work
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build
