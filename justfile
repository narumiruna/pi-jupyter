default: check

check:
	npm exec -- biome check .

format:
	npm exec -- biome check --write .

pre-commit:
	pre-commit run --all-files

publish otp="": check
	#!/usr/bin/env bash
	set -euo pipefail
	if [ -n "{{otp}}" ]; then
		npm publish --access public --otp "{{otp}}"
	else
		npm publish --access public
	fi

publish-dry-run: check
	npm publish --access public --dry-run
