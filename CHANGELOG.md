# Changelog

All notable changes to AI-local-OS will be documented in this file.

## [0.4.0] - 2026-05-21

### Added
- Phase 4: IaC with Docker Compose
- Docker Compose configuration for all services
- Dockerfile for Gateway
- Hermes instance configurations
- Network policy (isolated Docker network)
- Version pinning documentation
- Deployment script (deploy.sh)
- Comprehensive README

### Changed
- Updated Gateway to support Docker deployment
- Improved health check endpoints

## [0.3.0] - 2026-05-21

### Added
- Phase 3: Thin Gateway MVP
- HTTP server with OpenAI-compatible API
- API Key authentication
- Instance routing with intent analysis
- Circuit breaker for fault tolerance
- Rate limiting (sliding window)
- Structured audit logging
- Health check endpoints

### Changed
- Enhanced routing logic with scoring mechanism

## [0.2.0] - 2026-05-21

### Added
- Phase 2: Multi-instance expansion
- Added life and research instances (ports 8003, 8004)
- Enhanced routing with scoring mechanism
- Circuit breaker for fault tolerance
- Multi-instance startup script
- Extended smoke tests for all instances

### Changed
- Improved intent analysis with keyword matching

## [0.1.0] - 2026-05-21

### Added
- Phase 1: Minimum viable loop
- Hermes API Server integration (port 8002)
- OpenClaw Hook for message routing
- Intent analysis and instance selection
- Smoke tests passed (3/3)

### Changed
- Initial project structure

## [0.0.1] - 2026-04-26

### Added
- Initial project setup
- Design specifications
- Routing rules
- Instance templates
