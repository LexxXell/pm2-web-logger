# Contributing

Thanks for contributing to `pm2-web-logger`.

## Development Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Before Opening a Pull Request

Run the full local check set:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Contribution Guidelines

- Keep the project small and focused on local PM2 log exposure over HTTP and SSE.
- Prefer reliability and clarity over feature breadth.
- Avoid adding databases, Redis, WebSockets, or UI code unless the project direction changes.
- Keep configuration `.env`-driven and validated.
- Add or update tests for behavior changes.
- Preserve compatibility for current API routes unless a versioned change is required.

## Commit and PR Notes

- Use clear commit messages.
- Include a short problem statement and behavior summary in PR descriptions.
- Document new environment variables and operational caveats in the README.

## Reporting Security Issues

Do not open a public issue for sensitive vulnerabilities. Report them privately to the repository maintainers.
