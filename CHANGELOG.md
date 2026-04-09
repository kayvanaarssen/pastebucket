# Changelog

All notable changes to PasteBucket will be documented in this file.

## [1.0.0] - 2026-04-09

### Added

- **Paste creation** with syntax highlighting for 39+ languages, auto-detection, and customizable options
- **Live preview** with syntax highlighting while editing, toggled via button next to detected language
- **Paste viewing** with line numbers, raw view, and copy-to-clipboard
- **Visibility options**: public, unlisted, and private pastes
- **Burn after read** support for self-destructing pastes
- **Password-protected pastes** with server-side verification
- **Expiration** support (10 minutes, 1 hour, 1 day, 1 week, 1 month, never)
- **User authentication** with email/password registration and login
- **Passkey authentication** (WebAuthn) with Face ID, Touch ID, and Windows Hello support
- **Passkey management** on Profile page (register, name, and remove passkeys)
- **User dashboard** with paginated list of own pastes, visibility badges, and view counts
- **Profile settings** with name/email update and password change
- **Admin dashboard** with stats (total pastes, active pastes, total users, today's pastes) and paste search
- **Admin user management** with create, edit, delete, and role toggle (user/admin)
- **In-app confirmation dialogs** for all destructive actions (delete paste, remove passkey, delete user)
- **Dark mode** support with theme toggle
- **Responsive design** built with Tailwind CSS 4 and shadcn/ui components
- **SVG favicon** with dark mode support

### Technical

- Laravel 13 with Inertia.js v3, React 19, and TypeScript
- Vite build pipeline with HMR for development
- Syntax highlighting via react-syntax-highlighter with explicit language registration (Light build)
- WebAuthn passkey support with PEM public key storage
- OKLCH color system for consistent theming across light and dark modes
