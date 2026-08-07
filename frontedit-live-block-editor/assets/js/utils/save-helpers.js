/**
 * Save Helpers - shared utilities for save, batch-save, and comment flows
 *
 * Reads (via globals):
 *   SFE.Context  - .pageRevisionToken (r/w)
 *
 * Exposes: SFE.SaveHelpers
 *   { setButtonLoading, clearButtonLoading, lockSaveUI, unlockSaveUI,
 *     createSuccessElement, handleRevisionConflict, updatePageRevisionToken,
 *     fetchRenderedPageDocument, fetchRenderedHTMLMap, fetchRenderedBlockData,
 *     fetchRenderedBlockHTML, syncWpElementStyles, reloadPageWithGuardBypass,
 *     reloadAfterRefreshFailure }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const PAGE_DOC_CACHE_TTL_MS = 1500;
	const PREVIEW_RENDER_ROUTE  = '/pro/draft-preview-url';

	let cachedPageDoc           = null;
	let cachedPageDocKey        = '';
	let cachedPageDocAt         = 0;
	let cachedPageDocPromise    = null;
	let cachedPageDocPendingKey = '';
	const syncedWpElementClasses = new Set();

	/**
	 * Normalize a UUID list into a unique array of trimmed strings.
	 *
	 * @param   {Array<unknown>} uuids Raw UUID values.
	 * @returns {string[]}             Unique, non-empty UUIDs.
	 */
	function normalizeRequestedUuids(uuids) {
		if (!Array.isArray(uuids)) return [];
		return [...new Set(
			uuids
				.map(uuid => typeof uuid === 'string' ? uuid.trim() : '')
				.filter(Boolean)
		)];
	}

	/**
	 * Normalize an optional draft-preview render request.
	 *
	 * @param   {object} options Fetch options passed to SaveHelpers.
	 * @returns {{postId:number, elementUuid:string, rawContent:string, handlerId:string}|null}
	 *          Normalized preview request, or null when the caller is fetching
	 *          the current published page render.
	 */
	function normalizeDraftPreviewRequest(options = {}) {
		const draftPreview = options && typeof options === 'object'
			? options.draftPreview
			: null;

		if (!draftPreview || typeof draftPreview !== 'object') {
			return null;
		}

		const postId      = Number.parseInt(draftPreview.postId, 10);
		const elementUuid = typeof draftPreview.elementUuid === 'string'
			? draftPreview.elementUuid.trim()
			: '';
		const rawContent  = typeof draftPreview.rawContent === 'string'
			? draftPreview.rawContent
			: '';
		const handlerId   = typeof draftPreview.handlerId === 'string'
			? draftPreview.handlerId.trim()
			: '';

		if (!Number.isFinite(postId) || postId <= 0 || !elementUuid || !rawContent.trim()) {
			return null;
		}

		return { postId, elementUuid, rawContent, handlerId };
	}

	/**
	 * Normalize a server-created, user-bound draft preview URL.
	 *
	 * @param {object} options Render options.
	 * @returns {string} Preview URL or an empty string.
	 */
	function normalizeDraftPreviewUrl(options = {}) {
		return typeof options?.draftPreviewUrl === 'string'
			? options.draftPreviewUrl.trim()
			: '';
	}

	/**
	 * Build the standard refresh URL for the current frontend page.
	 *
	 * @returns {URL} Refresh URL for the current page.
	 */
	function buildRefreshPageURL() {
		const url = new URL(window.location.href, window.location.origin);
		url.hash  = '';
		url.searchParams.set('mwpsfe_refresh', '1');
		return url;
	}

	/**
	 * Parse an HTML string into a DOM document.
	 *
	 * @param   {string} html Raw response HTML.
	 * @returns {Document}    Parsed HTML document.
	 * @throws  {Error}       When the response cannot be parsed.
	 */
	function parsePageDocumentFromHTML(html) {
		const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
		if (!doc || !doc.documentElement) {
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}
		return doc;
	}

	/**
	 * Extract rendered outerHTML strings for the requested UUID nodes.
	 *
	 * @param   {Document} doc            Parsed page document.
	 * @param   {string[]} requestedUuids UUIDs to extract.
	 * @returns {Object<string,string>}   UUID => rendered outerHTML.
	 */
	function extractRenderedHTMLMapFromDocument(doc, requestedUuids) {
		const requested = normalizeRequestedUuids(requestedUuids);
		if (!requested.length || !doc || typeof doc.querySelectorAll !== 'function') {
			return {};
		}

		const wanted  = new Set(requested);
		const htmlMap = {};

		for (const node of doc.querySelectorAll('[data-mwp-sfe-uuid]')) {
			const uuid = String(node.getAttribute('data-mwp-sfe-uuid') || '').trim();
			if (!uuid || !wanted.has(uuid) || htmlMap[uuid]) continue;
			if (typeof node.outerHTML === 'string' && node.outerHTML.trim()) {
				htmlMap[uuid] = node.outerHTML;
			}
		}

		return htmlMap;
	}

	/**
	 * Collect every `wp-elements-*` class on an element and its descendants.
	 *
	 * @param   {Element} element DOM subtree to inspect.
	 * @returns {string[]}        Unique generated class names.
	 */
	function collectWpElementClasses(element) {
		if (!element || typeof element.querySelectorAll !== 'function') {
			return [];
		}

		const classes = new Set();
		const nodes   = [element, ...element.querySelectorAll('[class]')];

		for (const node of nodes) {
			for (const cls of node.classList) {
				if (/^wp-elements-/.test(cls)) {
					classes.add(cls);
				}
			}
		}

		return [...classes];
	}

	/**
	 * Return true when the current page already contains CSS rules for a class.
	 *
	 * @param   {string} className CSS class to locate.
	 * @returns {boolean}         True when at least one stylesheet defines it.
	 */
	function isCssDefined(className) {
		for (const sheet of document.styleSheets) {
			try {
				for (const rule of sheet.cssRules || []) {
					if (rule.selectorText && rule.selectorText.includes('.' + className)) {
						return true;
					}
				}
			} catch (_) { /* cross-origin stylesheet */ }
		}
		return false;
	}

	/**
	 * Request a short-lived preview URL that renders the current page with one
	 * draft block substituted before the page template runs.
	 *
	 * @param   {{postId:number, elementUuid:string, rawContent:string, handlerId:string}} draftPreview
	 *          Draft preview render payload.
	 * @returns {Promise<string>} Absolute preview URL.
	 * @throws  {Error}           When the preview URL cannot be created.
	 */
	async function fetchPreviewRenderURL(draftPreview) {
		const restBase = String(SFE.ManagerData?.restUrl || '').trim();
		const nonce    = String(SFE.ManagerData?.nonce || '').trim();

		if (!restBase || !nonce) {
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		let response;
		try {
			response = await fetch(restBase + PREVIEW_RENDER_ROUTE, {
				method:      'POST',
				credentials: 'same-origin',
				cache:       'no-store',
				headers:     {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   nonce
				},
				body: JSON.stringify({
					post_id:             draftPreview.postId,
					element_uuid:        draftPreview.elementUuid,
					preview_raw_content: draftPreview.rawContent,
					handler_id:          draftPreview.handlerId || ''
				})
			});
		} catch (error) {
			console.warn('FrontEdit: Failed to request draft preview render URL', error);
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		if (!response.ok) {
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		const data = await response.json();
		const url  = typeof data?.url === 'string' ? data.url.trim() : '';

		if (!url) {
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		return url;
	}

	/**
	 * Resolve the rendered page request for either a normal published refresh or
	 * a draft preview refresh.
	 *
	 * @param   {object} options Save-helper fetch options.
	 * @returns {Promise<{url:string, cacheKey:string, cacheable:boolean}>}
	 *          Fetch metadata for the requested render.
	 */
	async function resolveRenderedPageRequest(options = {}) {
		const draftPreviewUrl = normalizeDraftPreviewUrl(options);
		if (draftPreviewUrl) {
			return { url: draftPreviewUrl, cacheKey: draftPreviewUrl, cacheable: false };
		}

		const draftPreview = normalizeDraftPreviewRequest(options);

		if (draftPreview) {
			const url = await fetchPreviewRenderURL(draftPreview);
			return { url, cacheKey: url, cacheable: false };
		}

		const baseUrl    = buildRefreshPageURL();
		const cacheKey   = baseUrl.toString();
		const requestUrl = new URL(cacheKey);
		requestUrl.searchParams.set('mwpsfe_ts', String(Date.now()));

		return {
			url:       requestUrl.toString(),
			cacheKey,
			cacheable: true
		};
	}

	/**
	 * Fetch and parse the rendered page document for the requested context.
	 *
	 * @param   {object} [options={}] Fetch options.
	 * @param   {boolean} [options.force=false] Bypass the short-lived live-page cache.
	 * @param   {{postId:number, elementUuid:string, rawContent:string, handlerId:string}} [options.draftPreview]
	 *          Optional draft preview override payload.
	 * @param   {string} [options.draftPreviewUrl] User-bound draft preview URL returned by Pro.
	 * @returns {Promise<Document>} Parsed rendered page document.
	 */
	async function fetchRenderedPageDocument(options = {}) {
		const { force = false } = options || {};
		const { url, cacheKey, cacheable } = await resolveRenderedPageRequest(options);
		const now = Date.now();

		if (
			cacheable &&
			!force &&
			cachedPageDoc &&
			cachedPageDocKey === cacheKey &&
			(now - cachedPageDocAt) < PAGE_DOC_CACHE_TTL_MS
		) {
			return cachedPageDoc;
		}

		if (cachedPageDocPromise && cachedPageDocPendingKey === cacheKey) {
			return cachedPageDocPromise;
		}

		cachedPageDocPendingKey = cacheKey;
		cachedPageDocPromise = fetch(url, {
			credentials: 'same-origin',
			cache:       'no-store'
		})
			.then(response => {
				if (!response.ok) {
					throw new Error('BLOCK_HTML_REFRESH_FAILED');
				}
				return response.text();
			})
			.then(html => parsePageDocumentFromHTML(html))
			.then(doc  => {
				if (cacheable) {
					cachedPageDoc    = doc;
					cachedPageDocKey = cacheKey;
					cachedPageDocAt  = Date.now();
				}
				return doc;
			})
			.catch(error => {
				console.warn('FrontEdit: Failed to fetch rendered page HTML', error);
				throw new Error('BLOCK_HTML_REFRESH_FAILED');
			})
			.finally(() => {
				cachedPageDocPromise = null;
				cachedPageDocPendingKey = '';
			});

		return cachedPageDocPromise;
	}

	/**
	 * Fetch rendered HTML for a set of UUIDs from the authoritative page render.
	 *
	 * @param   {string[]} uuids   Requested UUIDs.
	 * @param   {object} [options] Page fetch options.
	 * @returns {Promise<Object<string,string>>} UUID => rendered outerHTML.
	 */
	async function fetchRenderedHTMLMap(uuids, options = {}) {
		const requested = normalizeRequestedUuids(uuids);
		if (!requested.length) return {};

		const doc     = await fetchRenderedPageDocument(options);
		const htmlMap = extractRenderedHTMLMapFromDocument(doc, requested);
		const missing = requested.filter(uuid => !htmlMap[uuid]);

		if (missing.length) {
			console.warn('FrontEdit: Rendered page fetch did not contain requested UUIDs', {
				requested,
				missing
			});
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		return htmlMap;
	}

	/**
	 * Fetch a rendered block and the parsed page document it came from.
	 *
	 * @param   {string} uuid      Target block UUID.
	 * @param   {object} [options] Page fetch options.
	 * @returns {Promise<{html:string, document:Document}>}
	 *          Rendered outerHTML and parsed page document.
	 */
	async function fetchRenderedBlockData(uuid, options = {}) {
		const requestedUuid = typeof uuid === 'string' ? uuid.trim() : '';
		if (!requestedUuid) {
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		const doc     = await fetchRenderedPageDocument(options);
		const htmlMap = extractRenderedHTMLMapFromDocument(doc, [requestedUuid]);
		const html    = htmlMap[requestedUuid] || '';

		if (!html) {
			console.warn('FrontEdit: Rendered page fetch did not contain requested UUID', {
				requested: requestedUuid
			});
			throw new Error('BLOCK_HTML_REFRESH_FAILED');
		}

		return { html, document: doc };
	}

	/**
	 * Fetch the rendered outerHTML for a single UUID.
	 *
	 * @param   {string} uuid      Target block UUID.
	 * @param   {object} [options] Page fetch options.
	 * @returns {Promise<string>}  Rendered outerHTML.
	 */
	async function fetchRenderedBlockHTML(uuid, options = {}) {
		const rendered = await fetchRenderedBlockData(uuid, options);
		return rendered.html || '';
	}

	/**
	 * Sync missing `wp-elements-*` style rules for an element from a rendered page.
	 *
	 * @param   {Element} element DOM element whose generated classes should exist.
	 * @param   {object}  [options={}] Style-sync options.
	 * @param   {Document} [options.document] Pre-fetched rendered page document.
	 * @returns {Promise<void>}
	 */
	async function syncWpElementStyles(element, options = {}) {
		const allClasses = collectWpElementClasses(element);
		const missing = allClasses.filter(
			cls => !syncedWpElementClasses.has(cls) && !isCssDefined(cls)
		);

		if (!missing.length) return;

		try {
			const doc = options.document || await fetchRenderedPageDocument(options);
			let css   = '';

			for (const style of doc.querySelectorAll('style')) {
				const text = style.textContent || '';
				if (missing.some(cls => text.includes(cls))) {
					css += text + '\n';
				}
			}

			if (css) {
				const tag = document.createElement('style');
				tag.dataset.mwpSfeSyncedStyles = '1';
				tag.textContent = css;
				document.head.appendChild(tag);
				missing.forEach(cls => syncedWpElementClasses.add(cls));
			}
		} catch (error) {
			console.warn('FrontEdit: failed to sync wp-elements styles from rendered page', error);
		}
	}

	/**
	 * Puts a button into a disabled "loading" state.
	 *
	 * This will:
	 * - Store the current button text on a temporary `_mwpOriginalText` property
	 * - Disable the button to prevent further interaction
	 * - Add a `mwp-sfe-btn-loading` attribute for styling/state indication
	 *
	 * The stored text is later restored by {@link clearButtonLoading}.
	 *
	 * Safe to call with `null` or undefined (no-op).
	 *
	 * @param  {HTMLButtonElement|null} btn The button element to update.
	 * @return {void}
	 *
	 * @property {string} [_mwpOriginalText] Internal property added to the button element
	 * to preserve its original text content while in loading state.
	 */
	function setButtonLoading(btn) {
		if (!btn) return;
		btn._mwpOriginalText = btn.textContent;
		const originalText = String(btn._mwpOriginalText || '').trim();
		if (originalText === 'Save Changes') {
			btn.textContent = 'Saving...';
		} else if (originalText === 'Submit for Review') {
			btn.textContent = 'Submitting...';
		}
		btn.disabled = true;
		btn.setAttribute('mwp-sfe-btn-loading', 'true');
	}

	/**
	 * Restores a button previously set into a loading state via `setButtonLoading`.
	 *
	 * This will:
	 * - Re-enable the button
	 * - Remove the loading attribute used for styling/state tracking
	 * - Restore the original button text if it was stored
	 *
	 * Safe to call with `null` or undefined (no-op).
	 *
	 * @param  {HTMLButtonElement|null} btn The button element to restore.
	 * @return {void}
	 *
	 * @property {string} [_mwpOriginalText] Internal property added to the button element
	 * to preserve its original text content while in loading state.
	 */
	function clearButtonLoading(btn) {
		if (!btn) return;
		btn.disabled = false;
		btn.removeAttribute('mwp-sfe-btn-loading');
		if (btn._mwpOriginalText !== undefined) {
			btn.textContent = btn._mwpOriginalText;
			delete btn._mwpOriginalText;
		}
	}

	/**
	 * Locks the UI during a save operation to prevent duplicate actions
	 * and inconsistent state changes.
	 *
	 * This will:
	 * - Set the global `isSaving` flag in `SFE.Context`
	 * - Put the triggering button into a loading state
	 * - Disable all other buttons in the state dock
	 * - Trigger a refresh/update of the mode toggle UI (if present)
	 *
	 * @param  {HTMLButtonElement|null} triggerBtn The button that initiated the save action.
	 * @return {void}
	 */
	function lockSaveUI(triggerBtn) {
		const ctx = SFE.Context;
		if (ctx) {
			ctx.isSaving = true;
			// Stash the button that triggered this save so unlockSaveUI can restore it
			ctx._saveTriggerBtn = triggerBtn || null;
		}
		
		setButtonLoading(triggerBtn);

		// Lock dock buttons
		document.querySelectorAll('.mwp-sfe-state-dock .mwp-sfe-btn').forEach(btn => {
			if (btn !== triggerBtn) btn.disabled = true;
		});

		// Lock mode toggle
		if (SFE.ModeToggleBar) {
			SFE.ModeToggleBar.update();
		}

		// Hide any hover overlay that is currently showing
		const overlayMgr = SFE.OverlayManager;
		if (overlayMgr) {
			overlayMgr.hideHover();
			// Hide switchable status overlays
			if (!ctx || !ctx.activeEditor) {
				overlayMgr.hideSwitchableStatusOverlays();
			}
		}
	}

	/**
	 * Unlocks the UI after a save operation completes, restoring interactivity.
	 *
	 * This will:
	 * - Clear the global `isSaving` flag in `SFE.Context`
	 * - Restore the triggering button from its loading state
	 * - Re-enable all buttons in the state dock
	 * - Trigger a refresh/update of the mode toggle UI (if present)
	 *
	 * @param  {HTMLButtonElement|null} triggerBtn The button that initiated the save action.
	 * @return {void}
	 */
	function unlockSaveUI(triggerBtn) {
		const ctx = SFE.Context;
		if (ctx) ctx.isSaving = false;

		// Resolve which button to restore. lockSaveUI stashed the real trigger so that
		// showInlineSuccess (which only knows about the inline editor's save button) can
		// still clear the dock or approve button's loading state correctly.
		const effectiveBtn = (ctx && ctx._saveTriggerBtn) ? ctx._saveTriggerBtn : triggerBtn;
		if (ctx && ctx._saveTriggerBtn) delete ctx._saveTriggerBtn;

		clearButtonLoading(effectiveBtn);

		// Unlock dock buttons and strip any residual loading attribute so the dock
		document.querySelectorAll('.mwp-sfe-state-dock .mwp-sfe-btn').forEach(btn => {
			btn.disabled = false;
			btn.removeAttribute('mwp-sfe-btn-loading');
		});

		// Unlock mode toggle
		if (SFE.ModeToggleBar) {
			SFE.ModeToggleBar.update();
		}

		// Restore status overlays that were hidden during the save lock.
		const overlayMgr = SFE.OverlayManager;
		if (overlayMgr) {
			overlayMgr.showAllStatusOverlays();
		}
	}

	/**
	 * Build the standard centered overlay element.
	 *
	 * @param  {string} message              Text shown inside the banner.
	 * @param  {string} [variant='success']  'success' (green), 'comment' (blue), 'warning' (orange), or 'discard' (red).
	 * @return {HTMLDivElement}
	 */
	function createSuccessElement(message, variant) {
		variant = variant || 'success';
		const isComment = variant === 'comment';
		const isDiscard = variant === 'discard';
		const isWarning = variant === 'warning';

		const iconSvg = isDiscard
			? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="15" y1="9" x2="9" y2="15"></line>
					<line x1="9" y1="9" x2="15" y2="15"></line>
				</svg>`
			: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
					<polyline points="22 4 12 14 8 10"></polyline>
				</svg>`;

		const el       = document.createElement('div');
		let className  = 'mwp-sfe-inline-success';
		if (isComment) {
			className += ' mwp-sfe-inline-comment';
		} else if (isWarning) {
			className += ' mwp-sfe-inline-warning';
		} else if (isDiscard) {
			className += ' mwp-sfe-inline-discard';
		}
		el.className = className;
		el.setAttribute('data-mwp-sfe-control', 'true');
		el.innerHTML   = `
			<div class="mwp-sfe-inline-success-message">
				${iconSvg}
				<span>${message}</span>
			</div>
		`;
		el.style.cssText = `
			position: fixed !important;
			top: 25% !important;
			left: 50% !important;
			transform: translate(-50%, -50%) !important;
			width: min(600px, 95vw) !important;
			z-index: 999999 !important;
			margin: 0 !important;
			display: flex;
			justify-content: center;
			transition: none !important;
		`;
		return el;
	}

	/**
	 * Reload the current page after suppressing one native beforeunload prompt.
	 *
	 * Frontend save flows sometimes need an authoritative full refresh after the
	 * server has already accepted a change. In those cases the page may still have
	 * an active editor session or dirty-state bookkeeping that would otherwise
	 * trigger the shared unsaved-changes guard during the intentional reload.
	 *
	 * @returns {void}
	 */
	function reloadPageWithGuardBypass() {
		if (
			SFE.UnsavedChanges &&
			typeof SFE.UnsavedChanges.suppressNextBeforeUnload === 'function'
		) {
			SFE.UnsavedChanges.suppressNextBeforeUnload();
		}

		const refreshUrl = buildRefreshPageURL();
		refreshUrl.searchParams.set('mwpsfe_ts', String(Date.now()));
		window.location.assign(refreshUrl.toString());
	}

	/**
	 * Handle a REVISION_CONFLICT error from the server.
	 *
	 * Shows a confirmation dialog.  If the user cancels, calls onRestoreBtn
	 * (if provided) and reloads the page.  If the user confirms, returns true
	 * so the caller can proceed with a forced retry (no token).
	 *
	 * Usage:
	 *   const shouldRetry = await handleRevisionConflict(restoreBtn);
	 *   if (!shouldRetry) return;
	 *   // ... perform retry without the revision token ...
	 *
	 * @param  {Function|null} onRestoreBtn  Called when user cancels (before reload).
	 * @return {Promise<boolean>}  true → caller should retry; false → reloading.
	 */
	async function handleRevisionConflict(onRestoreBtn) {
		const saveAnyway = confirm(
			'This page was updated by another user since you started editing. ' +
			'Saving now may overwrite their recent changes.\n\n' +
			'Press OK to save anyway, or Cancel to refresh the page.'
		);
		if (!saveAnyway) {
			if (onRestoreBtn) onRestoreBtn();
			reloadPageWithGuardBypass();
			return false;
		}
		return true;
	}

	/**
	 * Update the page revision token stored in the shared context when the
	 * server returns a new one.  Safe to call when result is null/undefined.
	 *
	 * @param  {Object|null} result  API response object.
	 * @return {void}
	 */
	function updatePageRevisionToken(result) {
		if (result && result.page_revision_token) {
			SFE.Context.pageRevisionToken = result.page_revision_token;
		}
	}

	/**
	 * When the save itself succeeded but the server could not return the
	 * context-accurate replacement HTML, reload the page so the user lands on
	 * the authoritative frontend render instead of a mismatched DOM snapshot.
	 *
	 * @param {string} logMessage
	 * @return {void}
	 */
	function reloadAfterRefreshFailure(logMessage) {
		if (logMessage) {
			console.error(logMessage);
		}
		reloadPageWithGuardBypass();
	}

	SFE.SaveHelpers = {
		setButtonLoading,
		clearButtonLoading,
		lockSaveUI,
		unlockSaveUI,
		createSuccessElement,
		handleRevisionConflict,
		updatePageRevisionToken,
		fetchRenderedPageDocument,
		fetchRenderedHTMLMap,
		fetchRenderedBlockData,
		fetchRenderedBlockHTML,
		syncWpElementStyles,
		reloadPageWithGuardBypass,
		reloadAfterRefreshFailure
	};

})();
