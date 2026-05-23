.PHONY: install test typecheck smoke dry-run

install:
	npm install

typecheck:
	npm run typecheck

test:
	npm test

smoke:
	npm run smoke

dry-run:
	npm run flue:dry
