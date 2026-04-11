/* eslint-disable no-unused-expressions */

// Nightwatch tests for the RES-Slim settings console.
//
// Upstream RES's test suite referenced modules that were stripped from
// RES-Slim in v0.1.0 (accountSwitcher, keepLoggedIn, quickMessage, wheelBrowse).
// These fixtures were rewritten in v0.3.9 against modules that actually exist
// in this fork:
//
//   boolean / text / table : commentDepth
//   enum                   : absoluteTimestamps
//   toggle-module          : autoExpand
//   boolean (discard test) : commentHighlights
//   dependsOn visibility   : commentQuickCollapse (unchanged from upstream)
//
// No CI runs this suite; it's here so the selectors and module references
// stay consistent with the actual codebase if someone ever revives the
// test infrastructure.

module.exports = {
	'opens on links to #res:settings': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings')
			.waitForElementVisible('#console-container')
			.end();
	},
	'opens on old-style links to #!settings and redirects to new style': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#!settings')
			.waitForElementVisible('#console-container')
			.assert.urlContains('https://en.reddit.com/wiki/pages#res:settings')
			.end();
	},
	'opens when clicking nested content inside a settings link': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages')
			.waitForElementVisible('body')
			.execute(() => {
				const link = document.createElement('a');
				link.href = '#res:settings/commentHighlights';
				link.id = 'nested-settings-link';
				link.innerHTML = '<span id="nested-settings-link-label">Open settings</span>';
				document.body.appendChild(link);
			})
			.click('#nested-settings-link-label')
			.waitForElementVisible('#console-container')
			.end();
	},
	'change boolean option': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentDepth')
			.waitForElementVisible('#RESConsoleContainer')

			// initial state, no options changed
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// enable commentPermalinks (defaults to false)
			.click('#commentPermalinksContainer')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-dirty', 'options staged')

			// click save
			.click('#RESGlobalSave')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// refresh and ensure that the option was saved
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.perform(() => {
				browser.expect.element('#commentPermalinks').selected;
			})
			.end();
	},
	'change enum option': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/absoluteTimestamps')
			.waitForElementVisible('#RESConsoleContainer')

			// initial state, no options changed; format defaults to 'locale' (index 0)
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')
			.perform(() => {
				browser.expect.element('#format-0').selected;
			})

			// select "ISO" dropdown style (index 1)
			.click('#format-1')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-dirty', 'options staged')

			// click save
			.click('#RESGlobalSave')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// refresh and ensure that the option was saved
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.perform(() => {
				browser.expect.element('#format-1').selected;
			})
			.end();
	},
	'change text option': browser => {
		if (browser.options.desiredCapabilities.browserName === 'firefox') {
			// marionette crashes on setValue
			browser.end();
			return;
		}

		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentDepth')
			.waitForElementVisible('#RESConsoleContainer')

			// initial state, no options changed
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// set a value for defaultCommentDepth (defaults to "4")
			.clearValue('#defaultCommentDepth')
			.setValue('#defaultCommentDepth', ['8'])
			.pause(1000)
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-dirty', 'options staged')

			// click save
			.click('#RESGlobalSave')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// refresh and ensure that the option was saved
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.assert.value('#defaultCommentDepth', '8')
			.end();
	},
	'change table option': browser => {
		if (browser.options.desiredCapabilities.browserName === 'firefox') {
			// marionette crashes on setValue
			browser.end();
			return;
		}

		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentDepth')
			.waitForElementVisible('#RESConsoleContainer')

			// initial state, no options changed
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// add row to subredditCommentDepths and set the per-subreddit depth field.
			// Table input IDs follow `${optionKey}_${field.name}_${rowIndex}` — for the
			// first newly-added row rowIndex is 1 (the addRow handler starts from
			// existingRows + 1).
			.click('#optionContainer-commentDepth-subredditCommentDepths .addRowButton')
			.setValue('#subredditCommentDepths_commentDepthCommentDepth_1', ['6'])
			.pause(1000)
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-dirty', 'options staged')

			// click save
			.click('#RESGlobalSave')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved', 'options not staged')

			// refresh and ensure that the option was saved — after commit the
			// committed rows are rendered at zero-based indices, so row 1 on save
			// becomes row 0 on reload.
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.assert.value('#subredditCommentDepths_commentDepthCommentDepth_0', '6')
			.end();
	},
	'disabling a module': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/autoExpand')
			.waitForElementVisible('#RESConsoleContainer')
			.assert.cssClassPresent('.moduleToggle', 'enabled')
			.click('.moduleToggle')
			.assert.not.cssClassPresent('.moduleToggle', 'enabled')
			.click('#RESGlobalSave')
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.assert.not.cssClassPresent('.moduleToggle', 'enabled')
			.end();
	},
	'discarding staged changes resets the workspace': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentHighlights')
			.waitForElementVisible('#RESConsoleContainer')
			.assert.hidden('#RESGlobalDiscard')
			// borderOnly is a boolean that defaults to false; clicking the
			// container toggles it and stages the change.
			.click('#borderOnlyContainer')
			.assert.visible('#RESGlobalDiscard')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-dirty')
			.click('#RESGlobalDiscard')
			.assert.hidden('#RESGlobalDiscard')
			.assert.cssClassPresent('#RESGlobalStageBar', 'is-saved')
			.perform(() => {
				browser.expect.element('#borderOnly').not.selected;
			})
			.end();
	},
	'adding a row to table option doesn\'t duplicate value': browser => {
		if (browser.options.desiredCapabilities.browserName === 'firefox') {
			// geckodriver treats `value` of empty inputs incorrectly
			browser.end();
			return;
		}

		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentDepth')
			.waitForElementVisible('#RESConsoleContainer')
			.click('#optionContainer-commentDepth-subredditCommentDepths .addRowButton')
			.setValue('#subredditCommentDepths_commentDepthCommentDepth_1', ['6'])
			.click('#RESGlobalSave')
			.refresh()
			.waitForElementVisible('#RESConsoleContainer')
			.click('#optionContainer-commentDepth-subredditCommentDepths .addRowButton')
			.assert.value('#subredditCommentDepths_commentDepthCommentDepth_0', '6')
			.assert.value('#subredditCommentDepths_commentDepthCommentDepth_2', '')
			.end();
	},
	'color options are revealed when changing the option they depend on': browser => {
		browser
			.url('https://en.reddit.com/wiki/pages#res:settings-redirect-standalone-options-page/commentQuickCollapse')
			.waitForElementVisible('#RESConsoleContainer')
			.waitForElementNotVisible('#optionContainer-commentQuickCollapse-leftEdgeColor')
			.click('#toggleCommentsOnClickLeftEdgeContainer')
			.assert.visible('#optionContainer-commentQuickCollapse-leftEdgeColor')
			.end();
	},
};
