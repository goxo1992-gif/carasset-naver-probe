FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY server.cjs ./
USER pwuser
ENV NODE_ENV=production
CMD ["node", "server.cjs"]
