FROM oven/bun:1.1.34-alpine

RUN apk update
RUN apk upgrade
RUN apk add --no-cache curl
RUN mkdir /music
RUN mkdir /app
RUN mkdir /app/src
WORKDIR /app
COPY ./index.ts /app
COPY ./src /app/src
COPY ./package.json /app
RUN bun install

CMD [ "tail", "-f", "/etc/passwd" ] 