.PHONY: install dev build start lint format test e2e e2e-ui clean help

# 默认命令显示帮助信息
.DEFAULT_GOAL := help

help: ## 显示可用命令列表
	@echo "可用命令:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## 安装项目所有依赖 (包含子包的构建)
	pnpm install

dev: ## 启动本地开发服务器
	pnpm run dev

build: ## 构建生产级产物
	pnpm run build

start: ## 启动生产服务器 (需要在 make build 之后运行)
	pnpm run start

lint: ## 运行代码质量检测
	pnpm run lint
	pnpm run check

format: ## 格式化所有代码文件
	pnpm run format

test: ## 运行所有单元测试
	pnpm run test

e2e: ## 运行端到端 (E2E) 测试
	pnpm run test:e2e

e2e-ui: ## 运行带 UI 界面的端到端测试
	pnpm run test:e2e:ui

clean: ## 清理安装依赖和构建的中间缓存产物
	rm -rf node_modules
	rm -rf .next
	rm -rf packages/*/node_modules
	rm -rf packages/*/dist
	@echo "清理已完成 🧹"
