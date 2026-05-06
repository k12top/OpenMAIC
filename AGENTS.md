# Repository Guidelines

## Project Structure & Module Organization

OpenMAIC is a Next.js 16 TypeScript application. App routes and pages live in `app/`, reusable React UI in `components/`, shared logic in `lib/`, and project constants in `configs/`. Static assets are in `public/` and `assets/`. Drizzle database schema and migrations are in `lib/db/` and `drizzle/`. Unit tests are under `tests/**/*.test.ts`; Playwright specs, fixtures, and page objects are under `e2e/`. Internal workspace packages live in `packages/`.

## Build, Test, and Development Commands

Use Node.js `>=20.9.0` and pnpm `10.28.0`.

- `pnpm install`: install dependencies and build workspace packages.
- `pnpm dev`: run the local Next.js server.
- `pnpm build`: create a production build.
- `pnpm start`: serve the production build.
- `pnpm lint`: run ESLint.
- `pnpm check`: verify Prettier formatting.
- `pnpm format`: format the repository with Prettier.
- `pnpm test`: run Vitest unit tests.
- `pnpm test:e2e`: run Playwright tests; local base URL is `http://localhost:3002`.
- `make infra-up`: start PostgreSQL and MinIO.
- `make db-generate`, `make db-push`, `make db-migrate`: manage Drizzle schema changes.

## Coding Style & Naming Conventions

Write TypeScript and React using existing file-local patterns. Prefer `@/` imports when crossing top-level directories. Components and providers use kebab-case filenames such as `share-dialog.tsx`; tests use `*.test.ts` or `*.spec.ts`. ESLint extends Next core web vitals and TypeScript rules. Prettier is the formatter. Prefix intentionally unused variables or arguments with `_`.

## Testing Guidelines

Vitest discovers `tests/**/*.test.ts`; mirror the target area in the path, for example `tests/store/settings-validation.test.ts`. Playwright specs live in `e2e/tests`, with page objects in `e2e/pages` and fixtures in `e2e/fixtures`. Add unit tests for shared logic and e2e coverage for user-visible flows. Run `pnpm test` for logic changes and `pnpm test:e2e` for route, UI, or generation-flow changes.

## Commit & Pull Request Guidelines

Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`, or `style:`. Use scopes when helpful, for example `fix(whiteboard): prevent canvas reset`. Branches commonly use `feat/`, `fix/`, or `docs/`.

PRs should target `main`, stay focused on one concern, link an issue with `Closes #123` or `Fixes #123`, describe what changed and why, and include screenshots for UI changes. User-facing text must be internationalized. For AI-assisted PRs, disclose assistance and self-review first.

## Security & Configuration Tips

Copy `.env.example` to `.env.local`; never commit keys. Report vulnerabilities through GitHub Security Advisories rather than public issues. Contributions are AGPL-3.0 licensed.
