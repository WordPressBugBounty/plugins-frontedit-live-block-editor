/**
 * Action bar - floating UI strip that appears above editable elements
 *
 * Reads (via globals):
 *   SFE.Context           - .actionBar, .activeEditor
 *   SFE.BatchEditManager  - .isSessionActive, .isEnabled, .startInlineCommenting
 *   SFE.OverlayManager    - .showHover
 *   SFE.hoverTracker      - .currentGroupId, .bottommostElement,
 *                           .lastHoveredElements, .isProcessing, .currentMousePos
 *   SFE.loadPendingDraft  - set by DraftManager
 *   SFE.startEditing      - set by frontend-inline-edit.js
 *   SFE.startCommenting   - set by CommentManager
 *   SFE.exitCommentMode   - set by CommentManager
 *   SFE.closeDraftPreview - set by DraftManager
 *
 * Exposes: SFE.ActionBar  (class - instantiated by frontend-inline-edit.js)
 *   { manage, show, hide, updateState, reset, showMultiple,
 *     setMultiElementHoverAnchor, isPointerInHoverTransferCorridor,
 *     getOrCreate }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

class ActionBar {
	constructor(dependencies) {
		// Dependencies
		this.TIMING                   = dependencies.TIMING;
		this.perms                    = dependencies.perms;
		this.postId                   = dependencies.postId;
		this.restBase                 = dependencies.restBase;
		this.apiCall                  = dependencies.apiCall;
		this.getApplicableHandlers    = dependencies.getApplicableHandlers;
		this.positionFloatingElements = dependencies.positionFloatingElements;
		this.schedulePosition         = dependencies.schedulePosition || dependencies.debouncedPosition || dependencies.positionFloatingElements;
		this.ElementState             = dependencies.ElementState;
		this.ElementPrep              = dependencies.ElementPrep;
		this.attachEventListener      = dependencies.attachEventListener;
		this.removeEventListener      = dependencies.removeEventListener;
		
		// State
		this.activeBar     = null;
		this.activeElement = null;
		this.hoverTimeout  = null;
	}

	/**
	 * UNIFIED ACTION BAR MANAGER
	 * Centralizes all action bar operations for consistency
	 * 
	 * @param {string} action - 'show' | 'hide' | 'updateState' | 'reset' | 'showMultiple'
	 * @param {Object} options - Configuration object
	 * @returns {HTMLElement|void} The action bar element or void
	 */
	manage(action, options = {}) {
		const {
			element             = null,
			anchorElement       = null,
			handlers            = [],
			uuid                = null,
			state               = 'hover',
			bar                 = null,
			modeCleanupCallback = null
		} = options;
		
		switch(action) {
			case 'show':
				return this._showActionBar(element, handlers, uuid);
			case 'hide':
				return this._hideActionBar();
			case 'updateState':
				return this._updateActionBarState({
					bar: bar || this.activeBar,
					element,
					handlers,
					uuid,
					state,
					content: options.content || null
				});
			case 'reset':
				return this._resetActionBar(bar || this.activeBar, element, uuid, modeCleanupCallback);
			case 'showMultiple':
				return this._showMultipleActionBar(options.elements, anchorElement);
			default:
				console.warn('ActionBar.manage: Unknown action', action);
				return null;
		}
	}

	/**
	 * Public API - Convenience wrappers
	 */
	show(element, handlers, uuid) {
		return this.manage('show', { element, handlers, uuid });
	}

	hide() {
		return this.manage('hide');
	}

	updateState(config) {
		return this.manage('updateState', config);
	}

	reset(bar, element, uuid, modeCleanupCallback) {
		return this.manage('reset', { bar, element, uuid, modeCleanupCallback });
	}

	/**
	 * Show the multi-element hover bar for directly overlapping elements.
	 *
	 * @param {HTMLElement[]} elements      Overlap-group elements displayed as rows.
	 * @param {HTMLElement}   anchorElement Element currently under the pointer;
	 *                                       it controls the bar position and initial focus.
	 * @returns {HTMLElement} The visible multi-element action bar.
	 */
	showMultiple(elements, anchorElement) {
		return this.manage('showMultiple', { elements, anchorElement });
	}

	/**
	 * Move an open multi-element hover bar to the editable element directly
	 * under the pointer without changing the overlap rows or their focus state.
	 *
	 * @param {HTMLElement} anchorElement Directly hovered overlap-group element.
	 * @returns {void}
	 */
	setMultiElementHoverAnchor(anchorElement) {
		const bar = this.activeBar;
		if (
			!bar ||
			!bar._multiElements ||
			!bar._multiElements.includes(anchorElement) ||
			bar._targetElement === anchorElement
		) {
			return;
		}

		this.activeElement = anchorElement;
		bar._targetElement = anchorElement;
		// This is a pointer-driven state change, not a scroll update. Restore the
		// normal position transition before writing the new coordinates; the
		// PositionManager's scroll listener will suppress transitions again later.
		bar.classList.remove('mwp-sfe-no-position-transition');
		this._markTransitioning(bar);
		this.positionFloatingElements(anchorElement, null, bar, true);
		this._attachScrollListener(bar, anchorElement);
	}

	/**
	 * Return whether a pointer is crossing the short gap between the current
	 * hover anchor and its action bar.
	 *
	 * The action bar normally sits eight pixels below its anchor. When an inner
	 * block overlaps an outer block, that gap belongs to the outer block's hit
	 * area, which would otherwise cause HoverManager to re-anchor the bar before
	 * the pointer reaches it. This geometric corridor preserves the current
	 * hover state only for that deliberate block-to-bar transfer.
	 *
	 * The corridor is intentionally virtual: an invisible DOM element would
	 * either fail to affect hit testing or intercept page clicks. It is also
	 * limited to the action bar's normal adjacent placement, so a viewport
	 * fallback position never creates a large area that suppresses real hovers.
	 *
	 * @param {number} clientX Pointer client X coordinate.
	 * @param {number} clientY Pointer client Y coordinate.
	 * @returns {boolean} True when the pointer is in the protected transfer corridor.
	 */
	isPointerInHoverTransferCorridor(clientX, clientY) {
		const bar = this.activeBar;
		const anchor = bar?._targetElement || this.activeElement;
		const isHoverState = !!(
			bar &&
			(
				bar.classList.contains('mwp-sfe-state-hover') ||
				bar.classList.contains('mwp-sfe-state-hover-multi')
			)
		);

		if (!isHoverState || !(anchor instanceof HTMLElement)) {
			return false;
		}

		const anchorRect = anchor.getBoundingClientRect();
		const barRect    = bar.getBoundingClientRect();
		const gap         = barRect.top - anchorRect.bottom;
		const maxGap      = 24;

		// Only protect the normal below-anchor handoff. Sticky/viewport fallback
		// positions are intentionally excluded because their separation can be
		// large and should not hide a real block hover.
		if (gap <= 0 || gap > maxGap || clientY < anchorRect.bottom || clientY > barRect.top) {
			return false;
		}

		// Connect the anchor's bottom edge to the action bar's top edge as a
		// narrow funnel. This allows a natural diagonal approach when the bar was
		// clamped horizontally while excluding unrelated blocks beside the path.
		const progress = (clientY - anchorRect.bottom) / gap;
		const left = anchorRect.left + ((barRect.left - anchorRect.left) * progress);
		const right = anchorRect.right + ((barRect.right - anchorRect.right) * progress);

		return clientX >= left && clientX <= right;
	}

	/**
	 * Internal: Show action bar in hover state
	 */
	_showActionBar(element, handlers, uuid) {
		// Clear any pending timeouts immediately
		if (this.hoverTimeout) {
			clearTimeout(this.hoverTimeout);
			this.hoverTimeout = null;
		}

		const bar = this.getOrCreate();

		// Set the target element IMMEDIATELY so the dock can 
		// verify hover status during the transition
		this.activeElement = element;

		// Cancel any in-progress dock animation (e.g. user clicks while bar is
		// sliding between dock and element).  Matches the existing behavior of
		// hovering an element while the editor-close animation is playing.
		const dock = SFE.ActionBarDock;
		dock?.cancelAnimation?.();

		// If the bar is currently docked, play the two-phase undock animation
		// (slide-down-reverse out of dock, slide-up into element) before
		// rendering hover state.  The dock calls _continueShowActionBar as its
		// onDone callback once the exit animation completes.
		if (dock?.shouldHandleShow?.()) {
			dock.handleShow(bar, this, () => this._continueShowActionBar(bar, element, handlers, uuid));
			return bar;
		}

		return this._continueShowActionBar(bar, element, handlers, uuid);
	}

	/**
	 * Continue showing the action bar at the given element.
	 * Called directly by _showActionBar (normal path) or as an onDone callback
	 * from the dock's undock animation (dock → element transition).
	 */
	_continueShowActionBar(bar, element, handlers, uuid) {
		if (bar._closingTimeout) {
			clearTimeout(bar._closingTimeout);
			bar._closingTimeout = null;
		}

		// Stop any closing animation and force visibility
		bar.classList.remove('mwp-sfe-closing');
		bar.style.display = 'flex';
		void bar.offsetWidth; // Force reflow
		bar.style.opacity = '1';
		bar.style.pointerEvents = 'auto';

		// Position-transition policy:
		//   Normal path   → enable transitions (smooth slide between elements).
		//   Dock-to-element → keep transitions suppressed so the bar doesn't
		//   animate across the viewport from the dock's coordinates to the
		//   element's coordinates.  The dock sets bar._suppressPositionTransition
		//   before calling this method and clears it in the next rAF.
		if (!bar._suppressPositionTransition) {
			bar.classList.remove('mwp-sfe-no-position-transition');
			this._markTransitioning(bar);
		} else {
			bar.classList.add('mwp-sfe-no-position-transition');
		}

		// If element is already active, just ensure visibility
		if (element.classList.contains('mwp-sfe-element-active')) {
			return bar;
		}

		// Update reference and state
		this.activeElement = element;
		bar._targetElement = element;

		// Render hover state via the content-based path
		this._updateActionBarState({
			bar,
			element,
			handlers,
			uuid,
			state:   'hover',
			content: this._buildHoverContent(element, handlers, uuid, bar)
		});

		// Setup scroll listener for hover state
		this._attachScrollListener(bar, element);

		return bar;
	}

	/**
	 * Format a handler's elementType + description into a header string
	 */
	_formatHandlerHeader(handler) {
		if (!handler) return 'Element';
		const type = handler.elementType || 'Element';
		const desc = handler.description || '';
		return desc ? `${type} • ${desc}` : type;
	}

	/**
	 * Build button config objects for the hover state of an element.
	 * Returns plain config objects (not DOM elements) so they can be consumed
	 * by both the content-based renderer (_buildHoverContent) and the
	 * multi-element bar builder (_showMultipleActionBar).
	 *
	 * Each config: { text, className, onClick, hoverHeader? }
	 */
	_getHoverButtonConfigs(element, handlers, uuid, bar) {
		const isPending = element.classList.contains('mwp-sfe-status-pending');

		if (isPending) {
			return [{
				text: 'View Draft',
				className: 'mwp-sfe-btn mwp-sfe-btn-primary-inline',
				onClick: (e) => {
					e.stopPropagation();
					const btn = e.currentTarget;
					btn.disabled = true;
					btn.setAttribute('mwp-sfe-btn-loading', 'true');
					SFE.loadPendingDraft(bar, element, uuid, handlers);
				}
			}];
		}

		const editHandler    = handlers.find(h => h.capability === 'edit');
		const commentHandler = handlers.find(h => h.capability === 'comment');
		const configs        = [];

		if (editHandler) {
			configs.push({
				text:        editHandler.actionLabel || 'Edit',
				className:   'mwp-sfe-btn mwp-sfe-btn-primary-inline',
				hoverHeader: this._formatHandlerHeader(editHandler),
				onClick: (e) => {
					e.stopPropagation();
					SFE.startEditing(element, editHandler, uuid, null);
				}
			});
		}

		if (commentHandler) {
			configs.push({
				text:        commentHandler.actionLabel || 'Comment',
				className:   'mwp-sfe-btn ' + (editHandler ? 'mwp-sfe-btn-secondary-inline' : 'mwp-sfe-btn-primary-inline'),
				hoverHeader: this._formatHandlerHeader(commentHandler),
				onClick: (e) => {
					e.stopPropagation();
					this._startCommentMode(bar, element, handlers, uuid);
				}
			});
		}

		return configs;
	}

	/**
	 * Build a complete content config object for the hover state.
	 * Consumed by _updateActionBarState via the content-based rendering path.
	 */
	_buildHoverContent(element, handlers, uuid, bar) {
		const isPending      = element.classList.contains('mwp-sfe-status-pending');
		const primaryHandler = isPending
			? null
			: (handlers.find(h => h.capability === 'edit') || handlers[0]);

		const header = isPending
			? `${(handlers[0]?.elementType) || 'Element'} • View pending draft.`
			: this._formatHandlerHeader(primaryHandler);

		return {
			header,
			buttons: this._getHoverButtonConfigs(element, handlers, uuid, bar)
		};
	}

	_startCommentMode(bar, element, handlers, uuid) {
		const batchManager    = SFE.BatchEditManager || null;
		const hasActiveEditor = !!SFE.Context?.activeEditor;

		if (
			batchManager &&
			typeof batchManager.isSessionActive === 'function' &&
			batchManager.isSessionActive() &&
			hasActiveEditor &&
			typeof batchManager.startInlineCommenting === 'function'
		) {
			batchManager.startInlineCommenting(bar, element, handlers, uuid);
			return;
		}

		SFE.startCommenting(bar, element, handlers, uuid);
	}

	/**
	 * Internal: Show action bar for multiple overlapping elements
	 *
	 * @param {HTMLElement[]} elements      Overlap-group elements displayed as rows.
	 * @param {HTMLElement}   anchorElement Element currently under the pointer.
	 * @returns {HTMLElement} The multi-element action bar.
	 */
	_showMultipleActionBar(elements, anchorElement) {
		// Clear any pending timeouts immediately
		if (this.hoverTimeout) {
			clearTimeout(this.hoverTimeout);
			this.hoverTimeout = null;
		}

		const bar = this.getOrCreate();

		// Cancel docking animations / handle dock redirect - parallel to
		// _showActionBar so multi-element hovers transition from dock correctly.
		const dock = SFE.ActionBarDock;
		dock?.cancelAnimation?.();

		if (dock?.shouldHandleShow?.()) {
			dock.handleShow(bar, this, () => this._continueShowMultipleActionBar(bar, elements, anchorElement));
			return bar;
		}

		return this._continueShowMultipleActionBar(bar, elements, anchorElement);
	}

	/**
	 * Continue showing the multi-element action bar.
	 * Called directly (normal path) or as an onDone callback from the dock's
	 * undock animation (dock -> multi-element transition).
	 *
	 * @param {HTMLElement}   bar           Action-bar DOM element to render.
	 * @param {HTMLElement[]} elements      Overlap-group elements displayed as rows.
	 * @param {HTMLElement}   anchorElement Element currently under the pointer.
	 * @returns {HTMLElement} The rendered multi-element action bar.
	 */
	_continueShowMultipleActionBar(bar, elements, anchorElement) {
		if (bar._closingTimeout) {
			clearTimeout(bar._closingTimeout);
			bar._closingTimeout = null;
		}

		// Stop any closing animation and force visibility
		bar.classList.remove('mwp-sfe-closing');
		bar.style.display       = 'flex';
		void bar.offsetWidth;
		bar.style.opacity       = '1';
		bar.style.pointerEvents = 'auto';

		// Position-transition policy - same suppress-flag check as
		// _continueShowActionBar so dock->multi-element transitions don't
		// CSS-animate across the viewport between coordinate systems.
		if (!bar._suppressPositionTransition) {
			bar.classList.remove('mwp-sfe-no-position-transition');
			this._markTransitioning(bar);
		} else {
			bar.classList.add('mwp-sfe-no-position-transition');
		}

		// Store elements and set up multi-element state. The overlap group controls
		// which rows appear; the directly hovered element controls both the initial
		// focused row and the fixed position of the action bar.
		const positionElement   = elements.includes(anchorElement) ? anchorElement : elements[0];
		const initialFocusIndex = elements.indexOf(positionElement);
		this.activeElement      = positionElement;
		bar._targetElement      = positionElement;
		bar._multiElements      = elements;
		bar._currentFocusIndex  = initialFocusIndex;
		
		// Clear old content and state
		bar.innerHTML = '';
		Array.from(bar.classList)
			.filter(className => className.startsWith('mwp-sfe-state-'))
			.forEach(className => bar.classList.remove(className));
		bar.classList.add('mwp-sfe-state-hover-multi');
		
		// Create wrapper
		const wrapper     = document.createElement('div');
		wrapper.className = 'mwp-sfe-multi-element-wrapper';
		
		// Build multi-element interface
		const container     = document.createElement('div');
		container.className = 'mwp-sfe-multi-element-container';
		
		elements.forEach((element, index) => {
			const uuid     = element._mwpSfeUuid || element.dataset.mwpSfeUuid;
			const handlers = element._mwpSfeHandlers || this.getApplicableHandlers(element, uuid);
			
			// Create row for this element
			const row = document.createElement('div');
			row.className = 'mwp-sfe-multi-element-row';
			row.setAttribute('data-element-index', index);
			if (index === initialFocusIndex) row.classList.add('mwp-sfe-focused');

			const isPendingRow   = element.classList.contains('mwp-sfe-status-pending');
			const primaryHandler = isPendingRow ? null : (handlers.find(h => h.capability === 'edit') || handlers[0]);

			// Header: element type + context-aware description.
			// For pending-draft rows the header uses draft-specific wording and
			// does not change on button hover (single button, purpose is clear).
			const header            = document.createElement('div');
			header.className        = 'mwp-sfe-multi-element-header';
			const defaultHeaderText = isPendingRow
				? `${(handlers[0]?.elementType) || 'Element'} • View pending draft.`
				: this._formatHandlerHeader(primaryHandler);
			header.textContent = defaultHeaderText;

			// Buttons row - built from configs to avoid duplicating button-creation
			// logic and to eliminate the fragile text-matching used in the old approach.
			const buttonsRow     = document.createElement('div');
			buttonsRow.className = 'mwp-sfe-multi-element-buttons';

			this._getHoverButtonConfigs(element, handlers, uuid, bar).forEach(cfg => {
				const btn       = document.createElement('button');
				btn.className   = cfg.className;
				btn.textContent = cfg.text;
				if (cfg.onClick) btn.onclick = cfg.onClick;
				if (cfg.hoverHeader) {
					btn.onmouseenter = () => { header.textContent = cfg.hoverHeader; };
					btn.onmouseleave = () => { header.textContent = defaultHeaderText; };
				}
				buttonsRow.appendChild(btn);
			});
			
			row.appendChild(header);
			row.appendChild(buttonsRow);
			
			// Hover row to update focus
			row.onmousemove = () => {
				// Only trigger if we aren't already focusing this row
				// to avoid redundant heavy calls to OverlayManager
				if (bar._currentFocusIndex !== index) {
					this._focusMultiElement(bar, index);
				}
			};

			// Click row to activate primary action
			row.onclick = (e) => {
				if (e.target.tagName === 'BUTTON') return; // Let button handle its own click
				const primaryBtn = buttonsRow.querySelector('.mwp-sfe-btn-primary-inline');
				if (primaryBtn) primaryBtn.click();
			};

			container.appendChild(row);
		});
		
		// Instructions
		const instructions       = document.createElement('div');
		instructions.className   = 'mwp-sfe-multi-element-instructions';
		instructions.textContent = 'hover/tab to cycle • click/enter to activate';
		
		wrapper.appendChild(container);
		wrapper.appendChild(instructions);
		bar.appendChild(wrapper);
		
		// Setup keyboard navigation
		this._setupMultiElementKeyboard(bar);
		
		// Position bar
		this.positionFloatingElements(positionElement, null, bar, true);
		
		// Setup scroll listener
		this._attachScrollListener(bar, positionElement);
		
		// Auto-focus the bar so Tab works immediately
		setTimeout(() => {
			if (bar && bar.classList.contains('mwp-sfe-state-hover-multi')) {
				bar.focus({ preventScroll: true });
			}
		}, 50);
		
		return bar;
	}

	/**
	 * Focus a specific element in multi-element mode
	 */
	_focusMultiElement(bar, index) {
		if (!bar._multiElements) return;
		
		const elements = bar._multiElements;
		if (index < 0 || index >= elements.length) return;
		
		bar._currentFocusIndex = index;
		
		// Update row visual states
		const rows = bar.querySelectorAll('.mwp-sfe-multi-element-row');
		rows.forEach((row, i) => {
			row.classList.toggle('mwp-sfe-focused', i === index);
		});
		
		// Update hover overlay to show focused element
		const focusedElement = elements[index];
		if (SFE.OverlayManager) {
			SFE.OverlayManager.showHover(focusedElement);
		}
		
		// Update hover tracker to reflect current focused element
		if (SFE.hoverTracker) {
			SFE.hoverTracker.lastHoveredElements = [focusedElement];
		}
	}

	/**
	 * Setup keyboard navigation for multi-element mode
	 */
	_setupMultiElementKeyboard(bar) {
		// Remove old keyboard handler if exists
		if (bar._keyboardHandler) {
			bar.removeEventListener('keydown', bar._keyboardHandler);
		}
		
		const keyboardHandler = (e) => {
			if (!bar._multiElements) return;
			
			if (e.key === 'Tab') {
				e.preventDefault();
				// Cycle through elements
				const newIndex = e.shiftKey 
					? (bar._currentFocusIndex - 1 + bar._multiElements.length) % bar._multiElements.length
					: (bar._currentFocusIndex + 1) % bar._multiElements.length;
				this._focusMultiElement(bar, newIndex);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				// Trigger primary button of focused element
				const rows       = bar.querySelectorAll('.mwp-sfe-multi-element-row');
				const focusedRow = rows[bar._currentFocusIndex];
				if (focusedRow) {
					const primaryBtn = focusedRow.querySelector('.mwp-sfe-btn-primary-inline');
					if (primaryBtn) primaryBtn.click();
				}
			} else if (e.key === 'Escape') {
				this.hide();
			}
		};
		
		bar._keyboardHandler = keyboardHandler;
		bar.addEventListener('keydown', keyboardHandler);
	}

	/**
	 * Internal: Hide action bar with animation
	 */
	_hideActionBar() {
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		
		const isHoverState = this.activeBar && (
			this.activeBar.classList.contains('mwp-sfe-state-hover') ||
			this.activeBar.classList.contains('mwp-sfe-state-hover-multi')
		);
		
		if (isHoverState) {
			this.hoverTimeout = setTimeout(() => {
				// Don't hide if element is now being edited/previewed
				if (this.activeElement && this.activeElement.classList.contains('mwp-sfe-element-active')) {
					return;
				}
				
				// Check if mouse is currently over the bar or any element
				const pointerPosition = SFE.hoverTracker?.currentMousePos;
				const isHoveringTransferCorridor = !!(
					pointerPosition &&
					this.isPointerInHoverTransferCorridor(pointerPosition.x, pointerPosition.y)
				);
				const isHoveringBar = this.activeBar.matches(':hover') || isHoveringTransferCorridor;
				let isHoveringElement = false;
				
				if (this.activeBar._multiElements) {
					// Check all elements in multi-element mode
					isHoveringElement = this.activeBar._multiElements.some(el => el.matches(':hover'));
				} else if (this.activeElement) {
					isHoveringElement = this.activeElement.matches(':hover');
				}

				if (!isHoveringBar && !isHoveringElement) {
					// Clean up multi-element state regardless of where the bar goes next.
					if (this.activeBar._multiElements) {
						delete this.activeBar._multiElements;
						delete this.activeBar._currentFocusIndex;
					}

					// Batch-edit dock: transition bar to dock instead of hiding it.
					const dock = SFE.ActionBarDock;
					if (dock?.shouldHandleHide?.(this.activeBar)) {
						dock.handleHide(this.activeBar, this);
						return;
					}

					// Normal close path (free version or dock not active).
					this.activeBar.classList.add('mwp-sfe-closing');

					const closingTimeout = setTimeout(() => {
						if (this.activeBar.classList.contains('mwp-sfe-closing')) {
							this.activeBar.style.display = 'none';
							this.activeBar.classList.remove('mwp-sfe-closing');
							this.activeElement = null;
							// Clear hover tracker state
							if (SFE.hoverTracker) {
								SFE.hoverTracker.currentGroupId = null;
								SFE.hoverTracker.bottommostElement = null;
								SFE.hoverTracker.lastHoveredElements = [];
							}
							// Clean up scroll listener
							this._removeScrollListener(this.activeBar);
						}
					}, this.TIMING.TRANSITION_DURATION);

					this.activeBar._closingTimeout = closingTimeout;
				}
			}, this.TIMING.HOVER_DELAY);
		}
	}

	/**
	 * Internal: Update action bar content based on state
	 * 
	 * @param {Object} config - Configuration object
	 *   - bar: The action bar element
	 *   - element: The target element
	 *   - state: State name for CSS class ('hover', 'edit', 'comment', etc.)
	 *   - content: Content config object (required):
	 *     - buttons: Array of { text, className, onClick, disabled, loading, storeAs, hoverHeader }
	 *     - customElement: A pre-built DOM element to insert directly
	 *     - customBuilder: A function (bar, element) => DOM element
	 *     - header: Optional header text; when provided, buttons are wrapped in a
	 *               mwp-sfe-single-element-row with a mwp-sfe-single-element-header
	 */
	_updateActionBarState(config) {
		const { bar, element, state, content = null } = config;

		// Cancel any in-progress dock animation and clear dock state so that
		// PositionManager can reposition the bar freely (e.g. when the user
		// clicks an element while the bar is docked or mid-animation).
		// Force=true cancels undocking animations too (not just docking),
		// because a click-to-edit is a definitive action that must win.
		const _dock = SFE.ActionBarDock;
		_dock?.cancelAnimation?.(true);
		if (bar?._isDocked) {
			bar._isDocked      = false;
			bar.classList.remove('mwp-sfe-state-dock');
			bar.style.position = 'absolute';
			bar.style.left     = '';
			bar.style.right    = '';

			// Suppress position transition so the bar doesn't fly from dock
			// coordinates to the element if clicked directly while fully docked.
			bar._suppressPositionTransition = true;
			requestAnimationFrame(() => {
				delete bar._suppressPositionTransition;
				if (bar) bar.classList.remove('mwp-sfe-no-position-transition');
			});
			
			// Retrigger slide-up to animate into the edit position cleanly
			bar.style.animation = 'none';
			void bar.offsetWidth;
			bar.style.animation = '';
		}

		if (!bar) return;

		// Cancel any in-flight close animation before rendering new state.
		// Without this, a stale hoverTimeout or closingTimeout from a prior session
		// can fire after updateState() and set display:none on the bar mid-edit.
		if (this.hoverTimeout) {
			clearTimeout(this.hoverTimeout);
			this.hoverTimeout = null;
		}
		if (bar._closingTimeout) {
			clearTimeout(bar._closingTimeout);
			bar._closingTimeout = null;
		}
		bar.classList.remove('mwp-sfe-closing');
		bar.style.display = 'flex';

		// Clear old content
		bar.innerHTML = '';
		
		// Remove all state classes then add the new one
		Array.from(bar.classList)
			.filter(className  => className.startsWith('mwp-sfe-state-'))
			.forEach(className => bar.classList.remove(className));
		bar.classList.add('mwp-sfe-state-' + state);
		
		// Clear old stored button references
		delete bar._saveBtn;
		delete bar._cancelBtn;

		// Render content
		if (content) {
			if (content.customElement) {
				// Direct DOM element insertion
				bar.appendChild(content.customElement);
			} else if (content.customBuilder) {
				// Builder function
				const built = content.customBuilder(bar, element);
				if (built) bar.appendChild(built);
			} else if (content.buttons) {
				// Button array -- optionally wrapped in a header row.
				// When content.header is provided the buttons are placed in a
				// mwp-sfe-single-element-row and each btnConfig.hoverHeader
				// (if set) updates the header text on mouseenter.
				let headerEl     = null;
				let buttonTarget = bar;

				if (content.header !== undefined) {
					const rowWrapper = document.createElement('div');
					rowWrapper.className = 'mwp-sfe-single-element-row';

					headerEl             = document.createElement('div');
					headerEl.className   = 'mwp-sfe-single-element-header';
					headerEl.textContent = content.header;
					rowWrapper.appendChild(headerEl);

					const buttonRow = document.createElement('div');
					buttonRow.className = 'mwp-sfe-single-element-buttons';
					rowWrapper.appendChild(buttonRow);
					bar.appendChild(rowWrapper);
					buttonTarget = buttonRow;
				}

				content.buttons.forEach(btnConfig => {
					const btn       = document.createElement('button');
					btn.className   = btnConfig.className || 'mwp-sfe-btn';
					btn.textContent = btnConfig.text || '';
					if (btnConfig.disabled) btn.disabled = true;
					if (btnConfig.loading)  btn.setAttribute('mwp-sfe-btn-loading', 'true');
					if (btnConfig.onClick)  btn.onclick = btnConfig.onClick;

					// Update header on hover when a per-button description is provided
					if (headerEl && btnConfig.hoverHeader) {
						btn.addEventListener('mouseenter', () => { headerEl.textContent = btnConfig.hoverHeader; });
						btn.addEventListener('mouseleave', () => { headerEl.textContent = content.header; });
					}

					// Store reference on the bar if requested (e.g. storeAs: 'saveBtn' → bar._saveBtn)
					if (btnConfig.storeAs) {
						bar[`_${btnConfig.storeAs}`] = btn;
					}

					buttonTarget.appendChild(btn);
				});
			}
		}
		
		// Reposition after content change.
		// Apply the same suppress-flag check as _continueShowActionBar so an
		// edit-state update during a dock->element transition also avoids a
		// cross-viewport position animation.
		if (!bar._suppressPositionTransition) {
			bar.classList.remove('mwp-sfe-no-position-transition');
			this._markTransitioning(bar);
		} else {
			bar.classList.add('mwp-sfe-no-position-transition');
		}
		this.positionFloatingElements(element, null, bar, true);

		// Setup scroll listener for active states (edit, comment, preview, etc.)
		// Hover state handles this in _showActionBar instead
		if (state !== 'hover') {
			this._attachScrollListener(bar, element);
		}
	}

	/**
	 * Internal: Reset action bar after editor close.
	 *
	 * Checks cursor position synchronously - attachActionBarToElement was called
	 * synchronously in EditorLifecycle.resetActionBar so data-mwp-sfe-bound is
	 * already stamped and elementsFromPoint reliably finds editable elements.
	 *
	 * - Mouse over editable(s): dispatch synthetic mousemove so HoverManager
	 *   rebuilds the correct state (single or multi) through its normal pipeline.
	 *   innerHTML is intentionally NOT cleared here - _showActionBar /
	 *   _showMultipleActionBar clear it as part of their own rebuild.
	 * - Mouse elsewhere: play close animation immediately, no delay.
	 */
	_resetActionBar(bar, element, uuid, modeCleanupCallback) {
		if (modeCleanupCallback) modeCleanupCallback();

		this.ElementState.markInactive(element);
		this.ElementState.enableAllElements();

		if (!bar) return;

		this._removeScrollListener(bar);

		if (bar._closingTimeout) {
			clearTimeout(bar._closingTimeout);
			delete bar._closingTimeout;
		}

		delete bar._saveBtn;
		delete bar._cancelBtn;
		if (bar._multiElements) {
			delete bar._multiElements;
			delete bar._currentFocusIndex;
		}

		// Flush group cache so HoverManager does full re-detection instead
		// of early-exiting with "same group, no change"
		if (SFE.hoverTracker) {
			SFE.hoverTracker.currentGroupId    = null;
			SFE.hoverTracker.bottommostElement = null;
			SFE.hoverTracker.isProcessing      = false;
		}

		// Make bar non-interactive so elementsFromPoint sees through it to
		// the editable elements below. _showActionBar restores 'auto'.
		bar.style.pointerEvents = 'none';

		const pos = SFE.hoverTracker?.currentMousePos;

		if (pos?.x !== undefined) {
			const elementsAtPoint = document.elementsFromPoint(pos.x, pos.y);
			const topEditable     = elementsAtPoint.find(
				el => el.dataset.mwpSfeBound === '1'
			);

			if (topEditable) {
				// Delegate entirely to HoverManager - it will call _showActionBar
				// or _showMultipleActionBar which restore pointerEvents, clear
				// old content, and rebuild the correct hover state
				topEditable.dispatchEvent(new MouseEvent('mousemove', {
					bubbles: true, cancelable: true,
					clientX: pos.x, clientY: pos.y
				}));
				return;
			}
		}

		// Mouse is not over any editable element
		bar.style.pointerEvents = '';
		this.activeElement = null;

		if (SFE.hoverTracker) {
			SFE.hoverTracker.lastHoveredElements = [];
			SFE.hoverTracker.currentGroupId      = null;
			SFE.hoverTracker.bottommostElement   = null;
		}

		// In an active batch session, dock the bar instead of closing it.
		const dockReset = SFE.ActionBarDock;
		if (dockReset?.shouldHandleReset?.(bar)) {
			dockReset.handleReset(bar, this);
			return;
		}

		// Normal close path (free version or dock not active).
		Array.from(bar.classList)
			.filter(c => c.startsWith('mwp-sfe-state-'))
			.forEach(c => bar.classList.remove(c));
		bar.classList.remove('mwp-sfe-no-position-transition');
		bar.classList.add('mwp-sfe-closing');

		const ct = setTimeout(() => {
			if (bar.classList.contains('mwp-sfe-closing')) {
				bar.style.display = 'none';
				bar.classList.remove('mwp-sfe-closing');
			}
		}, this.TIMING.TRANSITION_DURATION);
		bar._closingTimeout = ct;
	}

	/**
	 * Get or create the global action bar instance
	 */
	getOrCreate() {
		// Check if bar was removed from DOM
		if (!this.activeBar || !document.body.contains(this.activeBar)) {
			this.activeBar = document.createElement('div');
			this.activeBar.className = 'mwp-sfe-inline-actions';
			this.activeBar.setAttribute('data-mwp-sfe-control', 'true');
			this.activeBar.setAttribute('tabindex', '-1');
			this.activeBar.style.outline = 'none';
			document.body.appendChild(this.activeBar);
			
			this.activeBar.addEventListener('mouseenter', () => {
				if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
			});
			this.activeBar.addEventListener('mouseleave', () => {
				const isHoverState = this.activeBar.classList.contains('mwp-sfe-state-hover') ||
					this.activeBar.classList.contains('mwp-sfe-state-hover-multi');
				if (isHoverState) {
					this.hide();
				}
			});
		}
		return this.activeBar;
	}

	/**
	 * Mark the bar as mid-transition so positionFloatingElements won't suppress
	 * position transitions for the duration of the CSS transition.
	 */
	_markTransitioning(bar) {
		bar._isStateTransitioning = true;
		clearTimeout(bar._transitioningTimeout);
		bar._transitioningTimeout = setTimeout(() => {
			bar._isStateTransitioning = false;
			delete bar._transitioningTimeout;
		}, 250); // slightly longer than CSS transition (200ms) for safety
	}

	/**
	 * Attach scroll listener to update bar position
	 */
	_attachScrollListener(bar, element) {
		// Clean up any existing listener first
		this._removeScrollListener(bar);
		
		const scrollHandler = () => {
			this.schedulePosition(element, null, bar);
		};
		
		bar._scrollHandler = scrollHandler;
		bar._scrollElement = element;
		
		// Delay attaching scroll listener to allow initial transition to complete.
		// This prevents the scroll handler from firing during the hover transition animation.
		bar._scrollListenerTimeout = setTimeout(() => {
			// Catch any scrolling that happened during the transition delay
			scrollHandler();
			
			window.addEventListener('scroll', scrollHandler, true);
			delete bar._scrollListenerTimeout;
		}, 250);
	}

	/**
	 * Remove scroll listener from bar
	 */
	_removeScrollListener(bar) {
		if (bar && bar._scrollListenerTimeout) {
			clearTimeout(bar._scrollListenerTimeout);
			delete bar._scrollListenerTimeout;
		}
		
		if (bar && bar._scrollHandler) {
			window.removeEventListener('scroll', bar._scrollHandler, true);
			delete bar._scrollHandler;
			delete bar._scrollElement;
		}
	}
}

// Export for use in main file
SFE.ActionBar = ActionBar;

})();
