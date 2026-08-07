/**
 * Editor lifecycle - open/close/cleanup/restore for all editor types
 *
 * Reads (via globals):
 *   SFE.Context                  - .activeEditor (r/w), .activeMode (r/w),
 *                                  .draftEditState (r/w), .actionBar,
 *                                  .buttonManager, .hoverTracker
 *   SFE.ElementState             - .ElementState
 *   SFE.FocusManager             - .createFocusManager
 *   SFE.PositionManager          - .positionFloatingElements
 *   SFE.OverlayManager
 *   SFE.TIMING
 *   SFE.LifecycleHelpers         - .setupDraftPreviewLifecycle
 *   SFE.attachActionBarToElement - set by frontend-inline-edit.js (via HoverManager)
 *   SFE.closeDraftPreview        - set by frontend-inline-edit.js (via DraftManager)
 *
 * Exposes:
 *   SFE.EditorLifecycle
 *     { closeInPlaceEditor, cleanupEditorResources, restoreElementState,
 *       restoreElementContent, resetActionBar, rebindChildren }
 *   SFE.closeInPlaceEditor     - direct alias for cross-module access
 *   SFE.restoreElementContent  - direct alias for cross-module access
 *   SFE.rebindChildren         - direct alias for cross-module access
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Recursively bind all nested editable elements found within a container.
	 */
	function rebindChildren(container) {
		const children = container.querySelectorAll('[data-mwp-sfe-uuid]');
		children.forEach(child => {
			if (child !== container) {
				SFE.attachActionBarToElement(child);
			}
		});
	}

	/**
	 * Restore element content on cancel.
	 *
	 * Text container (Details): restores only the heading child, not the whole block.
	 * The container root stays in place, preserving visible inner blocks.
	 *
	 * All other blocks: replaces the entire element in DOM.
	 */
	function restoreElementContent(element, editorState) {
		const restoreSnapshot = (
			typeof editorState?.originalRestoreOuterHTML === 'string' &&
			editorState.originalRestoreOuterHTML.trim()
		)
			? editorState.originalRestoreOuterHTML
			: editorState.originalOuterHTML;

		if (Array.isArray(editorState.editableComponents) && editorState.editableComponents.length) {
			// For schema multi-component blocks (tables, pullquotes, etc.), restore the
			// entire root element atomically. Restoring individual components can leave
			// malformed DOM behind when browser contenteditable normalization detaches or
			// re-parents table cells during editing.
			if (element.parentNode) {
				const temp = document.createElement('div');
				temp.innerHTML = restoreSnapshot;
				const restoredElement = temp.firstElementChild;
				if (!restoredElement) {
					console.error('FrontEdit: Failed to restore multi-component root');
					return element;
				}

				element.parentNode.replaceChild(restoredElement, element);
				editorState.editableComponents.forEach(component => {
					if (!component || typeof component.selector !== 'string') return;
					const selector = component.selector.trim();
					if (!selector) return;

					try {
						if (restoredElement.matches(selector)) {
							component.element = restoredElement;
							return;
						}
						const restoredComponent = restoredElement.querySelector(selector);
						if (restoredComponent) {
							component.element = restoredComponent;
						}
					} catch (error) {
						// Ignore invalid selectors and keep current references.
					}
				});

				return restoredElement;
			}

			editorState.editableComponents.forEach(component => {
				if (!component || !component.element) return;
				if (!component.element.parentNode) return;
				const componentRestoreSnapshot = (
					typeof component.originalRestoreOuterHTML === 'string' &&
					component.originalRestoreOuterHTML.trim()
				)
					? component.originalRestoreOuterHTML
					: component.originalOuterHTML;
				if (!componentRestoreSnapshot) return;

				const temp = document.createElement('div');
				temp.innerHTML = componentRestoreSnapshot;
				const restoredComponent = temp.firstElementChild;
				if (!restoredComponent) return;

				component.element.parentNode.replaceChild(restoredComponent, component.element);
				component.element = restoredComponent;
			});

			if (editorState.activeEditableComponent) {
				const activeId = editorState.activeEditableComponent.id;
				const restoredActive = editorState.editableComponents.find(component => component.id === activeId);
				if (restoredActive) {
					editorState.activeEditableComponent = restoredActive;
				}
			}

			return element; // block root is unchanged
		}

		if (editorState.headingElement && editorState.originalHeadingOuterHTML) {
			const temp            = document.createElement('div');
			temp.innerHTML        = editorState.originalHeadingOuterHTML;
			const restoredHeading = temp.firstElementChild;
			if (restoredHeading && editorState.headingElement.parentNode) {
				editorState.headingElement.parentNode.replaceChild(restoredHeading, editorState.headingElement);
				editorState.headingElement = restoredHeading;
			}
			return element; // container root is unchanged
		}

		const temp            = document.createElement('div');
		temp.innerHTML        = restoreSnapshot;
		const restoredElement = temp.firstElementChild;
		if (!restoredElement) {
			console.error('FrontEdit: Failed to restore element from originalOuterHTML');
			return element;
		}

		if (!element || !element.parentNode) {
			console.warn('FrontEdit: Skipped restore because the editor element is no longer attached.');
			return element;
		}

		element.parentNode.replaceChild(restoredElement, element);
		return restoredElement;
	}

	/**
	 * Remove transient editor-only attributes and references from one element.
	 *
	 * @param {HTMLElement|null} element        Element to normalize.
	 * @param {Object|null}      editorInstance Active editor instance reference.
	 * @returns {void}
	 */
	function clearTransientEditingState(element, editorInstance = null) {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) {
			return;
		}

		element.removeAttribute('contenteditable');
		element.removeAttribute('spellcheck');

		if (editorInstance && element._mwpEditor === editorInstance) {
			delete element._mwpEditor;
		}
	}

	/**
	 * Cleanup all editor resources (observers, listeners, managers).
	 *
	 * @param {Object} editorState Active editor state being torn down.
	 * @param {Object} options     Cleanup options.
	 * @returns {void}
	 */
	function cleanupEditorResources(editorState, options = {}) {
		const overlayManager   = SFE.OverlayManager;
		const schemaRuntime    = SFE.SchemaRuntime || null;
		const schemaEditorHost = SFE.SchemaEditorHost || null;
		const elementPrep      = SFE.ElementPrep || null;
		const TIMING           = SFE.TIMING;
		const { ElementState } = SFE.ElementState;
		const textEditorHost   = schemaEditorHost?.resolveTextEditorHost?.(editorState) || null;

		// Clear global reference FIRST
		if (SFE.activeEditorInstance === editorState) {
			SFE.activeEditorInstance = null;
		}

		// Cleanup managers
		if (editorState.cleanupFocus) editorState.cleanupFocus();

		// Cleanup observers and listeners
		if (editorState.resizeObserver) editorState.resizeObserver.disconnect();
		if (editorState.escapeHandler)  document.removeEventListener('keydown', editorState.escapeHandler);

		if (editorState.updatePositions) {
			window.removeEventListener('scroll', editorState.updatePositions, true);
			window.removeEventListener('resize', editorState.updatePositions);
		}

		// Remove editing class from element and action bar
		if (editorState.element) {
			editorState.element.classList.remove('mwp-sfe-inline-editor');
			clearTransientEditingState(editorState.element, textEditorHost);
		}
		const switchTarget = editorState._mwpComponentSwitchTarget || editorState.element || null;
		if (editorState.componentSwitchHandler && switchTarget) {
			switchTarget.removeEventListener('mousedown', editorState.componentSwitchHandler, true);
			delete editorState.componentSwitchHandler;
		}
		if (editorState.componentClickGuard && switchTarget) {
			switchTarget.removeEventListener('click', editorState.componentClickGuard, true);
			delete editorState.componentClickGuard;
		}
		if (editorState.componentTabHandler && switchTarget) {
			switchTarget.removeEventListener('keydown', editorState.componentTabHandler, true);
			delete editorState.componentTabHandler;
		}
		delete editorState._mwpComponentSwitchTarget;
		if (editorState._mwpSchemaMediaSession && typeof editorState._mwpSchemaMediaSession.cleanup === 'function') {
			editorState._mwpSchemaMediaSession.cleanup({
				preserveChanges: true,
				preserveToolbarDom: true,
			});
			delete editorState._mwpSchemaMediaSession;
		}
		if (Array.isArray(editorState.editableComponents)) {
			editorState.editableComponents.forEach(component => {
				if (!component || !component.element) return;
				component.element.classList.remove(
					'mwp-sfe-inline-editor',
					'mwp-sfe-component-active',
					'mwp-sfe-editable-component',
					'mwp-sfe-editor-content'
				);
				if (elementPrep && typeof elementPrep.pruneEmptyClassAttribute === 'function') {
					elementPrep.pruneEmptyClassAttribute(component.element);
				}
				component.element.removeAttribute('data-mwp-sfe-editable-component');
				component.element.removeAttribute('data-mwp-sfe-active-component');
				clearTransientEditingState(component.element, textEditorHost);

				if (
					schemaRuntime &&
					typeof schemaRuntime.syncManagedMissingComponentStateForElement === 'function' &&
					component.type === 'text'
				) {
					// Final teardown pass: prune empty optional missingUI shells now that
					// edit-mode classes/attributes have been removed from all components.
					schemaRuntime.syncManagedMissingComponentStateForElement(component.element, {
						id: typeof component.id === 'string' ? component.id.trim() : '',
						type: 'text',
						missingUI: component?.missingUI && typeof component.missingUI === 'object'
							? component.missingUI
							: null,
					}, {
						removeInactiveEmpty: true,
						forceRemoveInactive: true,
					} );
				}
			});
		}
		if (editorState.headingElement) {
			editorState.headingElement.classList.remove('mwp-sfe-inline-editor');
			clearTransientEditingState(editorState.headingElement, textEditorHost);
		}
		if (editorState.actionsContainer) {
			editorState.actionsContainer.classList.remove('mwp-sfe-inline-editor');
		}

		// Remove toolbar with animation
		if (editorState.toolbarContainer) {
			const toolbar     = editorState.toolbarContainer;
			const onCloseDone = () => {
				toolbar.remove();
			};

			toolbar.addEventListener('transitionend', onCloseDone, { once: true });
			toolbar.classList.add('mwp-sfe-closing');

			// Failsafe: force removal if transitionend doesn't fire
			// (e.g. element hidden, tab inactive) after slightly longer than CSS duration
			setTimeout(() => {
				if (toolbar && toolbar.nodeType === Node.ELEMENT_NODE && document.body.contains(toolbar)) {
					onCloseDone();
				}
			}, TIMING.SAFETY_DURATION);
		}

		// Remove preview overlay if present
		if (editorState.previewOverlay) editorState.previewOverlay.remove();

		// Destroy MWPEditor to release internal references (event listeners, history, etc.).
		// Keep the toolbar DOM mounted until the toolbarContainer close animation finishes;
		// ToolbarManager listeners are still torn down immediately.
		if (textEditorHost && typeof textEditorHost.destroy === 'function') {
			textEditorHost.destroy({ removeToolbar: false });
		}
		delete editorState.activeSchemaHost;
		delete editorState.textEditorHost;

		if (!options.skipEnableAll) {
			ElementState.enableAllElements();
		}
	}

	/**
     * Resolves the DOM element for the live editor state.
     */
	function resolveLiveEditorElement(editorState) {
		if (!editorState) return null;

		if (editorState.element && editorState.element.parentNode) {
			return editorState.element;
		}

		const uuid = String(editorState.uuid || '').trim();
		if (!uuid) {
			return editorState.element || null;
		}

		try {
			return document.querySelector(`[data-mwp-sfe-uuid="${CSS.escape(uuid)}"]`) || editorState.element || null;
		} catch (error) {
			return document.querySelector(`[data-mwp-sfe-uuid="${uuid.replace(/"/g, '\\"')}"]`) || editorState.element || null;
		}
	}

	/**
	 * Restore element to its original or current state.
	 * Returns the final element (might be a new one if the tag changed).
	 */
	function restoreElementState(editorState, restoreOriginal) {
		const { ElementState } = SFE.ElementState;
		const elementPrep      = SFE.ElementPrep || null;
		let el = resolveLiveEditorElement(editorState);

		if (el && el !== editorState.element) {
			editorState.element = el;
		}

		if (restoreOriginal) {
			el = restoreElementContent(el, editorState);
		} else {
			// Not restoring content (user kept their changes). Remove only
			// editor-specific utility classes, but preserve content classes
			// that the editor may have added - most importantly text alignment
			// classes like `has-text-align-center` set by MWPEditor.changeTextAlignment().
			// Resetting to originalClasses here would visually revert the
			// text alignment change even though it IS being saved to the block state.
			const editorOnlyClasses = [
				'mwp-sfe-inline-editor',
				'mwp-sfe-editor-content',
				'mwp-sfe-editing-active'
			];
			editorOnlyClasses.forEach(cls => el.classList.remove(cls));
			if (elementPrep && typeof elementPrep.pruneEmptyClassAttribute === 'function') {
				elementPrep.pruneEmptyClassAttribute(el);
			}
			if (editorState.originalStyles) {
				el.setAttribute('style', editorState.originalStyles);
			} else {
				el.removeAttribute('style');
			}
		}

		if (el && el.classList) {
			// ABE's staged pulse is only for the initial handoff preview. Never
			// carry it forward into cancel/close restore flows.
			el.classList.remove('mwp-abe-staged-block-pulse');
		}

		ElementState.markInactive(el);
		return el;
	}

	/**
	 * Reset action bar to hover state and reattach to element.
	 *
	 * attachActionBarToElement is called synchronously before actionBar.reset()
	 * so that data-mwp-sfe-bound is stamped by the time _resetActionBar runs
	 * its elementsFromPoint check.
	 */
	function resetActionBar(editorState, restoredElement) {
		const overlayManager = SFE.OverlayManager;
		const actionBar      = SFE.Context.actionBar;

		if (!editorState.actionsContainer) return;

		const bar = editorState.actionsContainer;

		delete bar._saveBtn;
		delete bar._cancelBtn;

		actionBar.activeElement = restoredElement;
		bar._targetElement      = restoredElement;

		// Stamp data-mwp-sfe-bound and reattach event listeners synchronously so
		// _resetActionBar's elementsFromPoint check finds the element as editable.
		//
		// Always rebind nested children too. A history undo/redo may have replaced
		// the live block subtree earlier in the session without a subsequent close-
		// time root replacement, which leaves innerBlocks on fresh DOM nodes with
		// no hover/action-bar listeners until they are explicitly rebound here.
		try {
			SFE.attachActionBarToElement(restoredElement);
			if (restoredElement) {
				rebindChildren(restoredElement);
			}
		} catch (err) {
			console.error('FrontEdit: failed to reattach action bar after close', err);
		}

		actionBar.reset(bar, restoredElement, editorState.uuid, () => {});

		if (overlayManager) {
			requestAnimationFrame(() => overlayManager.updateAllOverlays());
		}
	}

	/**
	 * Close the in-place editor and restore element state.
	 */
	function closeInPlaceEditor(editorState, restoreOriginal, options = {}) {
		const ctx                               = SFE.Context;
		const overlayManager                    = SFE.OverlayManager;
		const { setupDraftPreviewLifecycle }    = SFE.LifecycleHelpers;
		const schemaEditorHost                  = SFE.SchemaEditorHost || null;
		const actionBar                         = ctx.actionBar;
		const buttonManager                     = ctx.buttonManager;
		const closeSource                       = String(options.source || 'sfe').trim() || 'sfe';
		const closeReason                       = String(options.closeReason || options.reason || 'close').trim() || 'close';
		const shouldPersistBlockSession         = !restoreOriginal && (closeReason === 'switch' || closeReason === 'outside-click');
		const shouldRevertPersistedBlockSession = restoreOriginal;

		if (!editorState) return;

		const batchManager = SFE.BatchEditManager || null;
		if (
			batchManager &&
			typeof batchManager.canCloseEditor === 'function' &&
			batchManager.canCloseEditor(editorState, restoreOriginal, closeReason) === false
		) {
			return false;
		}

		if (SFE.PublicApiBridge) {
			SFE.PublicApiBridge.emitEditorEvent('editor:beforeClose', editorState, {
				source: closeSource,
				reason: closeReason,
			});
		}

		if (batchManager && typeof batchManager.onEditorClose === 'function') {
			try {
				batchManager.onEditorClose(editorState, restoreOriginal);
			} catch (error) {
				console.warn('FrontEdit: batch close hook failed', error);
			}
		}

		if (shouldPersistBlockSession) {
			SFE.detachPersistedBlockEditSessionEditor?.(editorState);
		} else if (shouldRevertPersistedBlockSession) {
			const didRevertToSessionOrigin = SFE.revertPersistedBlockEditSessionToOpenPass?.(editorState.uuid) !== false;
			if (didRevertToSessionOrigin) {
				SFE.destroyPersistedBlockEditSession?.(editorState.uuid);
			} else {
				SFE.detachPersistedBlockEditSessionEditor?.(editorState);
			}
		} else {
			SFE.destroyPersistedBlockEditSession?.(editorState.uuid);
		}

		// Clean up stored attributes to prevent memory leaks
		delete editorState.originalAttributes;
		delete editorState.blockName;
		delete editorState.originalHTML;

		// Clear any pending success message timeouts
		if (editorState._successTimeoutId) {
			clearTimeout(editorState._successTimeoutId);
			delete editorState._successTimeoutId;
		}

		// ── Draft-cancel path ────────────────────────────────────────────────
		// Canceling an edit that was opened from a draft preview: skip full
		// re-enable of other elements and return to the draft preview state instead.
		if (restoreOriginal && ctx.draftEditState &&
		    ctx.draftEditState.draftElement === editorState.element) {

			const { bar, handlers, draftElement } = ctx.draftEditState;
			const uuid = editorState.uuid;
			const textEditorHost = schemaEditorHost?.resolveTextEditorHost?.(editorState) || null;

			// Minimal resource cleanup only - do NOT call ElementState.enableAllElements
			if (editorState.cleanupFocus)   editorState.cleanupFocus();
			if (editorState.resizeObserver) editorState.resizeObserver.disconnect();
			if (editorState.escapeHandler)  document.removeEventListener('keydown', editorState.escapeHandler);
			if (editorState.updatePositions) {
				window.removeEventListener('scroll', editorState.updatePositions, true);
				window.removeEventListener('resize', editorState.updatePositions);
			}
			const switchTarget = editorState._mwpComponentSwitchTarget || editorState.element || null;
			if (editorState.componentSwitchHandler && switchTarget) {
				switchTarget.removeEventListener('mousedown', editorState.componentSwitchHandler, true);
				delete editorState.componentSwitchHandler;
			}
			if (editorState.componentClickGuard && switchTarget) {
				switchTarget.removeEventListener('click', editorState.componentClickGuard, true);
				delete editorState.componentClickGuard;
			}
			if (editorState.componentTabHandler && switchTarget) {
				switchTarget.removeEventListener('keydown', editorState.componentTabHandler, true);
				delete editorState.componentTabHandler;
			}
			delete editorState._mwpComponentSwitchTarget;
			if (editorState.toolbarContainer) editorState.toolbarContainer.remove();
			if (SFE.activeEditorInstance === editorState) SFE.activeEditorInstance = null;

			// Remove only editor-specific classes, leave draft classes alone
			draftElement.classList.remove(
				'mwp-sfe-inline-editor', 'mwp-sfe-editing-active', 'mwp-sfe-editor-content'
			);
			clearTransientEditingState(draftElement, textEditorHost);

			// Restore draft preview visual state
			draftElement.classList.add('mwp-sfe-draft-active');
			if (overlayManager) overlayManager.showActive(draftElement, 'draft-preview');

			// Clean up action bar save/cancel buttons
			bar.classList.remove('mwp-sfe-state-hover', 'mwp-sfe-inline-editor');
			delete bar._saveBtn;
			delete bar._cancelBtn;

			// We are no longer in the live draft editor session. Returning to draft
			// preview should restore preview-mode lifecycle ownership and release the
			// edit-session flag used by click/close guards.
			ctx.draftEditState = null;
			ctx.activeEditor = null;
			ctx.activeMode   = 'draft';

			// Restore preview buttons
			actionBar.updateState({
				bar,
				element: draftElement,
				state:   'preview-loaded',
				content: buttonManager.getDraftPreviewButtons(
					bar, draftElement, handlers, uuid
				)
			});

			// Re-attach full draft preview lifecycle (focus, escape, scroll, resize)
			setupDraftPreviewLifecycle(bar, draftElement, handlers, uuid);

			if (SFE.PublicApiBridge) {
				SFE.PublicApiBridge.emitEditorEvent('editor:closed', editorState, {
					source: closeSource,
					reason: closeReason,
				});
			}

			return;
		}

		// ── Normal exit - full cleanup ───────────────────────────────────────
		// Clear draft state if exiting normally
		if (ctx.draftEditState && ctx.draftEditState.draftElement === editorState.element) {
			ctx.draftEditState = null;
		}

		cleanupEditorResources(editorState, options);
		const restoredElement = restoreElementState(editorState, restoreOriginal);
		ctx.activeEditor = null;
		resetActionBar(editorState, restoredElement);

		// Sever all DOM node references to allow garbage collection
		Object.keys(editorState).forEach(key => {
			if (editorState[key] instanceof HTMLElement || editorState[key] instanceof Node) {
				editorState[key] = null;
			}
		});

		// Ensure hoverTracker is not holding onto detached elements
		if (ctx.hoverTracker && ctx.hoverTracker.lastHoveredElements) {
			ctx.hoverTracker.lastHoveredElements =
				ctx.hoverTracker.lastHoveredElements.filter(el => document.body.contains(el));
		}

		if (SFE.PublicApiBridge) {
			SFE.PublicApiBridge.emitEditorEvent('editor:closed', editorState, {
				source: closeSource,
				reason: closeReason,
			});
		}

		return true;
	}

	// Place functions on window for cross-module access
	SFE.rebindChildren        = rebindChildren;
	SFE.restoreElementContent = restoreElementContent;
	SFE.closeInPlaceEditor    = closeInPlaceEditor;

	SFE.EditorLifecycle = {
		closeInPlaceEditor,
		cleanupEditorResources,
		restoreElementState,
		restoreElementContent,
		resetActionBar,
		rebindChildren
	};

})();
