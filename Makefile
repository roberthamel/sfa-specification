.PHONY: all test lint validate build clean help
.PHONY: test-sdk-typescript test-sdk-golang test-sdks test-cli test-all
.PHONY: lint-sdk lint-cli
.PHONY: validate-examples
.PHONY: build-cli build-examples build-all
.PHONY: sync-sdks

# ─── Config ───────────────────────────────────────────────────────────
CLI_DIR        := cli
SDK_TS_DIR     := sdk/typescript/@sfa/sdk
SDK_GO_DIR     := sdk/golang/sfa
TESTS_DIR      := tests/sdk
EXAMPLES_DIR   := examples
EMBEDDED_SDKS  := $(CLI_DIR)/embedded/sdks
EMBEDDED_DIR   := $(CLI_DIR)/embedded

EXAMPLES       := $(notdir $(wildcard $(EXAMPLES_DIR)/*))
CLI_BIN        := sfa
BUILD_DIR      := build

# Cross-compilation targets
PLATFORMS      := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

# ─── Default ──────────────────────────────────────────────────────────
all: lint test validate build

# ─── Testing ──────────────────────────────────────────────────────────
test: test-sdks test-cli ## Run all tests

test-sdk-typescript: ## Run TypeScript SDK tests (bun)
	bun test $(TESTS_DIR)

test-sdk-golang: ## Run Go SDK tests
	cd $(SDK_GO_DIR) && go test ./...

test-sdks: test-sdk-typescript test-sdk-golang ## Run all SDK tests

test-cli: ## Run CLI tests (go)
	cd $(CLI_DIR) && go test ./...

# ─── Linting ──────────────────────────────────────────────────────────
lint: lint-sdk lint-cli ## Run all linters

lint-sdk: ## Typecheck SDK with tsc
	bunx tsc --noEmit --strict --moduleResolution bundler --module esnext --target esnext \
		--skipLibCheck --types bun-types \
		$(SDK_TS_DIR)/index.ts

lint-cli: ## Lint Go CLI with vet
	cd $(CLI_DIR) && go vet ./...

# ─── Validation ───────────────────────────────────────────────────────
validate-examples: build-cli ## Validate all example agents against the spec
	@for ex in $(EXAMPLES); do \
		echo "==> Validating $$ex"; \
		./$(BUILD_DIR)/$(CLI_BIN) validate bun $(EXAMPLES_DIR)/$$ex/agent.ts || exit 1; \
	done
	@echo "All examples valid."

# ─── Build ────────────────────────────────────────────────────────────
build: build-cli ## Build all artifacts

build-cli: sync-sdks ## Build the sfa CLI binary
	@mkdir -p $(BUILD_DIR)
	cd $(CLI_DIR) && CGO_ENABLED=0 go build -o ../$(BUILD_DIR)/$(CLI_BIN) .

build-examples: ## Compile example agents to standalone binaries
	@mkdir -p $(BUILD_DIR)/examples
	@for ex in $(EXAMPLES); do \
		echo "==> Compiling $$ex"; \
		bun build --compile $(EXAMPLES_DIR)/$$ex/agent.ts --outfile $(BUILD_DIR)/examples/$$ex; \
	done

build-cross: ## Cross-compile sfa CLI for all platforms
	@mkdir -p $(BUILD_DIR)
	@for platform in $(PLATFORMS); do \
		os=$${platform%%/*}; \
		arch=$${platform##*/}; \
		ext=""; \
		[ "$$os" = "windows" ] && ext=".exe"; \
		echo "==> Building $$os/$$arch"; \
		cd $(CLI_DIR) && GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 \
			go build -o ../$(BUILD_DIR)/$(CLI_BIN)-$$os-$$arch$$ext . && cd ..; \
	done

# ─── SDK Sync ─────────────────────────────────────────────────────────
sync-sdks: ## Sync SDK sources + VERSION + CHANGELOG into CLI embedded directory
	@echo "Syncing TypeScript SDK → $(EMBEDDED_SDKS)/typescript/"
	@rm -rf $(EMBEDDED_SDKS)/typescript
	@mkdir -p $(EMBEDDED_SDKS)/typescript
	@cp -r $(SDK_TS_DIR)/* $(EMBEDDED_SDKS)/typescript/
	@echo "Syncing Go SDK → $(EMBEDDED_SDKS)/golang/"
	@rm -rf $(EMBEDDED_SDKS)/golang
	@mkdir -p $(EMBEDDED_SDKS)/golang
	@find $(SDK_GO_DIR) -name '*_test.go' -prune -o -name 'go.sum' -prune -o -type f -print | while read f; do \
		rel=$${f#$(SDK_GO_DIR)/}; \
		mkdir -p $(EMBEDDED_SDKS)/golang/$$(dirname $$rel); \
		cp $$f $(EMBEDDED_SDKS)/golang/$$rel; \
	done
	@echo "Syncing VERSION + CHANGELOG → $(EMBEDDED_DIR)/"
	@cp VERSION $(EMBEDDED_DIR)/VERSION
	@cp CHANGELOG.md $(EMBEDDED_DIR)/CHANGELOG.md

# ─── Clean ────────────────────────────────────────────────────────────
clean: ## Remove build artifacts
	rm -rf $(BUILD_DIR)

# ─── Help ─────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
