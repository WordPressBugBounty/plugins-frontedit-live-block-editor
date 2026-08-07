/**
 * API utilities - unified fetch wrapper and block-state loader
 *
 * Reads (from existing globals):
 *   SFE.ManagerData.restUrl  - REST base URL
 *   SFE.ManagerData.nonce    - WP nonce
 *   SFE.ManagerData.postId   - current post ID
 *   SFE.ListBlockTracker
 *   SFE.Context.activeEditor - live reference via getter
 *
 * Exposes: SFE.Api
 *   {
 *     apiCall,
 *     hydrateEditorBlockStateOnOpen,
 *     fetchBlockAttributes,
 *     resolveMediaAttributes,
 *     queueResolvedMediaAttributes,
 *     ensureResolvedMediaAttributes
 *   }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Unified API call handler with consistent error handling
	 */
	async function apiCall(endpoint, data, button = null) {
		const restBase     = (SFE.ManagerData.restUrl || '').replace(/\/$/, '');
		const path         = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
		const originalText = button?.textContent;
		const wasDisabled  = button?.disabled;

		if (button) {
			button.disabled = true;
			button.setAttribute('mwp-sfe-btn-loading', 'true');
		}

		try {
			const response = await fetch(restBase + path, {
				method: 'POST',
				headers: { 
					'Content-Type': 'application/json', 
					'X-WP-Nonce': SFE.ManagerData.nonce 
				},
				body: JSON.stringify(data)
			});

			const result = await response.json();
			if (!response.ok) {
				const error = new Error(result?.error || `HTTP ${response.status}: ${response.statusText}`);
				error.payload = result;
				throw error;
			}
			
			// Check for error in response
			if (result.success === false || result.error) {
				const error = new Error(result.error || 'Operation failed');
				error.payload = result;
				throw error;
			}
			
			return result;
			
		} catch (error) {
			// Reset button state on error
			if (button) {
				button.disabled = wasDisabled || false;
				button.removeAttribute('mwp-sfe-btn-loading');
				if (originalText) button.textContent = originalText;
			}
			throw error;
		}
	}

	function resolveBlockStateOverride(editorState) {
		const publicApiBridge = SFE.PublicApiBridge || null;
		const editorUuid = String(editorState?.uuid || '').trim();
		if (
			publicApiBridge &&
			editorUuid &&
			publicApiBridge.stagedBlockStates instanceof Map &&
			publicApiBridge.stagedBlockStates.has(editorUuid)
		) {
			const stagedEntry = publicApiBridge.stagedBlockStates.get(editorUuid) || null;
			publicApiBridge.stagedBlockStates.delete(editorUuid);
			if (stagedEntry && stagedEntry.blockState) {
				return publicApiBridge.clonePlainData(stagedEntry.blockState);
			}
		}

		if (typeof SFE.ResolveBlockState === 'function') {
			try {
				const resolved = SFE.ResolveBlockState(editorState);
				if (resolved) return resolved;
			} catch (error) {
				console.warn('FrontEdit: block-state resolver hook failed', error);
			}
		}

		const batchManager = SFE.BatchEditManager || null;
		if (
			editorState?.saveStrategy === 'batch' &&
			batchManager &&
			typeof batchManager.isSessionActive === 'function' &&
			batchManager.isSessionActive() &&
			typeof batchManager.getBlockStateForUuid === 'function'
		) {
			return batchManager.getBlockStateForUuid(editorState.uuid);
		}

		return null;
	}

	function resolveMediaSourceFromAttributes(editorState, blockState) {
		const schemaRuntime = SFE.SchemaRuntime || null;
		if (!schemaRuntime || typeof schemaRuntime.resolveInitialMediaSource !== 'function') {
			return '';
		}

		const resolved = schemaRuntime.resolveInitialMediaSource(editorState, blockState);
		if (typeof resolved === 'string' && resolved.trim()) {
			return resolved;
		}

		return '';
	}

	function shouldInitListTracker(editorState, blockState) {
		const tagName = editorState?.element?.tagName || '';
		const isListElement = tagName === 'OL' || tagName === 'UL';
		if (!isListElement) return false;

		const schemaRuntime = SFE.SchemaRuntime || null;
		const hasSchemaListBinding = (
			schemaRuntime &&
			typeof schemaRuntime.hasListBinding === 'function' &&
			schemaRuntime.hasListBinding(editorState)
		);

		return hasSchemaListBinding || blockState?.blockName === 'core/list';
	}

	/**
	 * Resolve canonical attachment attributes for the current editor state.
	 *
	 * This lets schema-driven media saves preserve block-level intent such as an
	 * existing `sizeSlug` on `core/image` while a new attachment is selected from
	 * the frontend editor.
	 *
	 * @param {object} editorState Current editor state.
	 * @param {object} [options]
	 * @param {string} [options.expectedResolutionKey] Stable selection key that
	 *                                                 must still match before the
	 *                                                 resolved payload is applied.
	 * @returns {Promise<object|null>} Resolved media change patch, or null when no resolution is needed.
	 */
	async function resolveMediaAttributes(editorState, options = {}) {
		const rootElement = editorState?.element || null;
		const mediaChanges = rootElement?._mwpMediaChanges;
		if (!mediaChanges || typeof mediaChanges !== 'object') return null;
		const expectedResolutionKey = typeof options.expectedResolutionKey === 'string'
			? options.expectedResolutionKey
			: '';

		const attachmentId = mediaChanges.id ?? null;
		if (!attachmentId) return null;

		const blockAttrs = editorState?.blockState?.attrs;
		if (!blockAttrs || typeof blockAttrs !== 'object') return null;

		const sizeSlug = typeof blockAttrs.sizeSlug === 'string' ? blockAttrs.sizeSlug.trim() : '';
		const response = await apiCall('/resolve-media-attributes', {
			post_id:       SFE.ManagerData.postId,
			attachment_id: attachmentId,
			size_slug:     sizeSlug
		});

		if (!response || response.success === false || !response.url) {
			return null;
		}

		const nextChanges = {
			...mediaChanges,
			url:           response.url,
			resolvedUrl:   response.url,
			resolvedWidth: Number.isFinite(response.width) ? response.width : null,
			resolvedHeight:Number.isFinite(response.height) ? response.height : null,
		};

		if (rootElement) {
			const currentResolutionKey = buildMediaResolutionKey(rootElement._mwpMediaChanges);
			if (expectedResolutionKey && currentResolutionKey !== expectedResolutionKey) {
				return null;
			}
			rootElement._mwpMediaChanges = nextChanges;
		}
		return nextChanges;
	}

	/**
	 * Build one stable identity key for the current pending media selection.
	 *
	 * Media replacement can change again before async attribute resolution
	 * finishes. This key lets the shared save/runtime layer ignore late results
	 * from an older selection instead of overwriting the current canonical media
	 * state with stale data.
	 *
	 * @param {object|null} mediaChanges Current media change payload.
	 * @returns {string} Stable resolution key, or an empty string when invalid.
	 */
	function buildMediaResolutionKey(mediaChanges) {
		if (!mediaChanges || typeof mediaChanges !== 'object') {
			return '';
		}

		const attachmentId = mediaChanges.id ?? '';
		const url = typeof mediaChanges.url === 'string' ? mediaChanges.url.trim() : '';
		return `${attachmentId}::${url}`;
	}

	/**
	 * Queue shared media resolution and cache the in-flight promise on the element.
	 *
	 * @param {object} editorState Current editor state.
	 * @param {object} [options]
	 * @param {HTMLElement|null} [options.mediaElement]
	 * @param {function|null} [options.syncRootChanges]
	 * @returns {Promise<object|null>}
	 */
	function queueResolvedMediaAttributes(editorState, options = {}) {
		if (!editorState?.element) {
			return Promise.resolve(null);
		}

		const rootElement = editorState.element;
		const requestedChanges = (
			rootElement._mwpMediaChanges && typeof rootElement._mwpMediaChanges === 'object'
		) ? { ...rootElement._mwpMediaChanges } : null;
		const requestedResolutionKey = buildMediaResolutionKey(requestedChanges);
		const existingPromise = rootElement._mwpResolvedMediaPromise;
		if (
			existingPromise &&
			typeof existingPromise.then === 'function' &&
			rootElement._mwpResolvedMediaKey === requestedResolutionKey
		) {
			return existingPromise;
		}

		const mediaElement = options.mediaElement || null;
		const syncRootChanges = typeof options.syncRootChanges === 'function' ? options.syncRootChanges : null;

		const pending = Promise.resolve()
			.then(() => {
				const currentChanges = rootElement._mwpMediaChanges;
				if (
					!currentChanges ||
					buildMediaResolutionKey(currentChanges) !== requestedResolutionKey
				) {
					return null;
				}

				return resolveMediaAttributes(editorState, {
					expectedResolutionKey: requestedResolutionKey
				});
			})
			.then((nextChanges) => {
				const currentChanges = rootElement._mwpMediaChanges;
				if (
					!nextChanges ||
					!currentChanges ||
					buildMediaResolutionKey(currentChanges) !== requestedResolutionKey
				) {
					return null;
				}

				if (nextChanges && mediaElement) {
					mediaElement._mwpMediaChanges = { ...nextChanges };
				}
				if (syncRootChanges) {
					syncRootChanges(nextChanges);
				}
				return nextChanges;
			});

		rootElement._mwpResolvedMediaKey = requestedResolutionKey;
		rootElement._mwpResolvedMediaPromise = pending.finally(() => {
			if (rootElement._mwpResolvedMediaPromise === pending) {
				delete rootElement._mwpResolvedMediaPromise;
				delete rootElement._mwpResolvedMediaKey;
			}
		});

		return rootElement._mwpResolvedMediaPromise;
	}

	/**
	 * Ensure resolved media attributes are settled before serialization/capture.
	 *
	 * @param {object} editorState Current editor state.
	 * @returns {Promise<object|null>}
	 */
	async function ensureResolvedMediaAttributes(editorState) {
		const pending = editorState?.element?._mwpResolvedMediaPromise;
		if (pending && typeof pending.then === 'function') {
			return pending;
		}

		const resolutionKey = buildMediaResolutionKey(editorState?.element?._mwpMediaChanges || null);
		return resolveMediaAttributes(editorState, {
			expectedResolutionKey: resolutionKey
		});
	}

	/**
	 * Shared editor-open hydration hook.
	 *
	 * Every editor entry path (text, mixed, media, container) should call this once
	 * immediately after SFE.Context.activeEditor is assigned. It marks the editor as
	 * having requested attrs and runs the shared block-state hydration pipeline.
	 *
	 * In free mode this results in per-block /get-block-state hydration on each open.
	 * In batch mode this first calls ensureSession() so the full block tree is
	 * loaded once, then resolves the active block from the batch cache.
	 *
	 * @param {object} editorState Current editor state.
	 * @returns {void}
	 */
	function hydrateEditorBlockStateOnOpen(editorState) {
		if (!editorState || editorState._mwpBlockAttrsRequested) {
			return;
		}

		editorState._mwpBlockAttrsRequested = true;
		fetchBlockAttributes(editorState).catch((error) => {
			console.warn('FrontEdit: failed to hydrate editor block state on open', error);
		});
	}

	/**
	 * Fetch block attributes in background and update editorState
	 * Disables primary button until loaded
	 */
	async function fetchBlockAttributes(editorState) {
		const postId           = SFE.ManagerData.postId;
		const ListBlockTracker = SFE.ListBlockTracker;
		const { uuid,
			actionsContainer } = editorState;
		const batchManager     = SFE.BatchEditManager || null;
		const getLivePrimaryButton = () => (
			actionsContainer
				? actionsContainer.querySelector('.mwp-sfe-btn-primary-inline')
				: null
		);
		const initialPrimaryBtn = getLivePrimaryButton();

		/**
		 * Return the initial and current primary buttons (deduped) so loading state
		 * can be removed even if the action bar swapped UIs during attr fetch.
		 *
		 * @return {HTMLElement[]}
		 */
		const getTrackedPrimaryButtons = () => {
			const buttons = [];
			if (initialPrimaryBtn) buttons.push(initialPrimaryBtn);
			const livePrimaryBtn = getLivePrimaryButton();
			if (livePrimaryBtn && livePrimaryBtn !== initialPrimaryBtn) {
				buttons.push(livePrimaryBtn);
			}
			return buttons;
		};

		/**
		 * Remove loading attributes from tracked primary buttons and restore
		 * disabled state based on button type.
		 *
		 * @param {string|null} originalBtnText Original text from the initial primary button.
		 * @return {void}
		 */
		const clearPrimaryLoadingState = (originalBtnText = null) => {
			const tracked = getTrackedPrimaryButtons();
			tracked.forEach((btn) => {
				if (!btn || !btn.hasAttribute('data-loading-attrs')) return;
				btn.removeAttribute('data-loading-attrs');
				btn.removeAttribute('mwp-sfe-btn-loading');
				if (btn === initialPrimaryBtn && originalBtnText !== null) {
					btn.textContent = originalBtnText;
				}
				if (btn.hasAttribute('data-url-gated')) {
					const editorWrap = btn.closest('.mwp-sfe-inline-media-editor');
					const input = editorWrap ? editorWrap.querySelector('#mwp-sfe-media-upload') : null;
					const value = input && typeof input.value === 'string' ? input.value : '';
					btn.disabled = !value.trim();
					return;
				}
				btn.disabled = false;
			});
		};

		const disableSaveButton = (msg) => {
			const primaryBtn = getLivePrimaryButton() || initialPrimaryBtn;
			if (primaryBtn) {
				primaryBtn.removeAttribute('data-loading-attrs');
				primaryBtn.removeAttribute('mwp-sfe-btn-loading');
				primaryBtn.disabled          = true;
				primaryBtn.textContent       = 'Error';
				primaryBtn.title             = msg;
				primaryBtn.style.background  = '#dc3232';
				primaryBtn.style.borderColor = '#dc3232';
				primaryBtn.style.cursor      = 'not-allowed';
			}
		};

		const applyBlockState = (blockState, originalBtnText = null) => {
			if (SFE.Context.activeEditor !== editorState) return;

			editorState.originalAttributes = blockState.attrs || {};
			editorState.blockName          = blockState.blockName || '';
			editorState.originalHTML       = blockState.html || '';

			if (editorState.isMediaEditor && !editorState._originalSrcResolved) {
				const srcFromAttrs = resolveMediaSourceFromAttributes(editorState, blockState);
				editorState.originalContent      = srcFromAttrs;
				editorState.originalSrc          = srcFromAttrs;
				editorState._originalSrcResolved = true;
			}

			editorState.blockState = blockState;

			const schemaRuntime = SFE.SchemaRuntime || null;
			if (
				editorState._mwpSchemaRuntime &&
				schemaRuntime &&
				typeof schemaRuntime.refreshEditorState === 'function'
			) {
				schemaRuntime.refreshEditorState(editorState, {
					blockState,
					attributeChanges: editorState.attributeChanges || null,
				});

				if (
					Array.isArray(editorState.editableComponents) &&
					SFE.TextEditor &&
					typeof SFE.TextEditor.refreshEditableComponents === 'function'
				) {
					SFE.TextEditor.refreshEditableComponents(editorState);
				}
			}

			if (shouldInitListTracker(editorState, blockState)) {
				editorState.listTracker = ListBlockTracker.init(editorState.element, blockState);
			}

			clearPrimaryLoadingState(originalBtnText);

			if (
				editorState?.saveStrategy === 'batch' &&
				batchManager &&
				typeof batchManager._captureEditorOpenBaseline === 'function'
			) {
				batchManager._captureEditorOpenBaseline(editorState);
			}
		};

		// If we're editing a draft, skip the server fetch entirely.
		// The draft element is already in the DOM with the correct content,
		// and its serialized block markup is stored in draftEditState.draftRawContent.
		// Fetching /get-block-state would return the published version, which has
		// different attributes (e.g. text alignment) and would silently revert them on save.
		const draftEditState = SFE.Context.draftEditState;
		if (draftEditState && draftEditState.draftRawContent &&
			draftEditState.draftElement === editorState.element) {

			const rawContent = draftEditState.draftRawContent;
			let parsedBlock;
			try {
				[ parsedBlock ] = wp.blocks.parse( rawContent );
			} catch (e) {
				disableSaveButton('Cannot save: Draft block data failed to parse');
				return;
			}

			if (!parsedBlock) {
				disableSaveButton('Cannot save: Draft block data failed to parse');
				return;
			}

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

			editorState.blockState            = mapToPhpBlock(parsedBlock);
			editorState.blockState.rawContent = rawContent; // Persist raw string
			
			editorState.originalAttributes = editorState.blockState.attrs;
			editorState.blockName          = editorState.blockState.blockName;

			if (shouldInitListTracker(editorState, editorState.blockState)) {
				editorState.listTracker = ListBlockTracker.init(editorState.element, editorState.blockState);
			}

			clearPrimaryLoadingState();
			return;
		}

		const resolvedBlockState = resolveBlockStateOverride(editorState);
		if (resolvedBlockState) {
			applyBlockState(resolvedBlockState);
			clearPrimaryLoadingState();
			return;
		}

		const primaryBtn = initialPrimaryBtn;
		const originalText = primaryBtn ? primaryBtn.textContent : null;
		if (primaryBtn) {
			primaryBtn.disabled = true;
			primaryBtn.setAttribute('data-loading-attrs', 'true');
			primaryBtn.setAttribute('mwp-sfe-btn-loading', 'true');
			// Keep original text, let CSS handle the loading visual
		}

		if (
			editorState?.saveStrategy === 'batch' &&
			batchManager &&
			typeof batchManager.isEnabled === 'function' &&
			batchManager.isEnabled() &&
			typeof batchManager.ensureSession === 'function'
		) {
			try {
				await batchManager.ensureSession();
			} catch (error) {
				console.warn('FrontEdit: batch session ensure failed, falling back to per-block fetch', error);
			}
		}

		const resolvedBlockStateAfterEnsure = resolveBlockStateOverride(editorState);
		if (resolvedBlockStateAfterEnsure) {
			applyBlockState(resolvedBlockStateAfterEnsure, originalText);
			clearPrimaryLoadingState(originalText);
			return;
		}

		if (primaryBtn) {
			try {
				const blockState = await apiCall('/get-block-state', {
					post_id: postId,
					element_uuid: uuid
				});

				applyBlockState(blockState, originalText);
			} catch (error) {
				console.warn('Failed to fetch block state:', error);
				alert('Failed to load block data. Editing is disabled to prevent data loss. Please refresh the page.');
				if (SFE.Context.activeEditor === editorState) {
					disableSaveButton('Cannot save: Block data failed to load');
				}
			}
		} else {
			try {
				const blockState = await apiCall('/get-block-state', {
					post_id: postId,
					element_uuid: uuid
				});
				applyBlockState(blockState);
			} catch (error) {
				console.warn('Failed to fetch block state:', error);
				editorState.originalAttributes = {};
				editorState.blockName = '';
			}
		}
	}

	SFE.Api = {
		apiCall,
		hydrateEditorBlockStateOnOpen,
		fetchBlockAttributes,
		resolveMediaAttributes,
		queueResolvedMediaAttributes,
		ensureResolvedMediaAttributes
	};

})();
