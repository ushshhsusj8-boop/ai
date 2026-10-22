FROM node:24.17.0-alpine3.24
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /var/lib/plaude-chat && chown node:node /var/lib/plaude-chat
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
