/**
 * Hover manager - mouse tracking, overlapping-element grouping, and click dispatch
 *
 * Reads (via globals):
 *   SFE.Context              - .activeMode (r/w), .actionBar, .uuidMap,
 *                              .sortHandlersByPriority, .hoverTracker
 *   SFE.ElementState         - .attachEventListener, .removeEventListener
 *   SFE.GenerateClientUuid
 *   SFE.OverlayManager
 *   SFE.startEditing         - set by frontend-inline-edit.js
 *   SFE.startCommenting      - set by frontend-inline-edit.js
 *   SFE.ManagerData          - .postId, .handlers, .permissions
 *
 * Exposes: SFE.HoverManager { attachActionBarToElement, findOverlappingGroup }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Return whether the current user may view pending drafts.
	 *
	 * Comment-only users intentionally receive the normal comment handler for a
	 * block, but must not learn that the block has a pending draft or enter the
	 * draft-preview flow.
	 *
	 * @returns {boolean} True when draft state may be exposed in the UI.
	 */
	function canAccessDrafts() {
		const permissions = SFE.ManagerData.permissions || {};
		return !!(permissions.can_publish || permissions.can_draft);
	}

	/**
	 * Returns true while a FloatingUiMoveManager-driven UI drag session is active.
	 *
	 * This suppresses hover state churn while the user is repositioning plugin
	 * chrome such as the movable mode toggle bar.
	 *
	 * @returns {boolean} True when a UI drag session is active.
	 */
	function isUiDragActive() {
		return !!(
			SFE.FloatingUiMoveManager &&
			typeof SFE.FloatingUiMoveManager.isDragActive === 'function' &&
			SFE.FloatingUiMoveManager.isDragActive()
		);
	}

	/**
	 * Return whether batch editing currently has an active editor surface.
	 *
	 * This mirrors the existing "active session or session still loading"
	 * behavior so hover ownership stays stable from the first editor open.
	 *
	 * @returns {boolean} True when batch editing is effectively active.
	 */
	function isBatchEditingActive() {
		const batchManager = SFE.BatchEditManager || null;
		if (!batchManager || !SFE.Context.activeEditor) {
			return false;
		}

		return (
			(typeof batchManager.isSessionActive === 'function' && batchManager.isSessionActive()) ||
			(typeof batchManager.isEnabled === 'function' && batchManager.isEnabled())
		);
	}

	/**
	 * Return whether one pointer coordinate lies within an element's bounds.
	 *
	 * @param {Element|null} element Target element.
	 * @param {number}       x       Pointer client X coordinate.
	 * @param {number}       y       Pointer client Y coordinate.
	 * @returns {boolean} True when the point is inside the element box.
	 */
	function isPointWithinElementBounds(element, x, y) {
		if (!(element instanceof Element)) {
			return false;
		}

		const rect = element.getBoundingClientRect();
		return (
			x >= rect.left &&
			x <= rect.right &&
			y >= rect.top &&
			y <= rect.bottom
		);
	}

	/**
	 * Return whether two bound elements belong to the same active block family.
	 *
	 * Parent/child relationships inside the active block must remain hoverable,
	 * while unrelated overlapping siblings should be ignored when the pointer is
	 * still inside the active block's own bounds.
	 *
	 * @param {HTMLElement} activeElement   Active editor block root.
	 * @param {HTMLElement} candidateElement Candidate bound element.
	 * @returns {boolean} True when the candidate is the active element, one of
	 *                    its descendants, or one of its ancestors.
	 */
	function isWithinActiveElementFamily(activeElement, candidateElement) {
		if (!(activeElement instanceof HTMLElement) || !(candidateElement instanceof HTMLElement)) {
			return false;
		}

		return (
			candidateElement === activeElement ||
			activeElement.contains(candidateElement) ||
			candidateElement.contains(activeElement)
		);
	}

	/**
	 * Filter hover candidates during batch editing so only the active block and
	 * its parent/child bound relatives can win hover while the pointer remains
	 * inside the active block bounds.
	 *
	 * @param {HTMLElement[]} candidates Candidate editable elements under the pointer.
	 * @param {number}        clientX    Pointer client X coordinate.
	 * @param {number}        clientY    Pointer client Y coordinate.
	 * @returns {HTMLElement[]} Filtered candidate elements.
	 */
	function filterBatchHoverCandidates(candidates, clientX, clientY) {
		if (!Array.isArray(candidates) || candidates.length === 0) {
			return [];
		}

		if (!isBatchEditingActive()) {
			return candidates;
		}

		const activeElement = SFE.Context.activeEditor?.element || null;
		if (!(activeElement instanceof HTMLElement)) {
			return candidates;
		}

		if (!isPointWithinElementBounds(activeElement, clientX, clientY)) {
			return candidates;
		}

		return candidates.filter(candidate => isWithinActiveElementFamily(activeElement, candidate));
	}

	/**
	 * Find every editable element whose overlay directly intersects the starting
	 * element's overlay.
	 *
	 * This deliberately does not recursively expand through intersecting
	 * elements. Recursive expansion turns an overlap chain into one group, so a
	 * full-width block at the top of the viewport can pull in unrelated blocks
	 * farther down the page. Edge contact is also excluded because it does not
	 * produce a shared overlay area.
	 *
	 * @param {HTMLElement} startElement Hovered editable element.
	 * @returns {HTMLElement[]} Directly intersecting elements, sorted for display.
	 */
	function findOverlappingGroup(startElement) {
		const allElements = Array.from(document.querySelectorAll('[data-mwp-sfe-bound="1"]'));
		const startRect  = startElement.getBoundingClientRect();
		const groupArray = allElements.filter(element => {
			if (element === startElement) {
				return true;
			}

			const rect = element.getBoundingClientRect();
			return (
				startRect.left < rect.right &&
				startRect.right > rect.left &&
				startRect.top < rect.bottom &&
				startRect.bottom > rect.top
			);
		});

		// Sort by bottom Y coordinate and physical size
		groupArray.sort((a, b) => {
			const aRect = a.getBoundingClientRect();
			const bRect = b.getBoundingClientRect();

			// Priority 1: Bottom coordinate (the element that ends lowest on the page comes first)
			if (Math.abs(aRect.bottom - bRect.bottom) > 1) {
				return bRect.bottom - aRect.bottom;
			}

			// Priority 2: Top coordinate (if bottoms are equal, the one that starts higher up is "outermost")
			if (Math.abs(aRect.top - bRect.top) > 1) {
				return aRect.top - bRect.top;
			}

			// Fallback: DOM order (ancestors first)
			return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
		});

		return groupArray;
	}

	/**
	 * Attach interactive action bar to a single element
	 */
	function attachActionBarToElement(element) {
		const ctx                    = SFE.Context;
		const { attachEventListener, removeEventListener } = SFE.ElementState;
		const generateClientUuid     = SFE.GenerateClientUuid;
		const overlayManager         = SFE.OverlayManager;
		const hoverTracker           = ctx.hoverTracker;
		const actionBar              = ctx.actionBar;
		const uuidMap                = ctx.uuidMap;
		const sortHandlersByPriority = ctx.sortHandlersByPriority;
		const handlers               = SFE.ManagerData.handlers;
		const postId                 = SFE.ManagerData.postId;
		const isInlineUIEnabled      = () => ctx.isInlineUIEnabled !== false;

		// Clean up old event listeners
		removeEventListener(element, 'mouseenter', 'mwpSfeShowBar');
		removeEventListener(element, 'mouseleave', 'mwpSfeHideBar');
		removeEventListener(element, 'mousemove', 'mwpSfeMouseMove');
		removeEventListener(element, 'click', 'mwpSfeClick', true);
		
		// Clean up old action bar
		if (element.dataset.mwpSfeBound) {
			element.querySelectorAll('[data-mwp-sfe-control]').forEach(el => el.remove());
			delete element.dataset.mwpSfeBound;
		}

		// SKIP nested lists
		if (element.tagName === 'OL' || element.tagName === 'UL') {
			const parentList = element.closest('li');
			if (parentList) return;
		}

		let uuid = element.dataset.mwpSfeUuid;
		let applicableHandlers = [];

		// Get handlers from uuidMap if available
		if (uuid && uuidMap[uuid]) {
			if (canAccessDrafts() && uuidMap[uuid].is_pending) {
				element.classList.add('mwp-sfe-status-pending');
			}

			uuidMap[uuid].handlers.forEach(handlerId => {
				const handler = handlers.find(h => h.id === handlerId);
				if (handler) applicableHandlers.push(handler);
			});
		}

		if (!applicableHandlers.length) return;

		element.dataset.mwpSfeBound = '1';

		// Sort handlers by priority
		const sortedHandlers = sortHandlersByPriority(applicableHandlers);
		const editHandler = sortedHandlers.find(handler => handler.capability === 'edit') || null;

		const schemaRuntime = SFE.SchemaRuntime || null;
		if (
			editHandler &&
			schemaRuntime &&
			typeof schemaRuntime.syncPlaceholders === 'function'
		) {
			schemaRuntime.syncPlaceholders(element, editHandler);
		}

		if (!uuid) {
			const primaryHandler = sortedHandlers[0];
			const typeCode = primaryHandler.elementTypeCode || element.tagName.toLowerCase();
			uuid = generateClientUuid(postId, typeCode, element);
			element.dataset.mwpSfeUuid = uuid;
		}

		// Detect comment-only elements (all handlers are 'comment', no edit handler).
		// We do NOT touch the element itself - the status is stored on the overlay only.
		const isCommentOnly = (
			sortedHandlers.length > 0 &&
			sortedHandlers.every(h => h.capability === 'comment')
		);

		// Mirror the status onto the element itself so CSS can exclude locked
		// elements from pointer-events restoration (the same way mwp-sfe-status-pending
		// is used for draft elements). We keep this as the sole CSS hook - the overlay
		// data-status attribute remains the authoritative source for JS queries.
		if (isCommentOnly) {
			element.classList.add('mwp-sfe-status-comment-only');
		}

		// Add persistent status overlay
		if (overlayManager) {
			let status = 'editable';
			if (element.classList.contains('mwp-sfe-status-pending')) status = 'pending';
			else if (isCommentOnly) status = 'comment-only';
			overlayManager.addStatusOverlay(element, status);
		}

		// Store handlers and uuid on element for later retrieval
		element._mwpSfeHandlers = sortedHandlers;
		element._mwpSfeUuid = uuid;

		// Use mousemove with elementsFromPoint to detect overlapping elements
		const mouseMoveHandler = function(e) {
			if (!isInlineUIEnabled()) {
				if (overlayManager) overlayManager.hideHover();
				actionBar.hide();
				hoverTracker.lastHoveredElements = [];
				hoverTracker.currentGroupId = null;
				hoverTracker.bottommostElement = null;
				hoverTracker.isProcessing = false;
				return;
			}

			// Suppress all hover state changes while a save is in progress.
			if (ctx.isSaving) return;
			if (isUiDragActive()) return;

			hoverTracker.currentMousePos = { x: e.clientX, y: e.clientY };

			if (hoverTracker.isProcessing) return;
			hoverTracker.isProcessing = true;

			requestAnimationFrame(() => {
				if (isUiDragActive()) {
					hoverTracker.isProcessing = false;
					return;
				}

				// Preserve the current hover while the pointer crosses the tiny
				// block-to-action-bar gap. Without this, an overlapping parent block
				// wins elementsFromPoint() before the pointer can reach the bar.
				if (actionBar.isPointerInHoverTransferCorridor(e.clientX, e.clientY)) {
					hoverTracker.isProcessing = false;
					return;
				}

				const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);

				// If hovering action bar, don't change state
				const hoveringActionBar = elementsAtPoint.some(el => 
					el.classList.contains('mwp-sfe-inline-actions') || el.closest('.mwp-sfe-inline-actions')
				);

				if (hoveringActionBar) {
					hoverTracker.isProcessing = false;
					return;
				}

				// Get editable elements
				const editableElements = elementsAtPoint.filter(el => 
					el.dataset.mwpSfeBound === '1' && 
					!el.classList.contains('mwp-sfe-element-active') &&
					!el.closest('[data-mwp-sfe-control]')
				);

				const batchHoverCandidates = filterBatchHoverCandidates(
					editableElements,
					e.clientX,
					e.clientY
				);

				if (batchHoverCandidates.length === 0) {
					// No elements - hide hover overlay, and (outside batch) the action bar too
					if (overlayManager) overlayManager.hideHover();
					if (!isBatchEditingActive()) {
						actionBar.hide();
					}
					hoverTracker.lastHoveredElements = [];
					hoverTracker.currentGroupId      = null;
					hoverTracker.bottommostElement   = null;
					hoverTracker.isProcessing        = false;
					return;
				}

				// When a batch editor is active, pending drafts and comment-only elements
				// are locked - can't switch to them until the current editor is closed.
				// Lock status is read from the overlay's data-status via getElementStatus(),
				// so nothing extra is written to the page element itself.
				if (isBatchEditingActive()) {
					const isLocked = el => {
						const st = overlayManager ? overlayManager.getElementStatus(el) : null;
						return st === 'pending' || st === 'comment-only';
					};
					const switchableElements = batchHoverCandidates.filter(el => !isLocked(el));

					if (switchableElements.length === 0) {
						// Only locked elements under cursor - hide hover.
						// Cursor (not-allowed) and pointer-events are CSS-driven via the
						// element's status overlay (data-status="pending"/"comment-only").
						if (overlayManager) overlayManager.hideHover();
						hoverTracker.lastHoveredElements = batchHoverCandidates;
						hoverTracker.currentGroupId      = null;
						hoverTracker.bottommostElement   = null;
						hoverTracker.isProcessing        = false;
						return;
					}

					// Switchable elements in view - show hover.
					// Cursor is handled by CSS on the status overlay / bound element.
					if (overlayManager) overlayManager.showHover(switchableElements[0]);
					hoverTracker.lastHoveredElements = switchableElements;
					hoverTracker.currentGroupId      = switchableElements.map(el => el.dataset.mwpSfeUuid).join(',');
					hoverTracker.bottommostElement   = switchableElements[0];
					hoverTracker.isProcessing        = false;
					return;
				}

				// Find full overlapping group
				const overlappingGroup = findOverlappingGroup(batchHoverCandidates[0]);
				const groupId = overlappingGroup.map(el => el.dataset.mwpSfeUuid).join(',');
				
				// Check if we're in the same group
				if (groupId === hoverTracker.currentGroupId) {
					// Same group - follow the directly hovered element while keeping
					// the multi-row action bar open for the existing overlap group.
					const topElement = batchHoverCandidates[0];
					if (overlayManager) {
						overlayManager.showHover(topElement);
					}

					if (overlappingGroup.length > 1 && actionBar.activeBar && actionBar.activeBar._multiElements) {
						actionBar.setMultiElementHoverAnchor(topElement);
						const focusIndex = overlappingGroup.indexOf(topElement);
						if (focusIndex !== -1 && focusIndex !== actionBar.activeBar._currentFocusIndex) {
							const rows = actionBar.activeBar.querySelectorAll('.mwp-sfe-multi-element-row');
							rows.forEach((row, idx) => {
								row.classList.toggle('mwp-sfe-focused', idx === focusIndex);
							});
							actionBar.activeBar._currentFocusIndex = focusIndex;
						}
					}

					hoverTracker.lastHoveredElements = batchHoverCandidates;
					hoverTracker.isProcessing = false;
					return;
				}

				// New group - show action bar
				hoverTracker.currentGroupId      = groupId;
				hoverTracker.bottommostElement   = overlappingGroup[0]; // First is bottommost
				hoverTracker.lastHoveredElements = batchHoverCandidates;

				if (overlappingGroup.length === 1) {
					// Single element
					if (overlayManager) overlayManager.showHover(overlappingGroup[0]);
					actionBar.show(
						overlappingGroup[0], 
						overlappingGroup[0]._mwpSfeHandlers, 
						overlappingGroup[0]._mwpSfeUuid
					);
				} else {
					// Multiple overlapping elements - keep the full group, but anchor
					// the action bar to the exact element under the pointer.
					if (overlayManager) overlayManager.showHover(batchHoverCandidates[0]);
					actionBar.showMultiple(overlappingGroup, batchHoverCandidates[0]);
				}
				
				hoverTracker.isProcessing = false;
			});
		};
		
		attachEventListener(element, 'mousemove', mouseMoveHandler, 'mwpSfeMouseMove');
		
		// Global mousemove to detect leaving all elements
		const globalMouseMoveHandler = function(e) {
			if (!isInlineUIEnabled()) return;

			// Suppress hover-state changes while a save is in progress.
			if (ctx.isSaving) return;

			// Always update current mouse position globally
			// This ensures the delayed timeout in the element handler has accurate position data
			hoverTracker.currentMousePos = { x: e.clientX, y: e.clientY };
			if (isUiDragActive()) return;
			if (actionBar.isPointerInHoverTransferCorridor(e.clientX, e.clientY)) return;
			
			const elementsAtPoint    = document.elementsFromPoint(e.clientX, e.clientY);
			const hasEditableElement = elementsAtPoint.some(el => el.dataset.mwpSfeBound === '1');
			const hoveringActionBar  = elementsAtPoint.some(el => 
				el.classList.contains('mwp-sfe-inline-actions') || el.closest('.mwp-sfe-inline-actions')
			);
			
			if (!hasEditableElement && !hoveringActionBar && hoverTracker.lastHoveredElements.length > 0) {
				if (overlayManager) overlayManager.hideHover();

				// In batch mode with an active editor (or while the session is still
				// loading - isEnabled=true but isSessionActive=false), keep the action
				// bar visible on the active element - only hide the hover overlay.
				// Mirrors the dual check used in ElementState.markActive and in the
				// isBatchEditing() helper above.
				const bm = SFE.BatchEditManager || null;
				const batchEditing = !!(
					bm &&
					SFE.Context.activeEditor &&
					(
						(typeof bm.isSessionActive === 'function' && bm.isSessionActive()) ||
						(typeof bm.isEnabled === 'function' && bm.isEnabled())
					)
				);
				if (!batchEditing) {
					actionBar.hide();
				}

				hoverTracker.lastHoveredElements = [];
				hoverTracker.currentGroupId      = null;
				hoverTracker.bottommostElement   = null;
			}
		};
		
		// Attach global handler only once - store reference for later cleanup
		if (!document.body._mwpSfeGlobalMouseMove) {
			document.body._mwpSfeGlobalMouseMove = globalMouseMoveHandler;
			document.body.addEventListener('mousemove', globalMouseMoveHandler);
		}

		// Track where the latest pointer press started so close-on-click decisions
		// can be based on interaction origin (mousedown), not click target.
		if (!document.body._mwpSfeGlobalMouseDown) {
			document.body._mwpSfeGlobalMouseDown = function(e) {
				const ctx = SFE.Context || {};
				const activeEl = ctx.activeEditor && ctx.activeEditor.element;
				const startedInActiveEditor = !!(activeEl && activeEl.contains(e.target));
				const startedInControl = !!(e.target && e.target.closest && e.target.closest('[data-mwp-sfe-control]'));
				const startedInEditable = !!(e.target && e.target.closest && e.target.closest('[data-mwp-sfe-bound="1"]'));

				document.body._mwpSfeMouseDownMeta = {
					startedInActiveEditor,
					startedInControl,
					startedInEditable
				};
			};
			document.body.addEventListener('mousedown', document.body._mwpSfeGlobalMouseDown, true);
		}

		// Global click handler: in batch mode, clicking outside the active editing
		// element (and outside plugin controls) should close that editor and keep
		// changes - mirroring the behavior of switching to another element.
		if (!document.body._mwpSfeGlobalClick) {
			const globalClickHandler = function(e) {
				const ctx  = SFE.Context;
				const body = document.body;

				// In preview states we preserve the active editor/session and allow
				// normal page interaction; outside clicks must never auto-close.
				if (
					ctx.isInlineUIEnabled === false ||
					body.classList.contains('mwp-sfe-active-preview') ||
					body.classList.contains('mwp-sfe-preview-mode')
				) {
					return;
				}

				// Comment mode and draft preview are locked - only Cancel/Escape can exit.
				// Block ALL external clicks unconditionally, regardless of batch state.
				// (Draft editing is also locked but handled below via draftEditState.)
				if (ctx.activeMode === 'comment' || ctx.activeMode === 'draft') {
					if (!e.target.closest('[data-mwp-sfe-control]')) {
						e.preventDefault();
						e.stopImmediatePropagation();
					}
					return;
				}

				// Draft editing is also locked (activeEditor IS set in this case, but
				// draftEditState distinguishes it from a regular editor).
				if (ctx.draftEditState) return;

				// Never auto-close the active editor while a save is already in flight.
				if (ctx.isSaving) return;

				// Below: batch-only logic - clicking outside active editor saves and closes.
				const bm = SFE.BatchEditManager || null;
				if (!bm || !bm.isSessionActive()) return;
				if (!ctx.activeEditor) return;

				// Ignore clicks on plugin controls (toolbar, action bar, overlays, etc.)
				if (e.target.closest('[data-mwp-sfe-control]')) return;

				// Ignore clicks inside the element currently being edited
				const activeEl = ctx.activeEditor.element;
				if (activeEl && activeEl.contains(e.target)) return;

				// Auto-close is origin-based: only close when the interaction STARTED
				// outside editor/UI/editable regions. This prevents drag-select releases
				// from link/file controls from being misclassified as outside clicks.
				const downMeta = document.body._mwpSfeMouseDownMeta || null;
				if (
					downMeta &&
					(
						downMeta.startedInActiveEditor ||
						downMeta.startedInControl ||
						downMeta.startedInEditable
					)
				) {
					return;
				}

				// Ignore clicks on other editable elements - their own click handler
				// will call startOrSwitchEditing which switches the active editor.
				if (e.target.closest('[data-mwp-sfe-bound="1"]')) return;

				// Clicked outside everything - save changes accumulated so far and
				// close the editor (restoreOriginal = false → keep edits in dirty map).
				const didClose = SFE.closeInPlaceEditor(
					ctx.activeEditor,
					false,
					{ closeReason: 'outside-click' }
				);
				if (didClose === false) {
					e.preventDefault();
					e.stopImmediatePropagation();
				}
			};
			document.body._mwpSfeGlobalClick = globalClickHandler;
			// Use capture so it fires before element click handlers
			document.body.addEventListener('click', globalClickHandler, true);
		}

		// Dedicated position tracker on document capture phase - fires before any
		// stopPropagation in the editor tree, keeping currentMousePos accurate
		// even when the editor absorbs mousemove events during active editing.
		if (!document._mwpSfePosTracker) {
			document._mwpSfePosTracker = (e) => {
				hoverTracker.currentMousePos = { x: e.clientX, y: e.clientY };
			};
			document.addEventListener('mousemove', document._mwpSfePosTracker, true);
		}

		// Click listener
		const clickHandler = function(e) {
			if (!isInlineUIEnabled()) return;

			// Ignore clicks on plugin controls (toolbar, action bar, overlays...)
			if (e.target.closest('[data-mwp-sfe-control]')) return;

			// Capture runs from outer -> inner; when a nested editable element was
			// actually clicked, let its own handler decide and avoid hijacking on
			// the ancestor.
			const clickedBound = e.target.closest('[data-mwp-sfe-bound="1"]');
			if (clickedBound && clickedBound !== element && element.contains(clickedBound)) {
				return;
			}

			// If this element is the one currently being edited, absorb the click
			// and stop propagation so ancestor elements (e.g. a Cover block wrapping
			// a Paragraph block) don't also receive it and try to switch editors.
			if (element.classList.contains('mwp-sfe-element-active')) {
				// Media editors should never forward clicks into page/lightbox handlers.
				if (ctx.activeEditor && ctx.activeEditor.isMediaEditor) {
					e.preventDefault();
					e.stopImmediatePropagation();
					return;
				}
				// For text/container editors, allow native click/default behavior
				// (e.g. <summary> toggling inside details/accordion blocks).
				return;
			}

			// If this element is an ancestor of the active editor element and the
			// click landed inside the active editor's DOM subtree, the visible area
			// at the click coordinates is occupied by the active editor - don't
			// treat this as a click on the outer (ancestor) element.
			// Example: clicking inside a Paragraph editor that lives inside a Cover
			// block should not switch the active editor to the Cover block.
			const _ctx = SFE.Context;
			if (_ctx.activeEditor && _ctx.activeEditor.element) {
				const _activeEl = _ctx.activeEditor.element;
				if (
					element !== _activeEl &&
					element.contains(_activeEl) &&
					_activeEl.contains(e.target)
				) {
					e.stopPropagation();
					return;
				}
			}

			const batchManager = SFE.BatchEditManager || null;
			const batchSessionActive = (
				batchManager &&
				typeof batchManager.isSessionActive === 'function' &&
				batchManager.isSessionActive()
			);

			// Block all element-open clicks while a save is in progress.
			if (ctx && ctx.isSaving) {
				e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}

			// In single-edit mode, prevent interruption while another element is active.
			if (!batchSessionActive && document.querySelector('.mwp-sfe-element-active')) {
				e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}

			// Comment mode and draft mode (preview or editing) must only be exited via
			// Cancel or Escape - never by clicking another element.
			// activeMode === 'draft' covers draft PREVIEW (draftEditState is null then).
			// draftEditState covers draft EDITING (activeMode is cleared by openEditorInternal).
			if (ctx.activeMode === 'comment' || ctx.activeMode === 'draft' || ctx.draftEditState) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			e.preventDefault();
			e.stopImmediatePropagation();

			// Block pending draft and comment-only interaction when another editor is active
			// in a batch session - the user must close the active editor first.
			// Lock status is read from the overlay's data-status, not the element itself.
			if (batchSessionActive && SFE.Context.activeEditor) {
				const _status = overlayManager ? overlayManager.getElementStatus(element) : null;
				if (_status === 'pending' || _status === 'comment-only') return;
			}
			
			const isPending = element.classList.contains('mwp-sfe-status-pending');
			if (isPending) {
				// Always call loadPendingDraft directly - never route through startEditing/
				// batchManager for drafts, as the batch manager ignores the 'draft' mode
				// and would try to open a regular editor instead.
				const loadDraft = SFE.DraftManager?.loadPendingDraft || SFE.loadPendingDraft;
				if (typeof loadDraft === 'function') {
					loadDraft(null, element, uuid, sortedHandlers);
				}
			} else {
				const editHandler = sortedHandlers.find(h => h.capability === 'edit');
				const commentHandler = sortedHandlers.find(h => h.capability === 'comment');
				
				if (editHandler) {
					ctx.activeMode = 'edit';
					SFE.startEditing(element, editHandler, uuid, e, false, ctx.activeMode);
				} else if (commentHandler) {
					// Comment-only element: Start commenting directly
					const bar = actionBar.show(element, sortedHandlers, uuid);
					if (bar) SFE.startCommenting(bar, element, sortedHandlers, uuid);
				}
			}
		};

		// Clear mode
		ctx.activeMode = null;

		attachEventListener(element, 'click', clickHandler, 'mwpSfeClick', true);

		// Store cleanup function on element for potential manual cleanup
		element._mwpSfeCleanup = () => {
			removeEventListener(element, 'mousemove', 'mwpSfeMouseMove');
			// No need to remove global handler as it's shared
		};
	}

	SFE.HoverManager = { attachActionBarToElement, findOverlappingGroup };

})();
