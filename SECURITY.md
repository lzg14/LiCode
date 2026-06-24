# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x | ✅ |
| < 0.3.0 | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability within licode, please send an email to **lzg14@users.noreply.github.com**.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Any potential impact

You should receive a response within 48 hours. If the vulnerability is confirmed, a patch will be released as soon as possible.

## Security Best Practices

1. **API Keys**: Never commit API keys to version control. Use environment variables or `licode.config.json`.
2. **Command Execution**: licode uses a command whitelist for bash execution. Only approved commands can be run.
3. **File Access**: licode checks file paths against a security layer before reading/writing.
4. **Sensitive Data**: The `devLogger` automatically redacts API keys, tokens, and passwords in logs.

## Scope

This security policy applies to:
- The licode CLI tool
- The licode TUI application
- The licode API server (if deployed)

This does NOT apply to:
- Third-party integrations (MCP servers, etc.)
- User configurations
- User data stored in SQLite databases
