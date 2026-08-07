/**
 * Save manager - handleInlineSave and showInlineSuccess
 *
 * Reads (via globals set by earlier modules):
 *   SFE.Context                  - .activeEditor (r/w), .draftEditState (r/w),
 *                                  .pageRevisionToken (r/w), .uuidMap,
 *                                  .actionBar
 *   SFE.ElementState             - .ElementState
 *   SFE.Api                      - .apiCall
 *   SFE.BlockSerializer          - .buildBlockPayload
 *   SFE.ListBlockTracker
 *   SFE.ElementUpdater           - .applyNewHTML
 *   SFE.TIMING
 *   SFE.SaveHelpers              - .setButtonLoading, .clearButtonLoading,
 *                                  .lockSaveUI, .unlockSaveUI,
 *                                  .createSuccessElement,
 *                                  .handleRevisionConflict,
 *                                  .updatePageRevisionToken
 *   SFE.PostLockManager          - .ensureLock
 *   SFE.ManagerData              - .postId, .permissions
 *   SFE.restoreElementContent    - set by EditorLifecycle.js
 *   SFE.rebindChildren           - set by EditorLifecycle.js
 *   SFE.attachActionBarToElement - set by frontend-inline-edit.js (via HoverManager)
 *
 * Exposes: SFE.SaveManager  { handleInlineSave, showInlineSuccess }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	function getSaveHooks() {
		return SFE.SaveHooks || null;
	}

	function getProDraftApi() {
		return SFE.PRO?.DraftApi || null;
	}

	function resolveSaveStrategy(editorState) {
		let strategy = editorState?.saveStrategy || 'single';
		const hooks  = getSaveHooks();

		if (hooks && typeof hooks.resolveStrategy === 'function') {
			try {
				const override = hooks.resolveStrategy({
					strategy,
					editorState
				});
				if (override === 'single' || override === 'batch') {
					strategy = override;
				}
			} catch (error) {
				console.warn('FrontEdit: save strategy hook failed', error);
			}
		}

		return strategy;
	}

	async function runSaveHook(hookName, payload) {
		const hooks = getSaveHooks();
		if (!hooks || typeof hooks[hookName] !== 'function') return;
		try {
			await hooks[hookName](payload);
		} catch (error) {
			console.warn(`FrontEdit: save hook ${hookName} failed`, error);
		}
	}

	/**
	 * Read the cached published baseline HTML for a block, if one has been
	 * captured during this page lifecycle.
	 *
	 * @param   {string} uuid Block UUID.
	 * @returns {string}      Cached outer HTML snapshot or an empty string.
	 */
	function getPublishedBaselineHTML(uuid) {
		if (!uuid || !SFE.Context?.uuidMap?.[uuid]) return '';
		const cached = SFE.Context.uuidMap[uuid].publishedBaselineOuterHTML;
		return (typeof cached === 'string' && cached.trim()) ? cached : '';
	}

	/**
	 * Restore the draft-submit display element from the cached published
	 * baseline when available, falling back to the per-editor restore snapshot.
	 *
	 * @param   {Object}  editorState Editor state for the active save session.
	 * @returns {Element}             The restored element.
	 */
	function restoreDraftSubmittedElement(editorState) {
		const baselineHTML = getPublishedBaselineHTML(editorState?.uuid);
		if (!baselineHTML) {
			return SFE.restoreElementContent(editorState.element, editorState);
		}

		const temp = document.createElement('div');
		temp.innerHTML = baselineHTML;
		const restoredElement = temp.firstElementChild;
		if (!restoredElement || !editorState?.element?.parentNode) {
			return SFE.restoreElementContent(editorState.element, editorState);
		}

		editorState.element.parentNode.replaceChild(restoredElement, editorState.element);
		return restoredElement;
	}

	/**
	 * Destroy persisted block edit sessions after one successful save lifecycle.
	 *
	 * Saving ends the block session entirely, so any cached undo history for the
	 * saved UUIDs must be discarded before the next editor open starts fresh.
	 *
	 * @param {string|string[]} uuids One UUID or a list of UUIDs to destroy.
	 * @returns {void}
	 */
	function destroySavedBlockSessions(uuids) {
		const list = Array.isArray(uuids) ? uuids : [uuids];
		if (typeof SFE.destroyPersistedBlockEditSessions === 'function') {
			SFE.destroyPersistedBlockEditSessions(list);
			return;
		}

		if (typeof SFE.destroyPersistedBlockEditSession !== 'function') {
			return;
		}

		list.forEach((uuid) => {
			SFE.destroyPersistedBlockEditSession(uuid);
		});
	}

	async function handleInlineSave(editorState) {
		const ctx                   = SFE.Context;
		const publicApiBridge       = SFE.PublicApiBridge || null;
		const { apiCall, ensureResolvedMediaAttributes } = SFE.Api;
		const { buildBlockPayload } = SFE.BlockSerializer;
		const {
			setButtonLoading,
			clearButtonLoading,
			lockSaveUI,
			unlockSaveUI,
			handleRevisionConflict,
			updatePageRevisionToken,
			fetchRenderedBlockHTML,
			reloadAfterRefreshFailure
		}                           = SFE.SaveHelpers;
		const TIMING                = SFE.TIMING;
		const postId                = SFE.ManagerData.postId;
		const perms                 = SFE.ManagerData.permissions || {};
		const uuidMap               = ctx.uuidMap;
		const batchManager          = SFE.BatchEditManager || null;
		const proDraftApi           = getProDraftApi();
		const saveStrategy          = resolveSaveStrategy(editorState);
		const strategyPayload       = { strategy: saveStrategy, editorState };

		if (publicApiBridge) {
			publicApiBridge.emitSaveEvent('save:before', editorState, {
				source: 'sfe',
				saveStrategy,
			});
		}

		await runSaveHook('beforeSave', strategyPayload);

		if (
			saveStrategy === 'batch' &&
			batchManager &&
			typeof batchManager.isSessionActive === 'function' &&
			batchManager.isSessionActive()
		) {
			const saveBtn   = editorState.actionsContainer?.querySelector('.mwp-sfe-btn-primary-inline') || null;
			const cancelBtn = editorState.actionsContainer?.querySelector('.mwp-sfe-btn-secondary-inline') || null;

			if (cancelBtn) cancelBtn.disabled = true;

			try {
				await batchManager.handleBatchSave(saveBtn);
				if (publicApiBridge) {
					publicApiBridge.emitSaveEvent('save:after', editorState, {
						source: 'sfe',
						saveStrategy,
						success: true,
					});
				}
				await runSaveHook('afterSave', { ...strategyPayload, success: true });
			} finally {
				// Re-enable the Cancel button in case save failed before showInlineSuccess could clean up the editor.
				if (cancelBtn) cancelBtn.disabled = false;
			}
			return;
		}

		// Build canonical block payload via wp.blocks API (serialize → parse round-trip)
		try {
			if (typeof ensureResolvedMediaAttributes === 'function') {
				await ensureResolvedMediaAttributes(editorState);
			}
		} catch (error) {
			console.error('FrontEdit: resolveMediaAttributes failed:', error);
			alert('Error saving: ' + error.message);
			return;
		}

		let payloadContent;
		try {
			const blockStructure = buildBlockPayload( editorState.element, editorState );
			if ( !blockStructure ) {
				alert( 'Error saving: Could not build block structure. Please refresh and try again.' );
				return;
			}
			payloadContent = JSON.stringify( blockStructure );
		} catch ( error ) {
			console.error( 'FrontEdit: buildBlockPayload failed:', error );
			alert( 'Error saving: ' + error.message );
			return;
		}
		
		// Show loading state
		const saveBtn      = editorState.actionsContainer.querySelector('.mwp-sfe-btn-primary-inline');
		const cancelBtn    = editorState.actionsContainer.querySelector('.mwp-sfe-btn-secondary-inline');
		const originalText = saveBtn.textContent;

		lockSaveUI(saveBtn);
		if (cancelBtn) cancelBtn.disabled = true;
		
		// Check if we're editing a draft
		const draftEditState = ctx.draftEditState;
		const isEditingDraft = draftEditState && draftEditState.draftElement === editorState.element;
		
		saveBtn.textContent = perms.can_publish ? 'Saving...' : 'Submitting...';
		
		// Helper to restore save button to clickable state on any failure path
		const restoreSaveBtn = () => {
			unlockSaveUI(saveBtn);
			saveBtn.textContent = originalText;
			if (cancelBtn) cancelBtn.disabled = false;
		};
		
		// Handle based on permissions and draft state
		if (perms.can_publish) {
			if (!await SFE.PostLockManager.ensureLock()) {
				restoreSaveBtn();
				return;
			}

			try {
				if (isEditingDraft && draftEditState.version) {
					if (!proDraftApi || typeof proDraftApi.approveWithEdit !== 'function') {
						throw new Error('Draft approve-with-edit is unavailable.');
					}
					const approveResult = await proDraftApi.approveWithEdit({
						post_id:             postId,
						element_uuid:        editorState.uuid,
						version:             draftEditState.version,
						new_content:         payloadContent,
						page_revision_token: ctx.pageRevisionToken  // conflict detection
					});
					// Update token so subsequent saves don't false-conflict against our own revision.
					updatePageRevisionToken(approveResult);
					ctx.draftEditState = null;
				} else {
					const applyResult = await apiCall('/apply', {
						post_id:             postId,
						element_uuid:        editorState.uuid,
						handler_id:          editorState.handler.id,
						edit_content:        payloadContent,
						page_revision_token: ctx.pageRevisionToken
					});
					// Update token to the revision the plugin just created, so subsequent
					// inline saves in this session don't false-conflict against our own revision.
					updatePageRevisionToken(applyResult);
				}

				const refreshedHTML = await fetchRenderedBlockHTML(editorState.uuid, { force: true });

				if (refreshedHTML) {
					destroySavedBlockSessions(editorState.uuid);
					showInlineSuccess(editorState, 'Changes Saved', refreshedHTML);
					if (publicApiBridge) {
						publicApiBridge.emitSaveEvent('save:after', editorState, {
							source: 'sfe',
							saveStrategy,
							success: true,
						});
					}
					await runSaveHook('afterSave', { ...strategyPayload, success: true });
				} else {
					reloadAfterRefreshFailure('FrontEdit: Save succeeded but refreshed block HTML was unavailable.');
					return;
				}

			} catch (error) {
				if (error.message === 'POST_LOCKED') {
					await SFE.PostLockManager?.handleLockedError(error);
					restoreSaveBtn();
					return;
				}
				if (error.message === 'BLOCK_HTML_REFRESH_FAILED') {
					reloadAfterRefreshFailure('FrontEdit: Save succeeded but refreshed block HTML could not be extracted from the post render.');
					return;
				}
				if (error.message === 'REVISION_CONFLICT') {
					if (publicApiBridge) {
						publicApiBridge.emitSaveEvent('save:error', editorState, {
							source: 'sfe',
							saveStrategy,
							message: 'REVISION_CONFLICT',
						});
					}
					const shouldRetry = await handleRevisionConflict(restoreSaveBtn);
					if (!shouldRetry) return;

					// Retry without token - server skips conflict check when token is absent.
					// Use the same endpoint that originally triggered the conflict.
					try {
						if (isEditingDraft && draftEditState.version) {
							if (!proDraftApi || typeof proDraftApi.approveWithEdit !== 'function') {
								throw new Error('Draft approve-with-edit is unavailable.');
							}
							await proDraftApi.approveWithEdit({
								post_id:      postId,
								element_uuid: editorState.uuid,
								version:      draftEditState.version,
								new_content:  payloadContent
								// No token - force approve
							});
							ctx.draftEditState = null;
						} else {
							await apiCall('/apply', {
								post_id:      postId,
								element_uuid: editorState.uuid,
								handler_id:   editorState.handler.id,
								edit_content: payloadContent
								// No token - force save
							});
						}
						const refreshedHTML = await fetchRenderedBlockHTML(editorState.uuid, { force: true });
						if (refreshedHTML) {
							destroySavedBlockSessions(editorState.uuid);
							showInlineSuccess(
								editorState,
								'Changes Saved',
								refreshedHTML,
								false,
								'success',
								{ reloadAfterSuccess: true }
							);
							if (publicApiBridge) {
								publicApiBridge.emitSaveEvent('save:after', editorState, {
									source: 'sfe',
									saveStrategy,
									success: true,
								});
							}
							await runSaveHook('afterSave', { ...strategyPayload, success: true });
						} else {
							reloadAfterRefreshFailure('FrontEdit: Retry save succeeded but refreshed block HTML was unavailable.');
							return;
						}
					} catch (retryError) {
						if (retryError.message === 'BLOCK_HTML_REFRESH_FAILED') {
							reloadAfterRefreshFailure('FrontEdit: Retry save succeeded but refreshed block HTML could not be extracted from the post render.');
							return;
						}
						console.error('Save failed on retry:', retryError);
						if (publicApiBridge) {
							publicApiBridge.emitSaveEvent('save:error', editorState, {
								source: 'sfe',
								saveStrategy,
								message: String(retryError.message || 'SAVE_FAILED'),
							});
						}
						if ( retryError.message && retryError.message.indexOf( '403' ) !== -1 ) {
							alert( 'You no longer have permission to save. Your publish access may have been changed. Please refresh the page.' );
						} else {
							alert('Error: ' + retryError.message);
						}
						restoreSaveBtn();
					}
					return;
				}
				console.error('Save failed:', error);
				if (publicApiBridge) {
					publicApiBridge.emitSaveEvent('save:error', editorState, {
						source: 'sfe',
						saveStrategy,
						message: String(error.message || 'SAVE_FAILED'),
					});
				}
				if ( error.message && error.message.indexOf( '403' ) !== -1 ) {
					alert( 'You no longer have permission to save. Your publish access may have been changed. Please refresh the page.' );
				} else {
					alert('Error: ' + error.message);
				}
				restoreSaveBtn();
			}
		} else if (perms.can_draft) {
			try {
				if (!proDraftApi || typeof proDraftApi.submitDraft !== 'function') {
					throw new Error('Draft submission is unavailable.');
				}
				const data = await proDraftApi.submitDraft({
					post_id:      postId,
					element_uuid: editorState.uuid,
					handler_id:   editorState.handler.id,
					edit_content: payloadContent
				});

				editorState.element.classList.add('mwp-sfe-status-pending');
				if (uuidMap[editorState.uuid]) {
					uuidMap[editorState.uuid].is_pending = true;
					uuidMap[editorState.uuid].pending_info = {
						version: data.entry.version,
						user:    data.entry.user_name,
						date:    new Date(data.entry.timestamp * 1000).toLocaleString()
					};
				}

				showInlineSuccess(
					editorState,
					`Draft Submitted (Version ${data.entry.version})`,
					null,
					true,
					'warning'
				);
				destroySavedBlockSessions(editorState.uuid);
				if (publicApiBridge) {
					publicApiBridge.emitSaveEvent('save:after', editorState, {
						source: 'sfe',
						saveStrategy,
						success: true,
					});
				}
				await runSaveHook('afterSave', { ...strategyPayload, success: true });

			} catch (error) {
				console.error('Draft submit failed:', error);
				if (publicApiBridge) {
					publicApiBridge.emitSaveEvent('save:error', editorState, {
						source: 'sfe',
						saveStrategy,
						message: String(error.message || 'SAVE_FAILED'),
					});
				}
				alert('Error: ' + error.message);
				restoreSaveBtn();
			}
		}
	}

	/**
	 * Show success message and update element
	 * Handles both simple comments and complex save/draft operations
	 */
	function showInlineSuccess(editorState, message, newHTML, isDraft = false, variant = 'success', options = {}) {
		const ctx                      = SFE.Context;
		const TIMING                   = SFE.TIMING;
		const ListBlockTracker         = SFE.ListBlockTracker;
		const { ElementState }         = SFE.ElementState;
		const { createSuccessElement } = SFE.SaveHelpers;
		const { applyNewHTML }         = SFE.ElementUpdater;
		const actionBar                = ctx.actionBar;
		const uuidMap                  = ctx.uuidMap;
		const shouldReloadAfterSuccess = !!options.reloadAfterSuccess;
		const reloadAfterSuccess       =
			shouldReloadAfterSuccess &&
			SFE.SaveHelpers &&
			typeof SFE.SaveHelpers.reloadPageWithGuardBypass === 'function'
				? SFE.SaveHelpers.reloadPageWithGuardBypass
				: null;

		// Detect if this is a simple comment (minimal editorState) vs complex save/draft
		const isComment = !editorState.actionsContainer;
		
		// Create and position success message (common to all types)
		const successDiv = createSuccessElement(message, variant);
		document.body.appendChild(successDiv);

		// Force a reflow before allowing transitions again
		successDiv.offsetHeight;
		successDiv.style.transition = '';
		
		// === SIMPLE PATH: Comments ===
		if (isComment) {
			// Comment cleanup already done by exitCommentMode
			// Just show message, wait, and fade out
			setTimeout(() => {
				successDiv.style.opacity = '0';
				setTimeout(() => successDiv.remove(), TIMING.SUCCESS_FADE);
			}, TIMING.SUCCESS_DISPLAY);
			return;
		}

		// === COMPLEX PATH: Save/Draft Operations ===

		// Remove any wp-elements-* styles injected into <head> for this draft preview.
		if (editorState.uuid) {
			document.querySelectorAll(`style[data-mwp-sfe-draft-uuid="${editorState.uuid}"]`)
				.forEach(el => el.remove());
		}

		// Store reference to this editor session for validation
		const thisEditorSession = editorState;
		
		// Cleanup editor resources
		if (editorState.resizeObserver) {
			editorState.resizeObserver.disconnect();
		}
		
		if (editorState.toolbarContainer) editorState.toolbarContainer.remove();
		if (editorState.actionsContainer) {
			editorState.actionsContainer.style.display = 'none';
		}
		if (editorState.previewOverlay) editorState.previewOverlay.remove();
		
		if (editorState.updatePositions) {
			window.removeEventListener('scroll', editorState.updatePositions, true);
			window.removeEventListener('resize', editorState.updatePositions);
		}
		if (editorState.updatePreviewPosition) {
			window.removeEventListener('scroll', editorState.updatePreviewPosition, true);
		}
		
		if (editorState.escapeHandler) {
			document.removeEventListener('keydown', editorState.escapeHandler);
		}
		
		if (editorState.cleanupFocus) editorState.cleanupFocus();

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
			editorState._mwpSchemaMediaSession.cleanup({ preserveChanges: true });
			delete editorState._mwpSchemaMediaSession;
		}
		if (Array.isArray(editorState.editableComponents)) {
			const elementPrep = SFE.ElementPrep || null;
			const textEditorHost = SFE.SchemaEditorHost?.resolveTextEditorHost?.(editorState) || null;
			editorState.editableComponents.forEach(component => {
				if (!component || !component.element) return;
				component.element.classList.remove(
					'mwp-sfe-inline-editor',
					'mwp-sfe-component-active',
					'mwp-sfe-editable-component'
				);
				if (elementPrep && typeof elementPrep.pruneEmptyClassAttribute === 'function') {
					elementPrep.pruneEmptyClassAttribute(component.element);
				}
				component.element.removeAttribute('contenteditable');
				component.element.removeAttribute('spellcheck');
				component.element.removeAttribute('data-mwp-sfe-editable-component');
				component.element.removeAttribute('data-mwp-sfe-active-component');
				if (textEditorHost && component.element._mwpEditor === textEditorHost) {
					delete component.element._mwpEditor;
				}
			});
		}

		// Cleanup list tracker
		if (editorState.listTracker) {
			ListBlockTracker.destroy(editorState.listTracker);
			delete editorState.listTracker;
		}

		// Cleanup media focus manager (stored on bar, not editorState)
		if (editorState.actionsContainer && editorState.actionsContainer._cleanupMediaFocus) {
			editorState.actionsContainer._cleanupMediaFocus();
			delete editorState.actionsContainer._cleanupMediaFocus;
		}
		
		if (editorState.textarea) editorState.textarea.remove();
		if (editorState.contentWrapper) editorState.contentWrapper.remove();
		
		// DON'T re-enable other elements yet - keep them disabled during animation
		
		// Update element content based on operation type
		if (isDraft) {
			// For drafts: restore the block to the cached published baseline when
			// available so repeated local draft edits do not overwrite the live
			// visitor state shown after submission. Fall back to the editor's
			// session snapshot if the baseline was never captured.
			const restoredElement = restoreDraftSubmittedElement(editorState);
			
			// Remove editing-active but KEEP element-active to prevent hover during success display.
			// IMPORTANT: restoreElementContent reconstructs from originalOuterHTML which never had
			// mwp-sfe-element-active. Without explicitly re-adding it here, the click guard
			// (document.querySelector('.mwp-sfe-element-active')) immediately returns null,
			// allowing the user to click any other element and interrupt the cleanup sequence.
			restoredElement.classList.remove('mwp-sfe-editing-active');
			restoredElement.classList.add('mwp-sfe-element-active');

			if (editorState.clearPending) {
				// Discard path: draft was rejected - element is no longer pending.
				restoredElement.classList.remove('mwp-sfe-status-pending');
				// Also clear uuidMap so the element becomes fully editable again.
				const uuidEntry = uuidMap[editorState.uuid];
				if (uuidEntry) {
					uuidEntry.is_pending = false;
					delete uuidEntry.pending_info;
				}
			} else {
				// Save-as-draft path: element is still pending review.
				restoredElement.classList.add('mwp-sfe-status-pending');
			}

			// Update reference for later use
			editorState.element = restoredElement;

			// NOTE: rebindChildren is intentionally deferred to the post-enableAllElements
			// requestAnimationFrame below - same reasoning as the non-draft path (Bug 1 fix):
			// children are new DOM nodes not in disabledElements and would become immediately
			// interactive while the success banner is still visible.
		} else {
			// For published: Replace the entire element with server-rendered HTML.
			// applyNewHTML handles the DOM swap, UUID attributes, and uuidMap cleanup.
			const newElement = applyNewHTML(editorState.element, editorState.uuid, newHTML);

			if (newElement) {
				// Keep element marked as active during success display to prevent hover.
				newElement.classList.add('mwp-sfe-element-active');

				// Update reference for reattaching action bar
				editorState.element = newElement;

				// NOTE: Do NOT call rebindChildren here. The new element's inner blocks
				// are fresh DOM nodes not in disabledElements, so they'd become interactive
				// immediately while the success animation is still running. Rebind is deferred
				// to the final cleanup block below, after enableAllElements fires.
			}
		}
		
		// Handle additional elements supplied by batch save.
		// Each item: { element, uuid, html } - the other dirty blocks beyond the active editor.
		// These have no open editor to clean up; they only need a DOM swap + lock during banner.
		const additionalNewEls = [];
		const additionalItems  = options.additionalElements || [];
		for (const item of additionalItems) {
			if (!item.element || !item.uuid || !item.html) continue;
			const newEl = applyNewHTML(item.element, item.uuid, item.html);
			if (!newEl) continue;
			// Lock during success banner (same as the primary element above).
			newEl.classList.add('mwp-sfe-element-active');
			if (isDraft) {
				newEl.classList.add('mwp-sfe-status-pending');
				if (uuidMap[item.uuid]) {
					uuidMap[item.uuid].is_pending = true;
				}
			}
			additionalNewEls.push(newEl);
		}
		
		// Animate and final cleanup
		// Store timeout ID for potential cleanup
		const successTimeoutId = setTimeout(() => {
			successDiv.style.opacity = '0';
			
			setTimeout(() => {
				successDiv.remove();
				
				// Only cleanup if no new editor session has started
				// We check if UUIDs match. Media editing uses a "mock" state object for saving
				// that is a different object reference than activeEditor, so strictly checking (===) fails.
				const activeEditor      = ctx.activeEditor;
				const isMatchingSession = activeEditor && (activeEditor === thisEditorSession || activeEditor.uuid === thisEditorSession.uuid);

				if (activeEditor === null || isMatchingSession) {
					// Now re-enable other elements
					ElementState.enableAllElements();
					
					// Centralized unlock
					let triggerBtn = null;
					if (editorState && editorState.actionsContainer) {
						triggerBtn = editorState.actionsContainer.querySelector('.mwp-sfe-btn-primary-inline');
					}
					
					if (SFE.SaveHelpers && SFE.SaveHelpers.unlockSaveUI) {
						SFE.SaveHelpers.unlockSaveUI(triggerBtn);
					} else {
						ctx.isSaving = false;
					}
					
					// Create cleanup callback (none needed for success state)
					const successCleanup = () => {
						// Hide bar using consolidated system
						if (editorState.actionsContainer) {
							actionBar.hide();
						}
					};

					// Remove active class now that we're resetting
					editorState.element.classList.remove('mwp-sfe-element-active');

					// Use consolidated exit logic (will handle restoration and smart hiding)
					actionBar.reset(
						editorState.actionsContainer,
						editorState.element,
						editorState.uuid,
						successCleanup
					);

					// Reattach click/hover action bar to the (possibly new) element
					// and rebind inner blocks NOW - after enableAllElements has fired,
					// so they enter the enabled state along with everything else.
					requestAnimationFrame(() => {
						try {
							SFE.rebindChildren(editorState.element);
							SFE.attachActionBarToElement(editorState.element);
						} catch (err) {
							console.error('FrontEdit: failed to reattach action bar after save', err);
						}
						// Rebind additional elements from batch save (if any).
						for (const el of additionalNewEls) {
							el.classList.remove('mwp-sfe-element-active');
							try {
								SFE.rebindChildren(el);
								SFE.attachActionBarToElement(el);
							} catch (err) {
								console.error('FrontEdit: failed to rebind batch element after save', err);
							}
						}
					});

					// Force clear activeEditor if it matches this session
					if (isMatchingSession) {
						ctx.activeEditor = null;
					}

					if (reloadAfterSuccess) {
						reloadAfterSuccess();
						return;
					}
				}
				// If a new editor session started, don't interfere

			}, TIMING.SUCCESS_FADE);
		}, TIMING.SUCCESS_DISPLAY);

		// Store timeout ID on editorState for cleanup
		if (editorState) {
			editorState._successTimeoutId = successTimeoutId;
		}
	}

	SFE.SaveManager = { handleInlineSave, showInlineSuccess };

})();
