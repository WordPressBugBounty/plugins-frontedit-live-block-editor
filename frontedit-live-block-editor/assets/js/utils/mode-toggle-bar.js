/**
 * Mode toggle bar - Edit/Preview mode switcher UI panel.
 *
 * Reads (via globals):
 *   SFE.Context                - .isInlineUIEnabled (r/w), .activeEditor,
 *                                .activeMode, .actionBar
 *   SFE.OverlayManager
 *   SFE.closeAnyActiveMode     - set by frontend-inline-edit.js
 *   SFE.hoverTracker           - set by frontend-inline-edit.js
 *   SFE.ManagerData            - .permissions
 *   SFE.FloatingUiMoveManager  - shared movement utility for floating UI
 *   SFE.ActionBarDock          - shared batch-session dock positioning API
 *
 * Exposes: SFE.ModeToggleBar  { init, update, setInlineUIEnabled }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const DRAG_OWNER_NAME    = 'mode-toggle-bar';
	const DEFAULT_TOP        = 42;
	const DEFAULT_RIGHT      = 10;
	const POSITION_STORAGE_KEY = 'mwpSfeModeToggleBarPosition';

	let dragController = null;
	let barPosition    = null;

	/**
	 * Resolve the live mode toggle bar element.
	 *
	 * @returns {HTMLElement|null} Toggle bar element when mounted.
	 */
	function getBar() {
		return document.querySelector('.mwp-sfe-mode-toggle-bar');
	}

	/**
	 * Derive the current viewport size in CSS pixels.
	 *
	 * @returns {{ width:number, height:number }} Viewport size.
	 */
	function getViewportSize() {
		return {
			width:  document.documentElement.clientWidth || window.innerWidth || 0,
			height: document.documentElement.clientHeight || window.innerHeight || 0,
		};
	}

	/**
	 * Read the tab-scoped saved position for the mode toggle bar.
	 *
	 * sessionStorage survives same-tab refreshes and same-origin page navigations,
	 * but it is cleared automatically when the tab/window closes, which matches
	 * the intended persistence lifetime for this control.
	 *
	 * @returns {{ left:number, top:number }|null} Saved position when valid.
	 */
	function readStoredBarPosition() {
		const rawValue = window.sessionStorage.getItem(POSITION_STORAGE_KEY);
		if (!rawValue) return null;

		const parsed = JSON.parse(rawValue);
		if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
			window.sessionStorage.removeItem(POSITION_STORAGE_KEY);
			return null;
		}

		return {
			left: parsed.left,
			top:  parsed.top,
		};
	}

	/**
	 * Persist the current mode toggle bar position for the active browser tab.
	 *
	 * @param {{ left:number, top:number }} position Bar position to persist.
	 * @returns {void}
	 */
	function writeStoredBarPosition(position) {
		window.sessionStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
			left: position.left,
			top:  position.top,
		}));
	}

	/**
	 * Compute the in-memory left/top position for the floating bar.
	 *
	 * On first init the bar still uses CSS top/right defaults, so the DOM rect is
	 * the source of truth until we convert the bar to explicit left/top inline
	 * positioning for the current page session.
	 *
	 * @param   {HTMLElement} bar Toggle bar element.
	 * @returns {{ left:number, top:number }} Current bar position.
	 */
	function getCurrentBarPosition(bar) {
		if (barPosition && Number.isFinite(barPosition.left) && Number.isFinite(barPosition.top)) {
			return {
				left: barPosition.left,
				top:  barPosition.top,
			};
		}

		const rect = bar.getBoundingClientRect();
		return {
			left: rect.left,
			top:  rect.top,
		};
	}

	/**
	 * Compute the original default position from the bar's top/right offsets.
	 *
	 * This preserves the intended default of "42px from the top and 10px from
	 * the right edge" instead of seeding the first session position from an
	 * already-shifted DOM rect.
	 *
	 * @param   {HTMLElement} bar Toggle bar element.
	 * @returns {{ left:number, top:number }} Default left/top position.
	 */
	function getDefaultBarPosition(bar) {
		const viewport = getViewportSize();
		const rect     = bar.getBoundingClientRect();

		return {
			left: Math.max(0, viewport.width - rect.width - DEFAULT_RIGHT),
			top:  DEFAULT_TOP,
		};
	}

	/**
	 * Resolve the target element's viewport box from either explicit session
	 * position or the live DOM rect.
	 *
	 * This keeps detached grip positioning stable during initial bar animations by
	 * preferring the known logical position when it exists.
	 *
	 * @param   {HTMLElement} bar Toggle bar element.
	 * @returns {{ left:number, top:number, width:number, height:number }} Viewport box.
	 */
	function getBarViewportBox(bar) {
		const rect = bar.getBoundingClientRect();

		if (barPosition && Number.isFinite(barPosition.left) && Number.isFinite(barPosition.top)) {
			return {
				left:   barPosition.left,
				top:    barPosition.top,
				width:  rect.width,
				height: rect.height,
			};
		}

		return {
			left:   rect.left,
			top:    rect.top,
			width:  rect.width,
			height: rect.height,
		 };
	}

	/**
	 * Apply the current session's explicit left/top position to the toggle bar.
	 *
	 * @param {HTMLElement}               bar      Toggle bar element.
	 * @param {{ left:number, top:number }} position New left/top position.
	 * @param {Object}                    [meta]   Rendering metadata.
	 * @returns {void}
	 */
	function applyBarPosition(bar, position, meta = {}) {
		const nextPosition = {
			left: Math.round(position.left),
			top:  Math.round(position.top),
		};

		barPosition      = nextPosition;
		bar.style.left   = nextPosition.left + 'px';
		bar.style.top    = nextPosition.top + 'px';
		bar.style.right  = 'auto';
		bar.style.bottom = 'auto';

		if (meta.persist !== false) {
			writeStoredBarPosition(nextPosition);
		}

		if (dragController) {
			dragController.syncGripPosition();
			dragController.syncGripVisibility();
		}

		if (meta.refreshDock === false) return;
		SFE.ActionBarDock?.refreshPosition?.();
	}

	/**
	 * Resolve whether the detached grip should currently be visible for the mode
	 * toggle bar. The FloatingUiMoveManager owns the grip element; the toggle bar owns the
	 * bar-specific hover policy, including suppressing the grip while its buttons
	 * are hovered and keeping the grip visible during active drags.
	 *
	 * @param   {HTMLElement}      bar  Toggle bar element.
	 * @param   {HTMLElement|null} grip Shared detached grip element.
	 * @returns {boolean}               True when the grip should be visible.
	 */
	function shouldShowGrip(bar, grip) {
		const buttons  = bar.querySelector('.mwp-sfe-mode-toggle-buttons');
		return bar.classList.contains('mwp-sfe-is-dragging') ||
			grip.matches(':hover') ||
			(bar.matches(':hover') && !(buttons && buttons.matches(':hover')));
	}

	/**
	 * Restore or seed the toggle bar's explicit left/top position for this tab,
	 * then clamp it to the current viewport.
	 *
	 * @param {HTMLElement} bar Toggle bar element.
	 * @returns {void}
	 */
	function initializeFloatingPosition(bar) {
		if (!barPosition) {
			barPosition = readStoredBarPosition() || getDefaultBarPosition(bar);
			applyBarPosition(bar, barPosition, {
				source: 'init',
			});
		}

		if (dragController) {
			dragController.syncToBounds({ source: 'init' });
		}
	}

	/**
	 * Create the reusable floating-UI movement controller for the toggle bar.
	 *
	 * The bar position is tab-scoped by design: it lives in runtime state plus
	 * sessionStorage, so refreshes and same-tab page navigations reuse the last
	 * placement while closing the tab/window clears it automatically.
	 *
	 * @param {HTMLElement} bar Toggle bar element.
	 * @returns {void}
	 */
	function ensureDragBehavior(bar) {
		if (dragController || !SFE.FloatingUiMoveManager?.createDetachedGripMover) return;

		dragController = SFE.FloatingUiMoveManager.createDetachedGripMover({
			element: bar,
			owner:   DRAG_OWNER_NAME,
			getPosition() {
				return getCurrentBarPosition(bar);
			},
			getGripAnchorBox() {
				return getBarViewportBox(bar);
			},
			getBounds(args) {
				return SFE.FloatingUiMoveManager.buildDetachedGripBounds(args);
			},
			visibilityTargets() {
				return [
					bar,
					bar.querySelector('.mwp-sfe-mode-toggle-buttons'),
				].filter(Boolean);
			},
			shouldShowGrip({ grip }) {
				return shouldShowGrip(bar, grip);
			},
			gripOptions: {
				ariaLabel: 'Move mode toggle bar',
			},
			applyPosition(position, meta) {
				applyBarPosition(bar, position, meta);
			},
			onDragEnd() {
				requestAnimationFrame(function() {
					if (dragController) {
						dragController.syncGripVisibility();
					}
				});
			},
		});
	}

	/**
	 * Ensure all one-time interactive behavior is attached to the toggle bar.
	 *
	 * @param {HTMLElement} bar Toggle bar element.
	 * @returns {void}
	 */
	function ensureInteractiveBehavior(bar) {
		ensureDragBehavior(bar);
		initializeFloatingPosition(bar);
		dragController.activateGrip();
		dragController.syncGripPosition();
		dragController.syncGripVisibility();
	}

	/**
	 * Resolve the current inline entry button label from permissions.
	 *
	 * @returns {string} Entry label text.
	 */
	function getInlineEntryLabel() {
		const perms = SFE.ManagerData.permissions || {};
		return (perms.can_publish || perms.can_draft) ? 'Edit' : 'Comment';
	}

	/**
	 * Normalize a DOM node for selection containment checks.
	 *
	 * @param   {Node|null} node Candidate node.
	 * @returns {Node|null}      Containment-safe node.
	 */
	function getNodeForContainment(node) {
		if (!node) return null;
		return node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
	}

	/**
	 * Resolve the editor focus target for preview selection restoration.
	 *
	 * @param   {Object|null} editorState Active editor state.
	 * @returns {HTMLElement|null}        Focus target element.
	 */
	function getEditorFocusTarget(editorState) {
		if (!editorState) return null;
		const activeComponentEl = editorState.activeEditableComponent?.element || null;
		if (activeComponentEl) return activeComponentEl;
		return editorState.element || null;
	}

	/**
	 * Resolve the editor element used to anchor floating chrome.
	 *
	 * @param   {Object|null} editorState Active editor state.
	 * @returns {HTMLElement|null}        Chrome anchor element.
	 */
	function getEditorChromeAnchor(editorState) {
		if (!editorState) return null;
		return editorState.element || null;
	}

	/**
	 * Resolve the active overlay mode for an editor session.
	 *
	 * Draft editing clears ctx.activeMode after handing off from draft preview,
	 * so the live editor session must consult the shared draftEditState contract
	 * to preserve the orange draft-editing outline when returning from preview.
	 *
	 * @param   {Object|null} editorState Active editor state from SFE.Context.
	 * @param   {Object|null} ctx         Shared FrontEdit context object.
	 * @returns {string}                  Overlay mode for the active editor.
	 */
	function getEditorOverlayMode(editorState, ctx) {
		if (!editorState || !ctx) return 'editing';

		const draftEditState = ctx.draftEditState;
		const isDraftEditor  = !!(
			draftEditState &&
			draftEditState.draftElement &&
			draftEditState.draftElement === editorState.element
		);

		return isDraftEditor ? 'draft-editing' : 'editing';
	}

	/**
	 * Check whether the current selection range lives inside the target element.
	 *
	 * @param   {Selection|null}  selection Browser selection object.
	 * @param   {HTMLElement|null} element   Candidate container element.
	 * @returns {boolean}                   True when the selection is inside the element.
	 */
	function isSelectionWithinElement(selection, element) {
		if (!selection || !element || selection.rangeCount < 1) return false;
		const range      = selection.getRangeAt(0);
		const anchorNode = getNodeForContainment(range.commonAncestorContainer);
		return !!(anchorNode && (anchorNode === element || element.contains(anchorNode)));
	}

	/**
	 * Snapshot the live selection before entering preview mode.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {void}
	 */
	function savePreviewSelection(editorState) {
		if (!editorState) return;

		editorState._previewSavedComponentId = editorState.activeComponentId || null;
		const focusTarget = getEditorFocusTarget(editorState);

		try {
			const selection = window.getSelection();
			if (selection && selection.rangeCount > 0 && isSelectionWithinElement(selection, focusTarget)) {
				editorState._previewSavedRange = selection.getRangeAt(0).cloneRange();
			}
		} catch (_) {
			// Ignore cross-browser selection edge cases.
		}
	}

	/**
	 * Restore the saved selection after leaving preview mode.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {void}
	 */
	function restorePreviewSelection(editorState) {
		if (!editorState) return;

		const savedRange = editorState._previewSavedRange;
		delete editorState._previewSavedRange;

		const savedComponentId = editorState._previewSavedComponentId;
		delete editorState._previewSavedComponentId;

		let focusTarget = null;
		if (savedComponentId && Array.isArray(editorState.editableComponents)) {
			focusTarget = editorState.editableComponents.find(component => component?.id === savedComponentId)?.element || null;
		}
		if (!focusTarget) {
			focusTarget = getEditorFocusTarget(editorState);
		}
		if (!focusTarget) return;

		try {
			focusTarget.focus({ preventScroll: true });
			const selection = window.getSelection();
			if (!selection) return;

			if (savedRange) {
				selection.removeAllRanges();
				selection.addRange(savedRange);
				return;
			}

			const fallbackRange = document.createRange();
			fallbackRange.selectNodeContents(focusTarget);
			fallbackRange.collapse(false);
			selection.removeAllRanges();
			selection.addRange(fallbackRange);
		} catch (_) {
			// Ignore selection restore failures and leave focus state as-is.
		}
	}

	/**
	 * Reposition active editor chrome after returning from preview mode.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {void}
	 */
	function repositionActiveEditorUI(editorState) {
		if (!editorState) return;

		const positionMgr = SFE.PositionManager || {};
		const positionNow = positionMgr.positionFloatingElements;
		const schedule    = positionMgr.schedulePosition || positionMgr.debouncedPosition;

		if (typeof positionNow !== 'function') return;

		const targetElement = getEditorChromeAnchor(editorState) || getEditorFocusTarget(editorState) || null;
		const toolbar       = editorState.toolbarContainer || null;
		const actions       = editorState.actionsContainer || null;
		if (!targetElement || (!toolbar && !actions)) return;

		// Snap immediately when returning from preview.
		positionNow(targetElement, toolbar, actions, true);

		// Run one frame later for layout changes that settle right after mode switch.
		requestAnimationFrame(() => {
			if (SFE.Context?.activeEditor !== editorState) return;
			if (typeof schedule === 'function') {
				schedule(targetElement, toolbar, actions, true);
			} else {
				positionNow(targetElement, toolbar, actions, true);
			}
		});

		// Final one-shot settle pass for CSS transitions (e.g. accordion opening).
		setTimeout(() => {
			if (SFE.Context?.activeEditor !== editorState) return;
			positionNow(targetElement, toolbar, actions, true);
		}, 180);
	}

	// Mode Toggle Bar UI
	// A panel with a state header and two buttons:
	//   - The ACTIVE mode button -> secondary + disabled
	//   - The INACTIVE mode button -> primary (call to action)

	/**
	 * Refresh the mode toggle bar labels and button state.
	 *
	 * @returns {void}
	 */
	function update() {
		const ctx = SFE.Context;
		const bar = getBar();
		if (!bar) return;

		const isPreview  = !ctx.isInlineUIEnabled || document.body.classList.contains('mwp-sfe-active-preview');
		const isSaving   = !!ctx.isSaving;
		const entryLabel = getInlineEntryLabel();

		const header        = bar.querySelector('.mwp-sfe-mode-toggle-header');
		const perms         = SFE.ManagerData.permissions || {};
		const canEdit       = (perms.can_publish || perms.can_draft);
		const modeLabelText = canEdit ? 'Edit Mode' : 'Comment Mode';

		if (header) {
			header.textContent = isPreview
				? `Back to ${modeLabelText}`
				: 'Enter Preview Mode';
		}

		const editBtn    = bar.querySelector('.mwp-sfe-mode-toggle-edit-btn');
		const previewBtn = bar.querySelector('.mwp-sfe-mode-toggle-preview-btn');
		if (!editBtn || !previewBtn) return;

		if (isPreview) {
			editBtn.className    = 'mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-mode-toggle-edit-btn';
			previewBtn.className = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-mode-toggle-preview-btn';
		} else {
			editBtn.className    = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-mode-toggle-edit-btn';
			previewBtn.className = 'mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-mode-toggle-preview-btn';
		}

		if (isSaving) {
			editBtn.disabled    = true;
			previewBtn.disabled = true;
		} else {
			editBtn.disabled    = !isPreview;
			previewBtn.disabled = isPreview;
		}

		editBtn.textContent    = entryLabel;
		previewBtn.textContent = 'Preview';
		editBtn.setAttribute('aria-pressed', String(!isPreview));
		previewBtn.setAttribute('aria-pressed', String(isPreview));
	}

	/**
	 * Create the mode toggle bar if needed and attach its behavior.
	 *
	 * @returns {void}
	 */
	function init() {
		const ctx = SFE.Context;
		let bar = getBar();
		if (!bar) {
			bar = document.createElement('div');
			bar.className = 'mwp-sfe-mode-toggle-bar';
			bar.setAttribute('data-mwp-sfe-control', 'true');
			bar.setAttribute('role', 'group');
			bar.setAttribute('aria-label', 'Page editing mode');

			const header     = document.createElement('div');
			header.className = 'mwp-sfe-mode-toggle-header';
			bar.appendChild(header);

			const buttons     = document.createElement('div');
			buttons.className = 'mwp-sfe-mode-toggle-buttons';

			const editBtn     = document.createElement('button');
			editBtn.type      = 'button';
			editBtn.className = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-mode-toggle-edit-btn';
			editBtn.addEventListener('click', function(event) {
				event.preventDefault();
				event.stopPropagation();
				if (SFE.Context.isSaving) return;
				if (!ctx.isInlineUIEnabled) setInlineUIEnabled(true);
			});

			const previewBtn     = document.createElement('button');
			previewBtn.type      = 'button';
			previewBtn.className = 'mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-mode-toggle-preview-btn';
			previewBtn.addEventListener('mousedown', function() {
				if (SFE.Context.isSaving) return;
				if (!ctx.isInlineUIEnabled) return;
				savePreviewSelection(ctx.activeEditor);
			});
			previewBtn.addEventListener('click', function(event) {
				event.preventDefault();
				event.stopPropagation();
				if (SFE.Context.isSaving) return;
				if (ctx.isInlineUIEnabled) setInlineUIEnabled(false);
			});

			buttons.appendChild(editBtn);
			buttons.appendChild(previewBtn);
			bar.appendChild(buttons);
			document.body.appendChild(bar);
		}

		update();
		ensureInteractiveBehavior(bar);
	}

	/**
	 * Enable or disable inline UI mode while preserving active editor sessions.
	 *
	 * @param {boolean} enabled Target inline UI state.
	 * @returns {void}
	 */
	function setInlineUIEnabled(enabled) {
		const ctx          = SFE.Context;
		const overlayMgr   = SFE.OverlayManager;
		const shouldEnable = !!enabled;

		if (ctx.isInlineUIEnabled === shouldEnable) return;

		ctx.isInlineUIEnabled = shouldEnable;
		document.body.classList.remove('mwp-sfe-preview-mode');
		document.body.classList.remove('mwp-sfe-active-preview');

		const activeEditor = ctx.activeEditor;
		const activeMode   = ctx.activeMode;

		if (!shouldEnable) {
			if (activeEditor || activeMode) {
				document.body.classList.add('mwp-sfe-active-preview');

				if (overlayMgr) overlayMgr.hideActive();

				if (activeEditor) {
					savePreviewSelection(activeEditor);
					const active = document.activeElement;
					const root   = activeEditor.element;
					if (active && root && (active === root || root.contains(active))) {
						active.blur();
					}
				}
			} else {
				document.body.classList.add('mwp-sfe-preview-mode');
				SFE.closeAnyActiveMode();

				if (overlayMgr) {
					overlayMgr.hideHover();
					overlayMgr.hideActive();
				}

				const ht = SFE.hoverTracker;
				if (ht) {
					ht.lastHoveredElements = [];
					ht.currentGroupId      = null;
					ht.bottommostElement   = null;
					ht.isProcessing        = false;
				}
			}
		} else {
			if (activeEditor || activeMode) {
				if (activeEditor && overlayMgr) {
					const overlayTarget = getEditorFocusTarget(activeEditor) || activeEditor.element;
					overlayMgr.showActive(overlayTarget, getEditorOverlayMode(activeEditor, ctx));
				}
				if (!activeEditor && activeMode === 'comment' && overlayMgr) {
					const commentEl = document.querySelector('.mwp-sfe-commenting-active');
					if (commentEl) overlayMgr.showActive(commentEl, 'commenting');
				}
				if (!activeEditor && activeMode === 'draft' && overlayMgr) {
					const draftEl = document.querySelector('.mwp-sfe-draft-active');
					if (draftEl) overlayMgr.showActive(draftEl, 'draft-preview');
				}

				if (activeEditor) {
					repositionActiveEditorUI(activeEditor);
					setTimeout(() => {
						if (!ctx.activeEditor) return;
						repositionActiveEditorUI(ctx.activeEditor);
						restorePreviewSelection(ctx.activeEditor);
					}, 50);
				}
			} else if (overlayMgr) {
				overlayMgr.hideHover();
				overlayMgr.updateAllOverlays();
			}
		}

		update();
	}

	SFE.ModeToggleBar = { init, update, setInlineUIEnabled };

})();
