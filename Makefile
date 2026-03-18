.PHONY: help install build test lint format clean dev docker-up docker-down docker-logs

help:
	@echo "Salish Forge Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install      - Install all dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make dev          - Start all services in development mode"
	@echo "  make build        - Build all services"
	@echo ""
	@echo "Testing:"
	@echo "  make test         - Run all tests"
	@echo "  make test-watch   - Run tests in watch mode"
	@echo "  make coverage     - Generate coverage reports"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint         - Lint all services"
	@echo "  make lint-fix     - Auto-fix linting issues"
	@echo "  make format       - Format code"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up    - Start full stack with Docker Compose"
	@echo "  make docker-down  - Stop Docker Compose stack"
	@echo "  make docker-logs  - View Docker Compose logs"
	@echo "  make docker-clean - Remove containers and volumes"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make clean-all    - Remove build artifacts and node_modules"

install:
	@echo "Installing dependencies..."
	cd dashboard && npm install
	cd ../memforge-standalone && npm install
	cd ../hyphae && npm install
	@echo "✓ Dependencies installed"

build:
	@echo "Building services..."
	cd dashboard && npm run build
	cd ../memforge-standalone && npm run build
	cd ../hyphae && npm run build
	@echo "✓ All services built"

dev:
	@echo "Starting services in development mode..."
	@echo "Dashboard:    http://localhost:3000"
	@echo "MemForge:     http://localhost:3001"
	@echo "Hyphae:       http://localhost:3002"
	@echo ""
	npm run dev --workspaces

test:
	@echo "Running tests..."
	cd dashboard && npm test
	cd ../memforge-standalone && npm test
	cd ../hyphae && npm test

test-watch:
	@echo "Running tests in watch mode..."
	npm run test:watch --workspaces

coverage:
	@echo "Generating coverage reports..."
	cd dashboard && npm run coverage
	cd ../memforge-standalone && npm run coverage
	cd ../hyphae && npm run coverage

lint:
	@echo "Linting code..."
	cd dashboard && npm run lint
	cd ../memforge-standalone && npm run lint
	cd ../hyphae && npm run lint

lint-fix:
	@echo "Fixing linting issues..."
	cd dashboard && npm run lint:fix
	cd ../memforge-standalone && npm run lint:fix
	cd ../hyphae && npm run lint:fix

format:
	@echo "Formatting code..."
	cd dashboard && npm run format
	cd ../memforge-standalone && npm run format
	cd ../hyphae && npm run format

docker-up:
	@echo "Starting Docker Compose stack..."
	docker-compose up -d
	@echo "✓ Stack started"
	@echo "Dashboard:    http://localhost:3000/health"
	@echo "MemForge:     http://localhost:3001/health"
	@echo "Hyphae:       http://localhost:3002/health"

docker-down:
	@echo "Stopping Docker Compose stack..."
	docker-compose down
	@echo "✓ Stack stopped"

docker-logs:
	@echo "Streaming logs..."
	docker-compose logs -f

docker-clean:
	@echo "Removing containers and volumes..."
	docker-compose down -v
	@echo "✓ Cleaned"

clean:
	@echo "Removing build artifacts..."
	cd dashboard && npm run clean
	cd ../memforge-standalone && npm run clean
	cd ../hyphae && npm run clean
	@echo "✓ Cleaned"

clean-all: clean
	@echo "Removing node_modules..."
	rm -rf dashboard/node_modules
	rm -rf memforge-standalone/node_modules
	rm -rf hyphae/node_modules
	@echo "✓ All cleaned"
