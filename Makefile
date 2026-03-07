# Solar Admin Dashboard Makefile

.PHONY: help install dev build test lint deploy deploy-frontend deploy-api clean

# Default target
help:
	@echo "Solar Admin Dashboard Commands:"
	@echo "================================"
	@echo "  install          - Install all dependencies"
	@echo "  dev              - Start Next.js development server"
	@echo "  build            - Build static export (out/)"
	@echo "  test             - Run tests (vitest)"
	@echo "  lint             - Run ESLint"
	@echo "  deploy           - Deploy frontend + API"
	@echo "  deploy-frontend  - Deploy frontend to S3/CloudFront"
	@echo "  deploy-api       - Deploy SAM API (Lambda functions)"
	@echo "  clean            - Remove build artifacts"

install:
	@echo "📦 Installing dependencies..."
	@npm install
	@cd serverless/admin-api && sam build

dev:
	@echo "🚀 Starting development server..."
	@npm run dev

build:
	@echo "🎨 Building static export..."
	@npm run build

test:
	@echo "🧪 Running tests..."
	@npm run test

lint:
	@echo "🔍 Running linter..."
	@npm run lint

deploy:
	@./scripts/deploy.sh all

deploy-frontend:
	@./scripts/deploy.sh frontend

deploy-api:
	@./scripts/deploy.sh api

clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf out/
	@rm -rf .next/
	@rm -rf node_modules/
	@rm -rf serverless/admin-api/.aws-sam/
