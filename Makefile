.PHONY: install dev build start lint format test e2e e2e-ui clean help \
       db-generate db-push db-migrate db-studio db-status db-drop db-seed \
       infra-up infra-down infra-ps

.DEFAULT_GOAL := help

help: ## 显示可用命令列表
	@echo ""
	@echo "\033[1m── OpenMAIC 可用命令 ──\033[0m"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "\033[1m── 数据库初始化推荐顺序 ──\033[0m"
	@echo ""
	@echo "  1. make infra-up        启动 PostgreSQL + MinIO 容器"
	@echo "  2. make db-generate     根据 schema.ts 生成 SQL 迁移文件"
	@echo "  3. make db-push         将当前 schema 直接推送到数据库 (开发用)"
	@echo "     或 make db-migrate   通过迁移文件升级数据库 (生产用)"
	@echo "  4. make dev             启动应用"
	@echo ""

# ─── 基础设施 (Docker) ───────────────────────────────────────────────────────

infra-up: ## 启动 PostgreSQL + MinIO 基础设施容器
	docker compose up -d postgres minio
	@echo ""
	@echo "PostgreSQL: localhost:5432  |  MinIO API: localhost:9000  |  MinIO Console: localhost:9001"

infra-down: ## 停止并移除基础设施容器 (数据卷保留)
	docker compose down

infra-ps: ## 查看基础设施容器运行状态
	docker compose ps

# ─── 数据库管理 (Drizzle ORM) ────────────────────────────────────────────────

db-generate: ## 根据 schema.ts 变更生成 SQL 迁移文件 (drizzle/)
	npx drizzle-kit generate

db-push: ## 将当前 schema 直接推送到数据库 (开发环境快速同步, 不生成迁移文件)
	npx drizzle-kit push

db-migrate: ## 执行 drizzle/ 目录下的迁移文件升级数据库 (生产推荐)
	npx tsx lib/db/migrate.ts

db-studio: ## 启动 Drizzle Studio 可视化管理数据库 (浏览器打开)
	npx drizzle-kit studio

db-status: ## 查看当前 schema 与数据库的差异
	npx drizzle-kit check

db-drop: ## 删除一个已生成但未使用的迁移文件 (交互式选择)
	npx drizzle-kit drop

db-seed: ## 为开发环境插入示例数据 (需要先完成迁移)
	@echo "TODO: 待实现 — 可在 lib/db/seed.ts 编写种子脚本"

# ─── 项目开发 ────────────────────────────────────────────────────────────────

proto-gen: ## 生成基于 proto 文件的 TypeScript 强类型声明
	npx proto-loader-gen-types --grpcLib=@grpc/grpc-js --outDir=lib/grpc/types lib/grpc/proto/tdd_openmaic.proto

grpc-mock: ## 启动本地 Mock gRPC 服务器和客户端连通性沙盒进行测试
	npx tsx test-grpc.ts

install: ## 安装项目所有依赖 (包含子包的构建)
	pnpm install

dev: ## 启动本地开发服务器
	pnpm run dev

build: ## 构建生产级产物
	pnpm run build

start: ## 启动生产服务器 (需要先运行 make build)
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
	rm -rf node_modules .next packages/*/node_modules packages/*/dist
	@echo "清理已完成"
