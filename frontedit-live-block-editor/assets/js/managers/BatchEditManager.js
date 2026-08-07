/**
 * Batch edit manager - shared batch session orchestration
 *
 * Reads (via globals):
 *   SFE.Context
 *   SFE.Api                 - .apiCall
 *   SFE.BlockSerializer     - .buildBlockPayload
 *   SFE.BlockComparison     - .blocksAreEquivalent, .normalizeRaw
 *   SFE.ElementPrep         - .getContent
 *   SFE.ElementState        - .ElementState
 *   SFE.ElementUpdater      - .applyNewHTML, .rebindElement
 *   SFE.CommentManager      - .buildCommentForm
 *   SFE.SaveHelpers         - .setButtonLoading, .clearButtonLoading,
 *                             .lockSaveUI, .unlockSaveUI,
 *                             .createSuccessElement,
 *                             .handleRevisionConflict,
 *                             .updatePageRevisionToken
 *   SFE.TIMING
 *   SFE.closeInPlaceEditor
 *   SFE.SaveManager         - .showInlineSuccess
 *   SFE.PostLockManager     - .ensureLock
 *   SFE.ManagerData         - .postId, .permissions
 *
 * Exposes: SFE.BatchEditManager (singleton)
 *   { isEnabled, isSessionActive, ensureSession, getBlockStateForUuid,
 *     startOrSwitchEditing, captureActiveEditor, onEditorClose, handleBatchSave,
 *     startInlineCommenting }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	function getManagerData() {
		return SFE.ManagerData || {};
	}

	function buildPendingInfoFromEntry(entry) {
		if (!entry || typeof entry !== 'object') return null;

		const pendingInfo = {};
		const version = Number(entry.version);
		const timestamp = Number(entry.timestamp);

		if (Number.isFinite(version) && version > 0) {
			pendingInfo.version = version;
		}
		if (typeof entry.user_name === 'string' && entry.user_name.trim()) {
			pendingInfo.user = entry.user_name.trim();
		}
		if (Number.isFinite(timestamp) && timestamp > 0) {
			pendingInfo.date = new Date(timestamp * 1000).toLocaleString();
		}

		return Object.keys(pendingInfo).length ? pendingInfo : null;
	}

	class BatchEditManager {
		constructor() {
			this.sessionActive         = false;
			this.sessionLoadingPromise = null;
			this._sessionFailed        = false;
			this.lastCaptureError      = null;

			this.baseBlockStates    = new Map(); // uuid -> block state snapshot at session start
			this.currentBlockStates = new Map(); // uuid -> latest block state (edited)
			this.dirtyBlocks        = new Map(); // uuid -> dirty payload entry
		}

		_cloneBlockState(state) {
			if (!state) return null;
			try {
				return JSON.parse(JSON.stringify(state));
			} catch (error) {
				return { ...state };
			}
		}

		_cloneDirtyEntry(entry) {
			return entry ? { ...entry } : null;
		}

		_prepareRenderedHTMLSnapshot(uuid, html) {
			if (typeof html !== 'string') return '';
			const trimmed = html.trim();
			if (!trimmed) return '';

			const temp = document.createElement('div');
			temp.innerHTML = trimmed;
			const root = temp.firstElementChild;
			if (!root) return '';

			if (uuid && !root.dataset.mwpSfeUuid) {
				root.dataset.mwpSfeUuid = uuid;
			}
			root.dataset.mwpSfeBound = '1';

			return root.outerHTML;
		}

		_getRenderedSnapshotFromEditor(editorState, rawContent = '') {
			if (!editorState?.element) return '';

			const ElementPrep = SFE.ElementPrep || null;
			if (!ElementPrep || typeof ElementPrep.getCleanHTML !== 'function') {
				return '';
			}

			let snapshotElement = editorState.element;
			const schemaRuntime = SFE.SchemaRuntime || null;
			if (
				schemaRuntime &&
				typeof schemaRuntime.reconcileRenderedSnapshot === 'function'
			) {
				snapshotElement = editorState.element.cloneNode(true);
				schemaRuntime.reconcileRenderedSnapshot(snapshotElement, editorState.handler, {
					rawContent,
				});
			}

			return this._prepareRenderedHTMLSnapshot(
				editorState.uuid,
				ElementPrep.getCleanHTML(snapshotElement, true)
			);
		}

		_captureEditorOpenBaseline(editorState) {
			if (!editorState || !editorState.uuid || editorState._batchBaselineCaptured) {
				return false;
			}

			const currentState = this.currentBlockStates.get(editorState.uuid);
			if (!currentState) return false;

			editorState._batchCommittedStateAtOpen = this._cloneBlockState(currentState);
			editorState._batchDirtyEntryAtOpen = this.dirtyBlocks.has(editorState.uuid)
				? this._cloneDirtyEntry(this.dirtyBlocks.get(editorState.uuid))
				: null;
			editorState._batchBaselineCaptured = true;

			// Preserve the HTML snapshot captured at editor entry for this specific
			// edit session. If the batch tree resolves asynchronously after the editor
			// opens, replacing originalOuterHTML here would make first-cancel restore
			// from a different source than later cancels.
			if (!editorState.originalOuterHTML && currentState.renderedHTML) {
				editorState.originalOuterHTML = currentState.renderedHTML;
			}
			if (!editorState.originalRestoreOuterHTML && currentState.renderedHTML) {
				editorState.originalRestoreOuterHTML = currentState.renderedHTML;
			}

			return true;
		}

		/**
		 * Lazily evaluate whether batch editing is enabled.
		 *
		 * Do NOT cache this at construction time - BatchEditManager.js is a
		 * dependency of mwp-sfe-frontend, so its IIFE runs before frontend.js.
		 * SFE.ManagerData is injected before this dependency chain,
		 * so it is available when these methods are called (not at construction).
		 */
		isEnabled() {
			if (this._sessionFailed) return false;
			const data    = getManagerData();
			const perms   = data.permissions || {};
			return !!perms.can_batch;
		}

		isSessionActive() {
			return this.sessionActive;
		}

		async ensureSession() {
			if (!this.isEnabled()) return false;
			if (this.sessionActive) return true;
			if (this.sessionLoadingPromise) return this.sessionLoadingPromise;

			const { apiCall } = SFE.Api;
			const ctx         = SFE.Context;
			const postId      = getManagerData().postId;

			this.sessionLoadingPromise = (async () => {
				try {
					const data     = await apiCall('/get-page-block-tree', { post_id: postId });
					const elements = data.elements || {};

					this.baseBlockStates.clear();
					this.currentBlockStates.clear();
					this.dirtyBlocks.clear();

					Object.entries(elements).forEach(([uuid, state]) => {
						const normalized = this._normalizeBlockState(uuid, state);
						this.baseBlockStates.set(uuid, normalized);
						this.currentBlockStates.set(uuid, { ...normalized });
					});

					// Do NOT call updatePageRevisionToken here. The page-load token
					// set in localize_data is the authoritative baseline for conflict
					// detection on this session. Overwriting it with the server's
					// current token at session-start time would silently mask any
					// backend save that happened between page load and the first editor
					// click, defeating the entire purpose of the revision token.

					this.sessionActive = true;
					document.body.classList.add('mwp-sfe-batch-session-active');
					return true;
				} catch (error) {
					console.warn('FrontEdit: Failed to initialize batch session, falling back to single mode.', error);
					this._sessionFailed = true;
					this.sessionActive  = false;
					document.body.classList.remove('mwp-sfe-batch-session-active');
					return false;
				} finally {
					this.sessionLoadingPromise = null;
				}
			})();

			return this.sessionLoadingPromise;
		}

		_normalizeBlockState(uuid, state) {
			const normalized = {
				uuid,
				attrs: state?.attrs || {},
				blockName: state?.blockName || '',
				innerHTML: state?.innerHTML || '',
				innerBlocks: state?.innerBlocks || [],
				innerContent: state?.innerContent || [],
				html: state?.html || '',
				renderedHTML: this._prepareRenderedHTMLSnapshot(uuid, state?.renderedHTML || state?.html || ''),
				rawContent: state?.rawContent || ''
			};

			if (!normalized.rawContent && state?.serialized) {
				normalized.rawContent = state.serialized;
			}

			return normalized;
		}

		getBlockStateForUuid(uuid) {
			const state = this.currentBlockStates.get(uuid);
			if (!state) return null;
			return this._cloneBlockState(state);
		}

		registerEditor(editorState) {
			if (!editorState || !editorState.element) return;
			this._captureEditorOpenBaseline(editorState);

			// Debounced capture keeps dirty map in sync without waiting for blur.
			const debouncedCapture = this._debounce(() => {
				this.captureEditorState(editorState, 'input');
			}, 1000);

			editorState._batchInputCapture = debouncedCapture;
			editorState._batchInputCaptureElement = editorState.element;
			editorState.element.addEventListener('input', debouncedCapture);
		}

		unregisterEditor(editorState) {
			if (!editorState) return;
			if (editorState._batchInputCapture) {
				const captureElement = editorState._batchInputCaptureElement || editorState.element || null;
				if (captureElement && typeof captureElement.removeEventListener === 'function') {
					captureElement.removeEventListener('input', editorState._batchInputCapture);
				}
				if (typeof editorState._batchInputCapture.cancel === 'function') {
					editorState._batchInputCapture.cancel();
				}
				delete editorState._batchInputCapture;
			}
			delete editorState._batchInputCaptureElement;
		}

		canCloseEditor(editorState, restoreOriginal = false, closeReason = 'close') {
			if (!this.sessionActive || !editorState || !editorState.uuid) return true;
			if (restoreOriginal) return true;

			this.lastCaptureError = null;
			this.captureEditorState(editorState, closeReason);
			if (!this.lastCaptureError) {
				editorState._batchCloseCaptureReason = closeReason;
				return true;
			}

			let message = this.lastCaptureError.message || 'This change cannot be saved.';
			const needsRestoreHint = (
				/cannot be empty|cannot be saved empty/i.test(message) &&
				!/add some text or cancel to restore original/i.test(message)
			);
			if (needsRestoreHint) {
				message += ' Add some text or cancel to restore original.';
			}

			alert(message);
			return false;
		}

		onEditorClose(editorState, restoreOriginal) {
			if (!this.sessionActive || !editorState || !editorState.uuid) return;
			const uuid = editorState.uuid;

			if (restoreOriginal) {
				if (editorState._batchCommittedStateAtOpen) {
					this.currentBlockStates.set(
						uuid,
						this._cloneBlockState(editorState._batchCommittedStateAtOpen)
					);
				}

				if (editorState._batchDirtyEntryAtOpen) {
					this.dirtyBlocks.set(
						uuid,
						this._cloneDirtyEntry(editorState._batchDirtyEntryAtOpen)
					);
				} else {
					this.dirtyBlocks.delete(uuid);
				}
			} else {
				if (!editorState._batchCloseCaptureReason) {
					this.captureEditorState(editorState, 'close');
				}
			}

			this.unregisterEditor(editorState);
			delete editorState._batchCloseCaptureReason;
			delete editorState._batchCommittedStateAtOpen;
			delete editorState._batchDirtyEntryAtOpen;
			delete editorState._batchBaselineCaptured;
		}

		_debounce(fn, wait) {
			let timeoutId = null;
			const debounced = function() {
				clearTimeout(timeoutId);
				timeoutId = setTimeout(fn, wait);
			};
			debounced.cancel = function() {
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
			};
			return debounced;
		}

		captureActiveEditor(reason = 'manual') {
			const ctx = SFE.Context;
			if (!ctx.activeEditor) return null;
			return this.captureEditorState(ctx.activeEditor, reason);
		}

		captureEditorState(editorState, reason = 'manual') {
			if (!this.sessionActive || !editorState || !editorState.uuid) return null;

			const { buildBlockPayload }   = SFE.BlockSerializer;
			const { blocksAreEquivalent } = SFE.BlockComparison;

			let payload;
			try {
				payload = buildBlockPayload(editorState.element, editorState);
			} catch (error) {
				this.lastCaptureError = error;
				return null;
			}

			if (!payload || !payload.rawContent) return null;

			this.lastCaptureError = null;

			const uuid        = editorState.uuid;
			const beforeState = this.baseBlockStates.get(uuid);
			const beforeRaw   = beforeState?.rawContent || editorState.blockState?.rawContent || '';
			const afterRaw    = payload.rawContent;
			const renderedHTML = this._getRenderedSnapshotFromEditor(editorState, afterRaw);

			const edit_content = JSON.stringify(payload);

			// Keep cached block state current for subsequent editor openings.
			this._hydrateCurrentStateFromRaw(uuid, afterRaw, renderedHTML);

			// Fast path: exact match.  Slow path: full-tree UUID-attr normalization.
			// Mirrors the PHP rest_apply_batch() comparison strategy so the client
			// pre-filters no-op edits before they reach the server.
			if (beforeRaw && blocksAreEquivalent(beforeRaw, afterRaw)) {
				this.dirtyBlocks.delete(uuid);
				return null;
			}

			const entry = {
				element_uuid: uuid,
				handler_id:   editorState.handler?.id || '',
				blockName:    editorState.blockName || editorState.blockState?.blockName || '',
				before:       beforeRaw,
				after:        afterRaw,
				edit_content,
				changedAt:    Date.now()
			};

			this.dirtyBlocks.set(uuid, entry);
			return entry;
		}

		_hydrateCurrentStateFromRaw(uuid, rawContent, renderedHTML = '') {
			if (!rawContent || !window.wp?.blocks?.parse) return;
			const existingState = this.currentBlockStates.get(uuid) || this.baseBlockStates.get(uuid) || null;
			const preparedRenderedHTML = this._prepareRenderedHTMLSnapshot(
				uuid,
				renderedHTML || existingState?.renderedHTML || existingState?.html || ''
			);
			try {
				const parsed = window.wp.blocks.parse(rawContent);
				const block  = parsed && parsed[0];
				if (!block) return;

				// Recursively map JS block format to PHP block format
				const mapToPhpBlock = (jsBlock) => {
					if (!jsBlock) return null;
					return {
						blockName:    jsBlock.name || '',
						attrs:        jsBlock.attributes || {},
						innerHTML:    jsBlock.originalContent || '',
						innerBlocks:  (jsBlock.innerBlocks || []).map(mapToPhpBlock),
						innerContent: jsBlock.innerContent || []
					};
				};

				const phpBlock = mapToPhpBlock(block);

				this.currentBlockStates.set(uuid, {
					uuid,
					attrs: phpBlock.attrs || {},
					blockName: phpBlock.blockName || '',
					innerHTML: phpBlock.innerHTML || '',
					innerBlocks: phpBlock.innerBlocks || [],
					innerContent: phpBlock.innerContent || [],
					html: block.originalContent || existingState?.html || '',
					renderedHTML: preparedRenderedHTML,
					rawContent
				});
			} catch (e) {
				if (!existingState) return;
				this.currentBlockStates.set(uuid, {
					...this._cloneBlockState(existingState),
					rawContent,
					renderedHTML: preparedRenderedHTML || existingState.renderedHTML || ''
				});
			}
		}

		/**
		 * Reset tracked dirty state for one or more UUIDs back to the current
		 * batch-session baseline.
		 *
		 * @param {string[]} uuids Target UUIDs.
		 * @returns {boolean} Whether any tracked state changed.
		 */
		resetDirtyBlocks(uuids) {
			if (!this.sessionActive || !Array.isArray(uuids) || !uuids.length) {
				return false;
			}

			let changed = false;

			uuids.forEach(uuid => {
				const normalizedUuid = String(uuid || '').trim();
				if (!normalizedUuid) {
					return;
				}

				if (this.dirtyBlocks.has(normalizedUuid)) {
					this.dirtyBlocks.delete(normalizedUuid);
					changed = true;
				}

				if (this.baseBlockStates.has(normalizedUuid)) {
					this.currentBlockStates.set(
						normalizedUuid,
						this._cloneBlockState(this.baseBlockStates.get(normalizedUuid))
					);
					changed = true;
				}
			});

			return changed;
		}

		async startOrSwitchEditing(config) {
			const {
				element,
				handler,
				uuid,
				clickEvent,
				openEditorInternal,
				openOptions
			} = config;

			if (!this.isEnabled() || !handler || handler.capability !== 'edit') {
				return openEditorInternal(element, handler, uuid, clickEvent, false, 'edit', 'single', null, openOptions || null);
			}

			const ctx = SFE.Context;

			// If the same block is already open, do nothing.
			if (ctx.activeEditor && ctx.activeEditor.uuid === uuid) {
				return ctx.activeEditor;
			}

			// Close any other active editor before opening the new one.
			if (ctx.activeEditor) {
				const didClose = SFE.closeInPlaceEditor(
					ctx.activeEditor,
					false,
					{ closeReason: 'switch' }
				);
				if (didClose === false) {
					return ctx.activeEditor;
				}
			}

			// Open the editor immediately - don't block on the block-tree fetch.
			// The editor is fully usable without it; block state is applied
			// asynchronously once the session resolves in the background.
			const state = await openEditorInternal(element, handler, uuid, clickEvent, true, 'edit', 'batch', null, openOptions || null);

			if (state) {
				this.registerEditor(state);
				// Notify dock that an editor has been opened (enables dock behavior
				// from this point forward in the session).
				SFE.ActionBarDock?.notifyEditorOpened?.();
			}

			return state;
		}

		/**
		 * Show the action bar in a loading/disabled state before the block tree session
		 * is established.  Uses direct class manipulation to avoid triggering
		 * ElementState.markActive's "disable other elements" logic (session isn't active yet).
		 */
		_showSessionLoadingState(element, uuid) {
			const ctx                          = SFE.Context;
			const actionBar                    = ctx.actionBar;
			const overlayManager               = SFE.OverlayManager;
			const { positionFloatingElements } = SFE.PositionManager;

			if (!actionBar) return;

			// Add active CSS classes directly - bypassing ElementState.markActive so we
			// don't disable other elements before the batch session is confirmed.
			element.classList.add('mwp-sfe-element-active', 'mwp-sfe-editing-active');
			if (overlayManager) {
				overlayManager.hideHover();
				overlayManager.showActive(element, 'editing');
			}

			const allHandlers       = element._mwpSfeHandlers || [];
			const bar               = actionBar.getOrCreate();
			actionBar.activeElement = element;
			bar._targetElement      = element;

			actionBar.updateState({
				bar,
				element,
				state:   'edit',
				content: SFE.Context.buttonManager.getEditButtons()
			});

			// Immediately disable the save button with loading spinner.
			const primaryBtn = bar.querySelector('.mwp-sfe-btn-primary-inline');
			if (primaryBtn) {
				SFE.SaveHelpers.setButtonLoading(primaryBtn);
			}

			positionFloatingElements(element, null, bar);
		}

		/** Undo the pre-session loading state when session init fails. */
		_clearSessionLoadingState(element) {
			const ctx            = SFE.Context;
			const overlayManager = SFE.OverlayManager;
			element.classList.remove('mwp-sfe-element-active', 'mwp-sfe-editing-active');
			if (overlayManager) overlayManager.hideActive();
			if (ctx.actionBar)  ctx.actionBar.hide();
		}

		/**
		 * Reset the internal session state so the next editor click starts a fresh session.
		 * Called after a successful batch save to ensure baseBlockStates reflects the new
		 * saved content on the next /get-page-block-tree fetch.
		 */
		_resetSession() {
			this.sessionActive         = false;
			this.sessionLoadingPromise = null;
			this.dirtyBlocks.clear();
			this.baseBlockStates.clear();
			this.currentBlockStates.clear();
			document.body.classList.remove('mwp-sfe-batch-session-active');
			// Notify dock that the session has been fully reset so it can
			// disable dock behavior and clean up any docked state.
			SFE.ActionBarDock?.notifySessionReset?.();
		}

		async handleBatchSave(triggerButton = null) {
			if (!this.sessionActive) return;

			const ctx                   = SFE.Context;
			const { apiCall, ensureResolvedMediaAttributes } = SFE.Api;
			const {
				setButtonLoading,
				clearButtonLoading,
				lockSaveUI,
				unlockSaveUI,
				createSuccessElement,
				handleRevisionConflict,
				updatePageRevisionToken,
				fetchRenderedHTMLMap,
				reloadPageWithGuardBypass
			}                            = SFE.SaveHelpers;
			const { applyNewHTML,
				rebindElement }          = SFE.ElementUpdater;
			const { ElementState }       = SFE.ElementState;
			const TIMING                 = SFE.TIMING;
			const data                   = getManagerData();
			const postId                 = data.postId;
			const perms                  = data.permissions || {};
			let shouldReloadAfterSuccess = false;

			this.lastCaptureError = null;

			if (ctx.activeEditor && typeof ensureResolvedMediaAttributes === 'function') {
				try {
					await ensureResolvedMediaAttributes(ctx.activeEditor);
				} catch (error) {
					console.warn('FrontEdit: media resolution failed before batch save', error);
				}
			}

			this.captureActiveEditor('save');

			if (this.lastCaptureError) {
				alert(this.lastCaptureError.message || 'Error saving changes.');
				return;
			}

			if (this.dirtyBlocks.size === 0) {
				alert('No changes to save.');
				return;
			}

			const changes = Array.from(this.dirtyBlocks.values()).map(entry => ({
				element_uuid: entry.element_uuid,
				handler_id:   entry.handler_id,
				edit_content: entry.edit_content
			}));

			const restoreBtn = () => {
				if (triggerButton) unlockSaveUI(triggerButton);
			};

			if (triggerButton) {
				lockSaveUI(triggerButton);
			}

			if (perms.can_publish && !await SFE.PostLockManager.ensureLock()) {
				restoreBtn();
				return;
			}

			/**
			 * Fetch fresh server HTML for all UUIDs in one request so the server can
			 * render the page once and extract every updated block in a single DOM pass.
			 *
			 * Returns a uuid → html map.
			 */
			const fetchHTMLMap = async (uuids) => {
				try {
					return await fetchRenderedHTMLMap(uuids, { force: true });
				} catch (err) {
					console.warn(`FrontEdit: Failed to fetch updated HTML after batch save`, {
						requested: uuids,
						error:     err?.message || err
					});
					return {};
				}
			};

			/**
			 * Route the success path through showInlineSuccess - the same pipeline used
			 * by single-element saves - so locking, banner timing, re-enable, and rebinding
			 * all behave identically regardless of edit mode.
			 *
			 * The active editor's element is the primary element handled by showInlineSuccess.
			 * Every other dirty block is passed as additionalElements so showInlineSuccess
			 * updates and re-locks them for the duration of the success banner.
			 *
			 * @param {string[]} savedUuids  UUIDs included in the batch.
			 * @param {boolean}  isDraft     True for draft submission, false for publish.
			 */
			const finishBatchSave = async (savedUuids, isDraft, draftEntriesByUuid = null) => {
				const activeEditor = ctx.activeEditor;
				const uuidMap      = ctx.uuidMap;
				const primaryUuid  = activeEditor?.uuid || null;

				if (typeof SFE.destroyPersistedBlockEditSessions === 'function') {
					SFE.destroyPersistedBlockEditSessions(savedUuids);
				}

				// For publish: fetch new server HTML for all saved elements.
				// For draft:   fetch current published HTML so each element is restored
				//              to its pre-edit state while the draft awaits review
				//              (same intent as showInlineSuccess using originalOuterHTML
				//              for the active element in the single-element draft path).
				const htmlMap = await fetchHTMLMap(savedUuids);
				const missingHtml = savedUuids.filter(uuid => !htmlMap[uuid]);
				if (missingHtml.length) {
					if (SFE.SaveHelpers && typeof SFE.SaveHelpers.reloadAfterRefreshFailure === 'function') {
						SFE.SaveHelpers.reloadAfterRefreshFailure(
							`FrontEdit: Batch save succeeded but refreshed HTML was unavailable for: ${missingHtml.join(', ')}`
						);
						return;
					}
					window.location.reload();
					return;
				}

				// Mirror handleInlineSave's pre-showInlineSuccess pending-state update for drafts.
				if (isDraft) {
					savedUuids.forEach(uuid => {
						if (!uuidMap[uuid]) return;
						uuidMap[uuid].is_pending = true;
						const pendingInfo = buildPendingInfoFromEntry(draftEntriesByUuid?.[uuid] || null);
						if (pendingInfo) {
							uuidMap[uuid].pending_info = pendingInfo;
						}
					});
				}

				this._resetSession();
				restoreBtn();

				// Dirty blocks other than the active editor's element. showInlineSuccess
				// handles the active editor's element through its normal single-element path;
				// the rest are passed as additionalElements for the same lock + swap + rebind.
				const additionalElements = savedUuids
					.filter(uuid => uuid !== primaryUuid)
					.map(uuid => {
						const el = document.querySelector(`[data-mwp-sfe-uuid="${uuid}"]`);
						return (el && htmlMap[uuid]) ? { element: el, uuid, html: htmlMap[uuid] } : null;
					})
					.filter(Boolean);

				if (activeEditor) {
					// Main path: delegate entirely to showInlineSuccess so both single-element
					// and batch saves share identical locking, banner, re-enable, and rebind logic.
					// isDraft=true causes showInlineSuccess to use originalOuterHTML for the
					// primary element - no newHTML needed for it on the draft path.
					SFE.SaveManager.showInlineSuccess(
						activeEditor,
						isDraft ? 'Draft Submitted' : 'Changes Saved',
						isDraft ? null : (htmlMap[primaryUuid] || null),
						isDraft,
						isDraft ? 'warning' : 'success',
						{
							additionalElements,
							reloadAfterSuccess: shouldReloadAfterSuccess
						}
					);
				} else {
					// Edge case: Save All triggered from the dock with no editor open.
					// No editor cleanup needed - apply elements directly and re-enable.
					for (const item of additionalElements) {
						applyNewHTML(item.element, item.uuid, item.html);
					}
					if (isDraft) {
						savedUuids.forEach(uuid => {
							if (uuidMap[uuid]) uuidMap[uuid].is_pending = true;
							const el = document.querySelector(`[data-mwp-sfe-uuid="${uuid}"]`);
							if (el) el.classList.add('mwp-sfe-status-pending');
						});
					}
					const successDiv = createSuccessElement(
						isDraft ? 'Draft Submitted' : 'Changes Saved',
						isDraft ? 'warning' : 'success'
					);
					document.body.appendChild(successDiv);
					successDiv.offsetHeight;
					successDiv.style.transition = '';
					setTimeout(() => {
						successDiv.style.opacity = '0';
						setTimeout(() => {
							successDiv.remove();
							ElementState.enableAllElements();
							for (const uuid of savedUuids) {
								const el = document.querySelector(`[data-mwp-sfe-uuid="${uuid}"]`);
								if (el) rebindElement(el);
							}
							if (shouldReloadAfterSuccess && typeof reloadPageWithGuardBypass === 'function') {
								reloadPageWithGuardBypass();
							}
						}, TIMING.SUCCESS_FADE);
					}, TIMING.SUCCESS_DISPLAY);
				}
			};

			try {
				if (perms.can_publish) {
					const result = await apiCall('/apply-batch', {
						post_id:             postId,
						changes,
						page_revision_token: ctx.pageRevisionToken
					});
					updatePageRevisionToken(result);

					const savedUuids = Array.from(this.dirtyBlocks.keys());
					this.dirtyBlocks.clear();

					await finishBatchSave(savedUuids, false);

				} else if (perms.can_draft) {
					const submitResult = await apiCall('/pro/submit-draft-batch', {
						post_id: postId,
						changes
					});

					const draftedUuids = Array.from(this.dirtyBlocks.keys());
					const draftEntriesByUuid = {};
					if (Array.isArray(submitResult?.entries)) {
						submitResult.entries.forEach(item => {
							if (!item || !item.element_uuid || !item.entry) return;
							draftEntriesByUuid[item.element_uuid] = item.entry;
						});
					}
					this.dirtyBlocks.clear();

					await finishBatchSave(draftedUuids, true, draftEntriesByUuid);
				}
			} catch (error) {
				if (error.message === 'POST_LOCKED') {
					await SFE.PostLockManager?.handleLockedError(error);
					restoreBtn();
					return;
				}
				if (error.message === 'REVISION_CONFLICT') {
					const shouldRetry = await handleRevisionConflict(restoreBtn);
					if (!shouldRetry) return;
					shouldReloadAfterSuccess = true;

					try {
						// Retry without token - server skips conflict check when token is absent.
						const retryResult = await apiCall('/apply-batch', {
							post_id: postId,
							changes
							// No token - force save
						});
						updatePageRevisionToken(retryResult);

						const savedUuids = Array.from(this.dirtyBlocks.keys());
						this.dirtyBlocks.clear();

						await finishBatchSave(savedUuids, false);
						return;
					} catch (retryError) {
						alert('Error: ' + retryError.message);
						restoreBtn();
						return;
					}
				}

				alert('Error: ' + error.message);
				restoreBtn();
			}
		}

		startInlineCommenting(bar, element, handlers, uuid) {
			const actionBar = SFE.Context.actionBar;

			actionBar.updateState({
				bar,
				element,
				handlers,
				uuid,
				state: 'comment',
				content: {
					// Delegate form construction to CommentManager so the markup and
					// submit logic live in one place, shared with the standard flow.
					customBuilder: () => SFE.CommentManager.buildCommentForm(
						element,
						handlers,
						uuid,
						() => actionBar.show(element, handlers, uuid)
					)
				}
			});
		}
	}

	SFE.BatchEditManager = new BatchEditManager();

})();
