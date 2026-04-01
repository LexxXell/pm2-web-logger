# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [0.1.0] - 2026-04-01

### Added

- Initial Fastify-based HTTP and SSE service for PM2 log files
- Runtime config validation via `.env` and Zod
- Ring buffer storage per log source
- Tail loading for existing files on startup
- Poll-based append, truncate, and rotation handling
- Health, sources, snapshot, and SSE endpoints
- Optional bearer auth for `/api/*`
- Vitest test suite
- ESLint, Prettier, and TypeScript project setup
- Dockerfile, docker-compose example, PM2 ecosystem example, and Nginx example
- GitHub Actions CI workflow
