default: check

check:
	npm exec -- biome check .

format:
	npm exec -- biome check --write .

pre-commit:
	pre-commit run --all-files

publish: check
	npm publish

publish-dry-run: check
	npm publish --dry-run
