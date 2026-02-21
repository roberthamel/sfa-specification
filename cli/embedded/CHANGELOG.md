# Changelog

All notable changes to the SFA specification and SDKs will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-21

### Added
- Initial SFA specification
- TypeScript SDK with full spec compliance: CLI parsing, env protocol, config loading, logging, context store, safety guardrails, service dependencies, subagent invocation, and MCP server mode
- Go SDK with full spec compliance: CLI parsing, env protocol, config loading, logging, context store, safety guardrails, service dependencies, subagent invocation, and setup flow
- Go CLI (`sfa`) with `init`, `validate`, and `services` subcommands
- Multi-language SDK support with `--language` flag on `sfa init`
- `sfa update` command for re-vendoring SDKs
- SDK version detection in `sfa validate`
