# XAICG server image.
#
# This file sits at the repository root on purpose: Railway builds any repo
# that has a root Dockerfile with it automatically, so deploying needs no
# build settings. The extension folder is not part of the image.

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src

USER node
EXPOSE 8787
CMD ["node", "src/index.js"]
