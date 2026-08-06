import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const search = read('lib/modules/search.js');
const styles = read('lib/options/options.scss');

test('the results panel is shown via the hidden attribute, not an inline display value', () => {
	// The stylesheet used to declare `#SearchRES-results-container { display: none }`
	// while the module tried to reveal it with `style.display = ''`. Clearing an
	// inline property cannot beat a stylesheet rule, so the panel stayed invisible
	// no matter how many results matched.
	assert.match(search, /resultsContainer\.hidden = false/);
	assert.match(search, /resultsContainer\.hidden = true/);
	assert.doesNotMatch(search, /resultsContainer\.style\.display/);
	assert.doesNotMatch(search, /resultsList\.style\.display/);

	const containerRule = styles.match(/#SearchRES-results-container \{([\s\S]*?)\n\}/);
	assert.ok(containerRule, 'expected a #SearchRES-results-container rule');
	assert.doesNotMatch(containerRule[1], /display:\s*none/,
		'the container must not hide itself in CSS — the module controls visibility');
});

test('result descriptions are flattened to text so no anchor is nested in the result link', () => {
	// Several module descriptions (noParticipation, saveComments, archiveLinks)
	// contain <a> tags. Rendering those inside the result's own <a> made the
	// parser split the markup into two root elements, and string.html threw for
	// every result — search rendered nothing and logged one exception per match.
	assert.match(search, /function descriptionText\(/);
	assert.match(search, /\$\{descriptionText\(description\)\}/);
	assert.doesNotMatch(search, /\$\{string\.safe\(description\)\}/);
});

test('a zero-result search renders a named empty state rather than a blank panel', () => {
	assert.match(search, /id="SearchRES-empty"/);
	assert.match(search, /SearchRES-empty-query/);
	assert.match(search, /searchNoResultsTitle/);
	assert.match(search, /searchNoResultsHint/);
	assert.match(search, /emptyState\.hidden = false/);
	assert.match(search, /emptyState\.hidden = true/);

	const locale = JSON.parse(read('locales/locales/en.json'));
	assert.ok(locale.searchNoResultsTitle?.message, 'searchNoResultsTitle must exist in en.json');
	assert.ok(locale.searchNoResultsHint?.message, 'searchNoResultsHint must exist in en.json');

	assert.match(styles, /#SearchRES-empty \{/);
});

test('the search workspace hides the empty module-options canvas', () => {
	assert.match(styles, /is-search-workspace \.workspaceCanvas \{ display: none; \}/,
		'the options canvas has no content on the search workspace and must not paint an empty card');
});
