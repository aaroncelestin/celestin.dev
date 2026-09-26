build-CelestinDevSite:
	npm ci
	npm run build
	mkdir -p "$(ARTIFACTS_DIR)"
	cp -R dist "$(ARTIFACTS_DIR)/dist"
	cp -R server "$(ARTIFACTS_DIR)/server"
	cp package.json package-lock.json "$(ARTIFACTS_DIR)/"
	cd "$(ARTIFACTS_DIR)" && npm ci --omit=dev
