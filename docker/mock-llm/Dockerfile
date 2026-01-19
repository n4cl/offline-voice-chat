ARG GO_VERSION=1.25
FROM golang:${GO_VERSION} AS builder

WORKDIR /src
COPY backend/go.mod ./backend/go.mod
COPY backend ./backend

WORKDIR /src/backend
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/mock-llm ./cmd/mock-llm

FROM alpine:3.19
RUN adduser -D app
USER app
COPY --from=builder /out/mock-llm /mock-llm
EXPOSE 9002
ENTRYPOINT ["/mock-llm"]
