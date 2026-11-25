FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web
ENV VISIONONE_HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "src/index.js"]
