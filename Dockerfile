FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g @larksuite/cli && npm cache clean --force

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY dist/ ./dist/

ENV MCP_TRANSPORT=http
ENV PORT=8000
ENV NO_COLOR=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
