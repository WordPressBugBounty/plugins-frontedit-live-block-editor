/**
 * Unsaved changes guard for frontend editing.
 *
 * Reads (via globals):
 *   SFE.Context            - .activeEditor, .isSaving
 *   SFE.BlockSerializer    - .buildBlockPayload
 *   SFE.BlockComparison    - .blocksAreEquivalent
 *   SFE.BatchEditManager   - .dirtyBlocks
 *
 * Exposes: SFE.UnsavedChanges
 *   { getState, hasUnsavedChanges, suppressNextBeforeUnload }
 *
 * Also binds browser navigation guards for:
 *   - tab close / reload / hard navigation via beforeunload
 *   - same-window anchor navigation via capture-phase click interception
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const NAVIGATION_WARNING_MESSAGE = 'You have unsaved changes. Leave this page?';
	let suppressBeforeUnloadUntil = 0;

	/**
	 * Return the active editor state when one is currently open.
	 *
	 * @returns {Object|null} Active editor state or null.
	 */
	function getActiveEditor() {
		return SFE.Context?.activeEditor || null;
	}

	/**
	 * Return whether the shared batch dirty map currently contains any entries.
	 *
	 * @returns {boolean} Whether tracked dirty blocks exist.
	 */
	function hasTrackedDirtyBlocks() {
		const batchManager = SFE.BatchEditManager || null;
		return !!(
			batchManager &&
			batchManager.dirtyBlocks instanceof Map &&
			batchManager.dirtyBlocks.size > 0
		);
	}

	/**
	 * Return the current number of tracked dirty blocks.
	 *
	 * @returns {number} Dirty block count.
	 */
	function getTrackedDirtyBlockCount() {
		const batchManager = SFE.BatchEditManager || null;
		if (!batchManager || !(batchManager.dirtyBlocks instanceof Map)) {
			return 0;
		}

		return batchManager.dirtyBlocks.size;
	}

	/**
	 * Resolve the serialized baseline for the active editor session.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {string} Baseline serialized block markup or an empty string.
	 */
	function getEditorBaselineRaw(editorState) {
		if (!editorState || !editorState.blockState) {
			return '';
		}

		return typeof editorState.blockState.rawContent === 'string'
			? editorState.blockState.rawContent
			: '';
	}

	/**
	 * Serialize the current active editor DOM back into canonical raw block markup.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {{rawContent: string, didSerialize: boolean, hadError: boolean}} Serialization result.
	 */
	function getCurrentEditorRaw(editorState) {
		const serializer = SFE.BlockSerializer || null;
		if (
			!editorState ||
			!editorState.element ||
			!serializer ||
			typeof serializer.buildBlockPayload !== 'function'
		) {
			return { rawContent: '', didSerialize: false, hadError: false };
		}

		try {
			const payload = serializer.buildBlockPayload(editorState.element, editorState);
			if (!payload || typeof payload.rawContent !== 'string') {
				return { rawContent: '', didSerialize: false, hadError: false };
			}

			return {
				rawContent: payload.rawContent,
				didSerialize: true,
				hadError: false,
			};
		} catch (error) {
			return { rawContent: '', didSerialize: false, hadError: true };
		}
	}

	/**
	 * Return whether the active editor currently differs from its serialized baseline.
	 *
	 * In pro this complements the batch dirty map by catching unsaved changes in the
	 * still-open editor before the debounced capture has committed them. In free it
	 * becomes the sole signal because changes only exist while the editor is open.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {boolean} Whether the active editor has unsaved changes.
	 */
	function isActiveEditorDirty(editorState) {
		if (!editorState) {
			return false;
		}

		const batchManager = SFE.BatchEditManager || null;
		if (
			editorState.uuid &&
			batchManager &&
			batchManager.dirtyBlocks instanceof Map &&
			batchManager.dirtyBlocks.has(editorState.uuid)
		) {
			return true;
		}

		const baselineRaw = getEditorBaselineRaw(editorState);
		if (!baselineRaw) {
			return false;
		}

		const currentState = getCurrentEditorRaw(editorState);
		if (currentState.hadError) {
			// If the current editor cannot be serialized, we cannot prove it is clean.
			// Warning here is safer than silently dropping invalid unsaved edits.
			return true;
		}
		if (!currentState.didSerialize || !currentState.rawContent) {
			return false;
		}

		const comparison = SFE.BlockComparison || null;
		if (comparison && typeof comparison.blocksAreEquivalent === 'function') {
			return !comparison.blocksAreEquivalent(baselineRaw, currentState.rawContent);
		}

		return baselineRaw !== currentState.rawContent;
	}

	/**
	 * Return a normalized unsaved-changes snapshot for the current page state.
	 *
	 * @returns {{
	 *   hasUnsavedChanges: boolean,
	 *   activeEditorDirty: boolean,
	 *   hasTrackedDirtyBlocks: boolean,
	 *   dirtyBlockCount: number,
	 *   activeEditorUuid: string
	 * }} Current unsaved-changes state.
	 */
	function getState() {
		const activeEditor = getActiveEditor();
		const activeEditorDirty = isActiveEditorDirty(activeEditor);
		const trackedDirtyBlocks = hasTrackedDirtyBlocks();

		return {
			hasUnsavedChanges: activeEditorDirty || trackedDirtyBlocks,
			activeEditorDirty,
			hasTrackedDirtyBlocks: trackedDirtyBlocks,
			dirtyBlockCount: getTrackedDirtyBlockCount(),
			activeEditorUuid: String(activeEditor?.uuid || '').trim(),
		};
	}

	/**
	 * Return whether the page currently has unsaved frontend-editor changes.
	 *
	 * @returns {boolean} Whether navigation should warn.
	 */
	function hasUnsavedChanges() {
		return getState().hasUnsavedChanges;
	}

	/**
	 * Return whether one anchor belongs to the currently open editor surface.
	 *
	 * Mixed schema editors can expose anchor-backed file components, text link
	 * components, or linked media wrappers inside the same active block. Those
	 * clicks must stay local so the editor can switch components or open its own
	 * link UI before the global unsaved-changes guard treats the anchor as page
	 * navigation.
	 *
	 * @param {Object|null}             activeEditor Active editor state.
	 * @param {HTMLAnchorElement|null}  anchor       Candidate clicked link.
	 * @returns {boolean} Whether the anchor belongs to the active editor surface.
	 */
	function isAnchorWithinActiveEditorSurface(activeEditor, anchor) {
		if (!activeEditor || !(anchor instanceof HTMLAnchorElement)) {
			return false;
		}

		const rootElement = activeEditor.element instanceof Element
			? activeEditor.element
			: null;
		if (!rootElement || !rootElement.contains(anchor)) {
			return false;
		}

		const editableComponents = Array.isArray(activeEditor.editableComponents)
			? activeEditor.editableComponents
			: [];
		if (!editableComponents.length) {
			return true;
		}

		for (const component of editableComponents) {
			const componentElement = component?.element instanceof Element
				? component.element
				: null;
			if (!componentElement) {
				continue;
			}

			if (componentElement === anchor || componentElement.contains(anchor)) {
				return true;
			}

			const componentType = typeof component?.type === 'string'
				? component.type.trim().toLowerCase()
				: '';
			if (componentType === 'file' && anchor.contains(componentElement)) {
				return true;
			}
		}

		return true;
	}

	/**
	 * Return whether a clicked anchor belongs to the active editor's own link-edit flow.
	 *
	 * The unsaved-changes guard runs in capture phase at the document level, which
	 * means it fires before MWPEditor's link click handler on the editable surface.
	 * When the active editor is intentionally consuming the click to open link UI,
	 * this helper prevents the guard from misclassifying that click as real page
	 * navigation.
	 *
	 * @param {MouseEvent}                event  Capture-phase click event.
	 * @param {HTMLAnchorElement|null}    anchor Candidate clicked link.
	 * @returns {boolean} Whether the active editor will handle this click locally.
	 */
	function isActiveEditorManagedAnchorClick(event, anchor) {
		if (!(anchor instanceof HTMLAnchorElement) || !(event?.target instanceof Element)) {
			return false;
		}

		const activeEditor = getActiveEditor();
		if (!activeEditor) {
			return false;
		}
		if (isAnchorWithinActiveEditorSurface(activeEditor, anchor)) {
			return true;
		}

		const editorElement = activeEditor.activeEditableComponent?.element || activeEditor.element || null;
		const editorHost = SFE.SchemaEditorHost?.resolveActiveEditorHost?.(activeEditor) || null;
		if (!editorElement || !editorHost) {
			return false;
		}

		const isElementLinkEditor = typeof editorHost.supportsElementLinkEditing === 'function'
			? editorHost.supportsElementLinkEditing()
			: false;
		const linkUIMode = typeof editorHost.getLinkUIMode === 'function'
			? editorHost.getLinkUIMode()
			: 'auto';
		const isAutoInlineLinkClick = (
			linkUIMode !== 'manual' &&
			!!anchor.closest('[contenteditable="true"]') &&
			editorElement.contains(anchor)
		);
		const isButtonLinkClick = isElementLinkEditor && anchor === editorElement;

		return isAutoInlineLinkClick || isButtonLinkClick;
	}

	/**
	 * Return whether a clicked anchor belongs to one FrontEdit-bound element that should
	 * absorb the click locally to activate editing instead of navigating.
	 *
	 * Once a batch session contains dirty blocks, the unsaved-changes guard starts
	 * listening for same-window navigation at document capture phase. Inactive
	 * frontend-editable blocks still rely on their own capture-phase click handler
	 * to prevent default navigation and open the editor. Because this guard runs
	 * first, it must recognize those block-activation clicks and stand down.
	 *
	 * @param {MouseEvent}             event  Capture-phase click event.
	 * @param {HTMLAnchorElement|null} anchor Candidate clicked link.
	 * @returns {boolean} Whether the click should stay inside inline editing.
	 */
	function isInactiveBoundEditorActivationAnchorClick(event, anchor) {
		if (!(anchor instanceof HTMLAnchorElement) || !(event?.target instanceof Element)) {
			return false;
		}

		const body = document.body;
		if (
			!body ||
			SFE.Context?.isInlineUIEnabled === false ||
			body.classList.contains('mwp-sfe-preview-mode') ||
			body.classList.contains('mwp-sfe-active-preview')
		) {
			return false;
		}

		if (event.target.closest('[data-mwp-sfe-control]')) {
			return false;
		}

		const boundElement = anchor.closest('[data-mwp-sfe-bound="1"]');
		if (!boundElement) {
			return false;
		}

		const activeEditorElement = getActiveEditor()?.element || null;
		if (activeEditorElement && boundElement === activeEditorElement) {
			return false;
		}

		return true;
	}

	/**
	 * Return whether one anchor click should be treated as a real page navigation.
	 *
	 * @param {HTMLAnchorElement|null} anchor Candidate clicked link.
	 * @returns {boolean} Whether the link navigates away from the current document state.
	 */
	function isNavigatingAnchor(anchor) {
		if (!(anchor instanceof HTMLAnchorElement)) {
			return false;
		}

		const href = String(anchor.getAttribute('href') || '').trim();
		if (!href || href === '#' || anchor.hasAttribute('download')) {
			return false;
		}
		if (anchor.target && anchor.target !== '_self') {
			return false;
		}
		if (/^(javascript:|mailto:|tel:)/i.test(href)) {
			return false;
		}
		if (anchor.hasAttribute('data-mwp-sfe-bypass-unsaved-warning')) {
			return false;
		}

		try {
			const currentUrl = new URL(window.location.href);
			const targetUrl = new URL(anchor.href, window.location.href);
			const isHashOnlyChange = (
				currentUrl.origin === targetUrl.origin &&
				currentUrl.pathname === targetUrl.pathname &&
				currentUrl.search === targetUrl.search &&
				currentUrl.hash !== targetUrl.hash
			);
			return !isHashOnlyChange;
		} catch (error) {
			return true;
		}
	}

	/**
	 * Suppress the next beforeunload prompt briefly after an accepted custom link confirmation.
	 *
	 * This prevents the same user action from showing both the custom link confirm
	 * and the browser's native beforeunload dialog.
	 *
	 * @returns {void}
	 */
	function suppressNextBeforeUnload() {
		suppressBeforeUnloadUntil = Date.now() + 1000;
	}

	/**
	 * Return whether beforeunload is currently being intentionally suppressed.
	 *
	 * @returns {boolean} Whether the native unload prompt should be skipped.
	 */
	function isBeforeUnloadSuppressed() {
		if (!suppressBeforeUnloadUntil) {
			return false;
		}
		if (Date.now() > suppressBeforeUnloadUntil) {
			suppressBeforeUnloadUntil = 0;
			return false;
		}

		return true;
	}

	/**
	 * Show the browser's native unsaved-changes warning for unload-like navigation.
	 *
	 * @param {BeforeUnloadEvent} event Browser unload event.
	 * @returns {string|undefined} Native beforeunload return value.
	 */
	function handleBeforeUnload(event) {
		if (isBeforeUnloadSuppressed()) {
			return undefined;
		}
		if (!hasUnsavedChanges()) {
			return undefined;
		}

		event.preventDefault();
		event.returnValue = NAVIGATION_WARNING_MESSAGE;
		return NAVIGATION_WARNING_MESSAGE;
	}

	/**
	 * Intercept same-window link clicks so we can warn before the browser navigates.
	 *
	 * @param {MouseEvent} event Capture-phase click event.
	 * @returns {void}
	 */
	function handleDocumentClick(event) {
		if (event.defaultPrevented || event.button !== 0) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		if (!hasUnsavedChanges()) {
			return;
		}

		const anchor = event.target instanceof Element
			? event.target.closest('a[href]')
			: null;
		if (isActiveEditorManagedAnchorClick(event, anchor)) {
			return;
		}
		if (isInactiveBoundEditorActivationAnchorClick(event, anchor)) {
			return;
		}
		if (!isNavigatingAnchor(anchor)) {
			return;
		}

		if (window.confirm(NAVIGATION_WARNING_MESSAGE)) {
			suppressNextBeforeUnload();
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();
	}

	window.addEventListener('beforeunload', handleBeforeUnload);
	document.addEventListener('click', handleDocumentClick, true);

	SFE.UnsavedChanges = {
		getState,
		hasUnsavedChanges,
		suppressNextBeforeUnload,
	};
})();
