/**
 * Media editor - file upload, URL entry, media library browser, and save UI
 *
 * Reads (via globals):
 *   SFE.Context           - .activeEditor (r/w), .activeMode (r/w),
 *                           .draftEditState, .actionBar, .buttonManager
 *   SFE.PositionManager   - .positionFloatingElements
 *   SFE.FocusManager      - .createFocusManager
 *   SFE.Api               - .apiCall
 *   SFE.MediaHelper       - (MediaHelper global)
 *   SFE.MediaLibraryCache - (mediaLibraryCache global)
 *   SFE.OverlayManager
 *   SFE.LifecycleHelpers  - .createFadeHandler, .setupDraftPreviewLifecycle
 *   SFE.handleInlineSave  - set by SaveManager
 *   SFE.closeDraftPreview - set by DraftManager
 *   SFE.ManagerData       - .iconLibraryUrl, .mediaLibraryUrl, .restBase,
 *                           .restUrl, .nonce, .postId
 *
 * Exposes: SFE.MediaEditor  { startMediaEditing, startSchemaComponentEditing }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	function showToolbar(toolbar) {
		if (!toolbar) return;
		if (toolbar._mwpSwitchHideTimeout) {
			clearTimeout(toolbar._mwpSwitchHideTimeout);
			delete toolbar._mwpSwitchHideTimeout;
		}
		toolbar.classList.remove('mwp-sfe-closing');
		toolbar.style.display = '';
	}

	function ensureToolbarContainer(editorState) {
		if (!editorState) return null;

		let toolbarContainer = editorState.toolbarContainer || null;
		if (!toolbarContainer) {
			toolbarContainer = document.createElement('div');
			toolbarContainer.className = 'mwp-sfe-inline-toolbar mwp-sfe-inline-editor';
			toolbarContainer.setAttribute('data-mwp-sfe-control', 'true');
			toolbarContainer.style.pointerEvents = 'auto';
			toolbarContainer.style.display = 'none';
			document.body.appendChild(toolbarContainer);
			editorState.toolbarContainer = toolbarContainer;
		}

		return toolbarContainer;
	}

	function bindInlineEditButtons(editorState) {
		const actionsContainer = editorState?.actionsContainer || null;
		if (!actionsContainer) return;

		if (actionsContainer._saveBtn) {
			actionsContainer._saveBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopImmediatePropagation();
				SFE.handleInlineSave(editorState);
			});
		}

		if (actionsContainer._cancelBtn) {
			actionsContainer._cancelBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopImmediatePropagation();
				SFE.closeInPlaceEditor(editorState, true);
			});
		}
	}

	function restoreInlineEditButtons(editorState) {
		const ctx              = SFE.Context;
		const actionBar        = ctx?.actionBar;
		const buttonManager    = ctx?.buttonManager;
		const actionsContainer = editorState?.actionsContainer || null;
		if (!actionBar || !buttonManager || !actionsContainer) return;

		actionBar.updateState({
			bar: actionsContainer,
			element: editorState.element,
			state: 'edit',
			content: buttonManager.getEditButtons(),
		});
		bindInlineEditButtons(editorState);
	}

	function cloneAttributeChanges(attributeChanges) {
		return attributeChanges && typeof attributeChanges === 'object'
			? { ...attributeChanges }
			: {};
	}

	function createMediaToolbarHost(config) {
		const {
			editorState,
			component,
			toolbarContainer,
			formats,
			getMediaElement,
			setMediaElement,
			reposition,
			serializeState,
			applySerializedState,
			showMediaReplaceUI,
		} = config;
		const historyApi = typeof editorState?.getSessionHistoryApi === 'function'
			? editorState.getSessionHistoryApi('media')
			: null;
		const host = {
			element: getMediaElement(),
			formats: Array.isArray(formats) ? formats : [],
			options: {
				...(component?.editorOptions && typeof component.editorOptions === 'object' ? component.editorOptions : {}),
				toolbarContainer,
				blockRootElement: editorState?.element || null,
			},
			attributeChanges: editorState.attributeChanges && typeof editorState.attributeChanges === 'object'
				? editorState.attributeChanges
				: (editorState.attributeChanges = {}),
			toolbarManager: null,
			attachToolbarManager(manager) {
				this.toolbarManager = manager;
			},
			detachToolbarManager(manager) {
				if (this.toolbarManager === manager) {
					this.toolbarManager = null;
				}
			},
			isSelectionInEditor() {
				return false;
			},
			getCurrentListItem() {
				return null;
			},
			getParentList() {
				return null;
			},
			canIndentListItem() {
				return false;
			},
			canOutdentListItem() {
				return false;
			},
			canUndo() {
				return !!historyApi?.canUndo?.();
			},
			canRedo() {
				return !!historyApi?.canRedo?.();
			},
			updateToolbarState() {
				if (this.toolbarManager && typeof this.toolbarManager.updateToolbarState === 'function') {
					this.toolbarManager.updateToolbarState();
				}
			},
			updateUndoRedoButtons() {
				if (this.toolbarManager && typeof this.toolbarManager.updateUndoRedoButtons === 'function') {
					this.toolbarManager.updateUndoRedoButtons();
				}
			},
			saveToHistory() {
				historyApi?.saveToHistory?.();
			},
			undo() {
				historyApi?.undo?.();
			},
			redo() {
				historyApi?.redo?.();
			},
			setElement(element) {
				this.element = element;
				setMediaElement(element);
			},
			showMediaReplaceUI() {
				if (typeof showMediaReplaceUI === 'function') {
					showMediaReplaceUI();
				}
			},
			getBlockRootElement() {
				return editorState?.element || null;
			},
			scheduleFloatingElementsPositionAfterLayout() {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						reposition();
					});
				});
			}
		};

		return SFE.SchemaEditorHost.attachHostContract(host);
	}

	// ─── Pure / stateless helpers ─────────────────────────────────────────────

	/**
	 * Reposition the action bar once a media element has finished loading, or
	 * immediately when it is already in a ready state.
	 * Handles both <img> (.complete) and <video>/<audio> (.readyState >= 2).
	 */
	function repositionAfterMediaLoad(mediaEl, element, toolbarContainer, actionsContainer, positionFloatingElements) {
		const reposition = () => {
			if (!element) return;
			positionFloatingElements(element, toolbarContainer || null, actionsContainer);
		};
		const tagName = mediaEl?.tagName ? mediaEl.tagName.toUpperCase() : '';
		const waitsForLoad = (tagName === 'IMG' || tagName === 'VIDEO' || tagName === 'AUDIO');

		if (!mediaEl || !waitsForLoad || mediaEl.complete || mediaEl.readyState >= 2) {
			reposition();
		} else {
			mediaEl.addEventListener('load',       reposition, { once: true });
			mediaEl.addEventListener('loadeddata', reposition, { once: true });
		}
	}

	/** Return whether a MIME type is acceptable for the given block media type. */
	function validateFileType(mimeType, expectedMediaType) {
		if (!mimeType) return true; // unknown type – let the server decide

		const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif',
		                     'image/webp', 'image/svg+xml', 'image/bmp'];
		const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
		                     'audio/aac', 'audio/flac', 'audio/m4a'];
		const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
		                     'video/x-msvideo', 'video/avi'];
		const mime = mimeType.toLowerCase();

		switch (expectedMediaType) {
			case 'image': return IMAGE_TYPES.includes(mime);
			case 'audio': return AUDIO_TYPES.includes(mime) || mime.startsWith('audio/');
			case 'video': return VIDEO_TYPES.includes(mime) || mime.startsWith('video/');
			case 'image_or_video':
				return IMAGE_TYPES.includes(mime) || VIDEO_TYPES.includes(mime) ||
				       mime.startsWith('image/') || mime.startsWith('video/');
			case 'file': return true;
			default:     return true;
		}
	}

	/**
	 * Pause, detach src, and reload all <video>/<audio> elements inside a
	 * container. Called before clearing innerHTML to abort in-flight network
	 * requests and release decode/buffer memory.
	 */
	function releaseMediaElements(container) {
		container.querySelectorAll('video, audio').forEach(m => {
			try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) { /* ignore */ }
		});
	}

	/** Map the internal mediaType key to a human-readable display name. */
	function getMediaTypeName(mediaType) {
		const names = {
			image: 'Image', video: 'Video', audio: 'Audio',
			file: 'File', image_or_video: 'Image or Video', icon: 'Icon'
		};
		return names[mediaType] || (mediaType.charAt(0).toUpperCase() + mediaType.slice(1));
	}

	// ─── UI builders ─────────────────────────────────────────────────────────

	/**
	 * Build the drop-zone widget (SVG upload icon + helper text label).
	 *
	 * Returns { dropZone, iconWrap, textWrap } so callers can re-append
	 * iconWrap/textWrap when resetting an error state without rebuilding the
	 * whole widget from scratch.
	 *
	 * @param   {string} mediaTypeName - Display name, e.g. "Image"
	 * @returns {{ dropZone: HTMLElement, iconWrap: HTMLElement, textWrap: HTMLElement }}
	 */
	function buildDropZone(mediaTypeName) {
		const dropZone = document.createElement('div');
		dropZone.className = 'mwp-sfe-media-upload-drop-zone';
		dropZone.setAttribute('role', 'button');
		dropZone.setAttribute('aria-label',
			`Upload ${mediaTypeName}, drag and drop or click to select`);

		const iconWrap = document.createElement('div');
		iconWrap.className = 'mwp-sfe-upload-icon';
		iconWrap.innerHTML = `
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="36" height="36">
				<title>Upload</title>
				<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.2"/>
				<path d="M12 16V9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M9 12l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>`;

		const textWrap = document.createElement('div');
		textWrap.className = 'mwp-sfe-upload-text';
		textWrap.innerHTML = `Drag & Drop ${mediaTypeName} here<br>or Click to Upload`;

		dropZone.appendChild(iconWrap);
		dropZone.appendChild(textWrap);

		return { dropZone, iconWrap, textWrap };
	}

	/**
	 * Build the "input" panel: URL field, drop zone, and Upload / Browse / Cancel buttons.
	 *
	 * @param {object}   config
	 * @param {object}   config.state           - Shared mutable { url, file, attachmentId }
	 * @param {string}   config.mediaType
	 * @param {string}   config.mediaTypeName
	 * @param {object}   config.mediaDescriptor - Schema media descriptor for the active component.
	 * @param {function} config.onUploadSuccess - (url: string, attachmentId: number|null) => void
	 * @param {function} config.onBrowse        - () => void
	 * @param {function} config.onCancel        - () => void
	 * @param {function} config.maintainFocus   - () => void  keeps action bar focused
	 * @param {boolean}  config.isAttrsLoading  - true when block attrs are still resolving
	 * @returns {HTMLElement}
	 */
	function buildInputUI({ state, mediaType, mediaTypeName, mediaDescriptor,
	                        onUploadSuccess, onBrowse, onCancel, maintainFocus, isAttrsLoading = false }) {

		const container     = document.createElement('div');
		container.className = 'mwp-sfe-inline-media-editor';
		container.addEventListener('click', e => e.stopPropagation());

		// ── URL input ──
		const input = document.createElement('input');
		input.type        = 'text';
		input.id          = 'mwp-sfe-media-upload';
		input.className   = 'mwp-sfe-text-entry mwp-sfe-link-url-entry';
		input.placeholder = `Enter ${mediaTypeName} URL...`;
		input.value       = state.url;

		// ── Drop zone ──
		const { dropZone, iconWrap, textWrap } = buildDropZone(mediaTypeName);

		const fileInput         = document.createElement('input');
		fileInput.type          = 'file';
		fileInput.accept        = SFE.MediaHelper.getAcceptTypes(mediaDescriptor);
		fileInput.style.display = 'none';

		// ── Buttons ──
		const uploadBtn        = document.createElement('button');
		uploadBtn.className    = 'mwp-sfe-btn mwp-sfe-btn-primary-inline';
		uploadBtn.textContent  = 'Upload';
		uploadBtn.disabled     = !state.url;
		uploadBtn.setAttribute('data-url-gated', 'true');
		if (isAttrsLoading) {
			uploadBtn.disabled = true;
			uploadBtn.setAttribute('data-loading-attrs', 'true');
			uploadBtn.setAttribute('mwp-sfe-btn-loading', 'true');
		}

		const browseBtn       = document.createElement('button');
		browseBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline';
		browseBtn.textContent = 'Browse Library';

		const cancelBtn       = document.createElement('button');
		cancelBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline';
		cancelBtn.textContent = 'Cancel';

		const btnRow      = document.createElement('div');
		btnRow.className  = 'mwp-sfe-inline-media-upload-actions';
		btnRow.appendChild(uploadBtn);
		btnRow.appendChild(browseBtn);
		btnRow.appendChild(cancelBtn);

		container.appendChild(input);
		container.appendChild(dropZone);
		container.appendChild(fileInput);
		container.appendChild(btnRow);

		// ── Error display ──
		const handleUploadError = (msg) => {
			dropZone.classList.remove('mwp-sfe-is-uploading');
			dropZone.textContent        = 'Error: ' + msg;
			dropZone.style.borderColor  = '#dc3232';
			dropZone.style.borderStyle  = 'solid';
			input.disabled = false;
			input.focus();
			setTimeout(() => {
				dropZone.innerHTML = '';
				dropZone.appendChild(iconWrap);
				dropZone.appendChild(textWrap);
				dropZone.style.backgroundColor = '';
				dropZone.style.borderColor     = '';
				dropZone.style.borderStyle     = '';
				dropZone.style.pointerEvents   = '';
				uploadBtn.disabled             = !state.url;
			}, 3000);
		};

		// Set the drop zone into "uploading" visual state
		const setUploadingState = () => {
			dropZone.classList.remove('mwp-sfe-is-dragging');
			dropZone.classList.add('mwp-sfe-is-uploading');
			dropZone.textContent         = 'Uploading...';
			dropZone.style.pointerEvents = 'none';
			uploadBtn.disabled           = true;
			input.disabled               = true;
		};

		// ── File handler ──
		const handleFile = async (file, fileName = null) => {
			if (!file) return;

			if (!validateFileType(file.type || '', mediaType)) {
				const expected = { image: 'an image', audio: 'an audio file',
				                   video: 'a video', image_or_video: 'an image or video'
				                 }[mediaType] || 'a valid file';
				handleUploadError(
					`Please select ${expected}. The file you selected doesn't match the expected type.`
				);
				dropZone.classList.remove('mwp-sfe-is-dragging');
				uploadBtn.disabled = !state.url;
				return;
			}

			setUploadingState();

			try {
				const formData = new FormData();
				if (fileName) {
					formData.append('file', file, fileName);
				} else {
					formData.append('file', file);
				}

				const mediaLibraryUrl = String(SFE.ManagerData.mediaLibraryUrl || '').trim();
				if (!mediaLibraryUrl) {
					throw new Error('Media Library URL is not configured.');
				}
				const response = await fetch(mediaLibraryUrl, {
					method:  'POST',
					headers: { 'X-WP-Nonce': SFE.ManagerData.nonce },
					body:    formData
				});
				if (!response.ok) throw new Error('Upload failed');
				const media = await response.json();

				dropZone.classList.remove('mwp-sfe-is-uploading');
				state.url                  = media.source_url;
				state.attachmentId         = media.id || null;
				input.value                = state.url;
				dropZone.textContent       = 'Upload Successful!';
				dropZone.style.borderColor = '#00a32a';
				dropZone.style.borderStyle = 'solid';
				uploadBtn.disabled         = false;

				SFE.MediaLibraryCache.invalidate(mediaType);
				input.disabled = false;
				maintainFocus();

				setTimeout(() => onUploadSuccess(state.url, state.attachmentId), 500);
			} catch (err) {
				handleUploadError(err.message);
			}
		};

		// ── URL-to-blob upload ──
		const handleUrlUpload = async () => {
			if (!state.url) return;
			setUploadingState();
			try {
				const res = await fetch(state.url);
				if (!res.ok) throw new Error('Could not fetch media from URL');
				const blob = await res.blob();

				let filename = state.url.split('/').pop().split('?')[0];
				if (!filename || !filename.includes('.')) {
					const ext = { image: 'jpg', audio: 'mp3', video: 'mp4',
					              image_or_video: 'jpg' }[mediaType] || 'file';
					filename = `${mediaType}-upload.${ext}`;
				}
				handleFile(blob, filename);
			} catch (err) {
				handleUploadError(err.message);
			}
		};

		// ── Event bindings ──
		input.addEventListener('input', (e) => {
			state.url          = e.target.value;
			if (uploadBtn.hasAttribute('data-loading-attrs')) {
				uploadBtn.disabled = true;
				return;
			}
			uploadBtn.disabled = !state.url.trim();
		});
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && state.url.trim()) {
				e.preventDefault();
				handleUrlUpload();
			}
		});

		dropZone.addEventListener('click',     ()  => fileInput.click());
		fileInput.addEventListener('change',   (e) => handleFile(e.target.files[0]));
		dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('mwp-sfe-is-dragging'); });
		dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('mwp-sfe-is-dragging'); });
		dropZone.addEventListener('drop',      (e) => {
			e.preventDefault();
			dropZone.style.background  = '#444';
			dropZone.style.borderColor = '#2196F3';
			handleFile(e.dataTransfer.files[0]);
		});

		uploadBtn.addEventListener('click', (e) => {
			e.preventDefault();
			if (uploadBtn.hasAttribute('data-loading-attrs')) return;
			handleUrlUpload();
		});
		browseBtn.addEventListener('click', (e) => { e.preventDefault(); onBrowse(); });
		cancelBtn.addEventListener('click', (e) => { e.preventDefault(); onCancel(); });

		return container;
	}

	/**
	 * Append media library thumbnail items to a grid element.
	 * Called for each page load; does not clear existing items.
	 *
	 * @param {HTMLElement} grid
	 * @param {Array}       items         - Array of media item objects
	 * @param {string}      mediaType
	 * @param {function}    onSelect      - (url: string, attachmentId: number|null) => void
	 * @param {function}    maintainFocus
	 */
	function appendMediaItems(grid, items, mediaType, onSelect, maintainFocus) {
		const typeIcon = (mimeType) => {
			if (!mimeType)                      return '📄';
			if (mimeType.startsWith('image/'))  return '🖼️';
			if (mimeType.startsWith('video/'))  return '🎬';
			if (mimeType.startsWith('audio/'))  return '🎵';
			return '📄';
		};

		items.forEach(item => {
			const itemEl = document.createElement('div');
			itemEl.className = 'mwp-sfe-media-library-item';
			itemEl.setAttribute('role',       'button');
			itemEl.setAttribute('tabindex',   '0');
			itemEl.setAttribute('aria-label', `Select ${item.title || 'Untitled'}`);

			// Preview wrapper: icon placeholder sits underneath; thumbnail fades in on top.
			// The grid renders instantly with icons; thumbnails appear progressively.
			const previewWrap = document.createElement('div');
			previewWrap.style.cssText =
				'position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;' +
				'background:#222;display:flex;align-items:center;justify-content:center;';

			const iconLayer = document.createElement('div');
			iconLayer.className = 'mwp-sfe-media-library-placeholder';
			iconLayer.innerHTML = `<span style="font-size:32px;">${typeIcon(item.type)}</span>`;
			previewWrap.appendChild(iconLayer);

			if (item.thumb) {
				const img         = document.createElement('img');
				img.alt           = item.title || '';
				img.loading       = 'lazy'; // skip off-screen items, no wasted requests
				img.style.cssText =
					'position:absolute;inset:0;width:100%;height:100%;' +
					'object-fit:cover;opacity:0;transition:opacity 0.2s ease;';
				// Handlers set before src to never miss a synchronous cache-hit load
				img.onload  = () => {
					img.style.opacity          = '1';
					iconLayer.style.transition = 'opacity 0.2s ease';
					iconLayer.style.opacity    = '0';
				};
				img.onerror = () => img.remove(); // icon stays visible on broken thumb
				img.src     = item.thumb;
				previewWrap.appendChild(img);
			}
			itemEl.appendChild(previewWrap);

			if (item.title) {
				const title       = document.createElement('div');
				title.className   = 'mwp-sfe-media-library-item-title';
				title.textContent = item.title;
				itemEl.appendChild(title);
			}

			const selectMedia = () => {
				maintainFocus();
				onSelect(item.url, item.id || null);
			};
			itemEl.addEventListener('click', selectMedia);
			itemEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					selectMedia();
				}
			});
			grid.appendChild(itemEl);
		});
	}

	/**
	 * Build and show the media library browser inside actionsContainer.
	 * Supports infinite scroll: loads 45 items at a time, fetching the next
	 * page automatically as the user scrolls to the bottom of the grid.
	 *
	 * @param {object}      config
	 * @param {HTMLElement} config.actionsContainer
	 * @param {string}      config.mediaType
	 * @param {string}      config.mediaTypeName
	 * @param {number}      config.postId
	 * @param {function}    config.onBack
	 * @param {function}    config.onSelect      - (url, attachmentId) => void
	 * @param {function}    config.reposition    - () => void
	 * @param {function}    config.maintainFocus - () => void
	 */
	async function showMediaLibrary(
		{ actionsContainer, mediaType, mediaTypeName, postId,
		  onBack, onSelect, reposition, maintainFocus }
	) {
		const { apiCall }       = SFE.Api;
		const mediaLibraryCache = SFE.MediaLibraryCache;
		const PER_PAGE          = 45;

		releaseMediaElements(actionsContainer);
		actionsContainer.innerHTML = '';

		const container     = document.createElement('div');
		container.className = 'mwp-sfe-inline-media-library';
		container.addEventListener('click', e => e.stopPropagation());

		const header       = document.createElement('div');
		header.className   = 'mwp-sfe-media-library-header';
		header.textContent = `Select ${mediaTypeName} from the Library`;

		const grid       = document.createElement('div');
		grid.className   = 'mwp-sfe-media-library-grid';
		grid.innerHTML   = '<div class="mwp-sfe-media-library-message">Loading media library...</div>';

		// Sentinel sits at the very bottom of the grid (inside the scroll container).
		// IntersectionObserver fires when it is within 150px of the visible area,
		// giving the next page time to arrive before the user actually hits the edge.
		const sentinel         = document.createElement('div');
		sentinel.className     = 'mwp-sfe-media-library-sentinel';
		sentinel.style.cssText = 'height:1px;width:100%;grid-column:1/-1;';

		// Loading indicator row rendered inside the grid while a fetch is in flight
		const loadingRow         = document.createElement('div');
		loadingRow.className     = 'mwp-sfe-media-library-loading-row';
		loadingRow.style.cssText = 'grid-column:1/-1;text-align:center;padding:12px 0;display:none;color:var(--mwp-sfe-text-muted,#aaa);font-size:12px;';
		loadingRow.textContent   = 'Loading more...';

		const btnRow     = document.createElement('div');
		btnRow.className = 'mwp-sfe-inline-media-upload-actions';

		const backBtn       = document.createElement('button');
		backBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline';
		backBtn.textContent = 'Back';
		backBtn.addEventListener('click', (e) => { e.preventDefault(); onBack(); });
		btnRow.appendChild(backBtn);

		container.appendChild(header);
		container.appendChild(grid);
		container.appendChild(btnRow);
		actionsContainer.appendChild(container);

		maintainFocus();
		requestAnimationFrame(reposition);

		// ── Cache structure stored per mediaType ──────────────────────────
		// { items: [...all items fetched so far], page: number, hasMore: boolean }
		// Re-opening the library restores the full previously-scrolled state
		// instantly from cache without hitting the server again.
		// invalidate() (called after an upload) wipes this so the next open
		// fetches fresh data.

		const cached    = mediaLibraryCache.get(mediaType);
		let currentPage = cached ? cached.page    : 0;
		let hasMore     = cached ? cached.hasMore : true;
		let isLoading   = false;
		let observer    = null;

		// allItems is the single source of truth - every page appends to it,
		// and it is always written to cache in full so re-opens restore correctly.
		let allItems = cached ? cached.items.slice() : [];

		const saveCache = () => {
			mediaLibraryCache.set(mediaType, { items: allItems, page: currentPage, hasMore });
		};

		const disconnectObserver = () => {
			if (observer) { observer.disconnect(); observer = null; }
		};

		// ── Restore from cache (no network request) ───────────────────────
		const restoreFromCache = (cachedItems) => {
			grid.innerHTML = '';
			grid.appendChild(loadingRow);
			grid.appendChild(sentinel);

			if (cachedItems.length === 0) {
				const msg       = document.createElement('div');
				msg.className   = 'mwp-sfe-media-library-message';
				msg.textContent = 'No media found in library.';
				grid.insertBefore(msg, loadingRow);
			} else {
				const frag = document.createDocumentFragment();
				appendMediaItems(frag, cachedItems, mediaType, onSelect, maintainFocus);
				grid.insertBefore(frag, loadingRow);
			}
		};

		// ── Fetch the next page from the server ───────────────────────────
		const loadNextPage = async () => {
			if (isLoading || !hasMore) return;
			isLoading = true;
			loadingRow.style.display = '';

			try {
				currentPage++;
				const result = await apiCall('/get-media-library', {
					post_id: postId, media_type: mediaType,
					page: currentPage, per_page: PER_PAGE
				});

				// First page fetch: swap out the "Loading..." placeholder
				if (currentPage === 1) {
					grid.innerHTML = '';
					grid.appendChild(loadingRow);
					grid.appendChild(sentinel);
				}

				if (!result.items || result.items.length === 0) {
					if (currentPage === 1) {
						const msg       = document.createElement('div');
						msg.className   = 'mwp-sfe-media-library-message';
						msg.textContent = 'No media found in library.';
						grid.insertBefore(msg, loadingRow);
					}
					hasMore = false;
					disconnectObserver();
					saveCache();
					return;
				}

				// Append new items above the sentinel/loading row
				const frag = document.createDocumentFragment();
				appendMediaItems(frag, result.items, mediaType, onSelect, maintainFocus);
				grid.insertBefore(frag, loadingRow);

				// Accumulate into the running list and persist to cache
				allItems.push(...result.items);

				if (currentPage >= result.total_pages) {
					hasMore = false;
					disconnectObserver();
				}

				saveCache();

			} catch (error) {
				console.error('Failed to load media library:', error);
				if (currentPage === 1) {
					grid.innerHTML =
						`<div class="mwp-sfe-media-library-message" style="color:#dc3232;">
						 Error loading media library: ${error.message}</div>`;
				} else {
					loadingRow.textContent = 'Error loading more items.';
				}
				hasMore = false;
				disconnectObserver();
			} finally {
				isLoading = false;
				loadingRow.style.display = 'none';
			}
		};

		// ── IntersectionObserver - scoped to the grid scroll container ────
		// rootMargin bottom of 150px means the observer fires when the sentinel
		// is within 150px of the bottom edge of the grid, giving the fetch time
		// to complete before the user reaches the very end.
		const attachObserver = () => {
			observer = new IntersectionObserver(
				(entries) => { if (entries[0].isIntersecting) loadNextPage(); },
				{ root: grid, rootMargin: '0px 0px 150px 0px', threshold: 0 }
			);
			observer.observe(sentinel);
		};

		// ── Bootstrap: restore cache instantly, then set up observer ─────
		if (cached) {
			restoreFromCache(cached.items);
			if (hasMore) attachObserver();
		} else {
			// No cache - add sentinel now (loadNextPage will clear the placeholder)
			attachObserver();
			await loadNextPage();
		}
	}

	/**
	 * Show the WordPress core Icon Library for schema media components that use
	 * the `icon` media type. Icons are REST entities, not media attachments.
	 *
	 * @param {object} config Icon-library UI configuration.
	 * @returns {Promise<void>}
	 */
	async function showIconLibrary({ actionsContainer, onSelect, onBack, reposition, maintainFocus }) {
		const mediaLibraryCache = SFE.MediaLibraryCache;
		releaseMediaElements(actionsContainer);
		actionsContainer.innerHTML = '';

		const container     = document.createElement('div');
		container.className = 'mwp-sfe-inline-media-library';
		container.addEventListener('click', event => event.stopPropagation());

		const header       = document.createElement('div');
		header.className   = 'mwp-sfe-media-library-header';
		header.textContent = 'Select Icon from the Library';

		const grid     = document.createElement('div');
		grid.className = 'mwp-sfe-media-library-grid';
		grid.innerHTML = '<div class="mwp-sfe-media-library-message">Loading icon library...</div>';

		const btnRow        = document.createElement('div');
		btnRow.className    = 'mwp-sfe-inline-media-upload-actions';
		const backBtn       = document.createElement('button');
		backBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline';
		backBtn.textContent = 'Back';
		backBtn.addEventListener('click', event => {
			event.preventDefault();
			onBack();
		});
		btnRow.appendChild(backBtn);

		container.append(header, grid, btnRow);
		actionsContainer.appendChild(container);
		maintainFocus();
		requestAnimationFrame(reposition);

		const renderIcons = (icons) => {
			grid.innerHTML = '';
			if (!Array.isArray(icons) || !icons.length) {
				grid.innerHTML = '<div class="mwp-sfe-media-library-message">No icons found in the Icon Library.</div>';
				return;
			}

			icons.forEach(icon => {
				const name = String(icon?.name || '').trim();
				if (!name) return;
				const item     = document.createElement('button');
				item.type      = 'button';
				item.className = 'mwp-sfe-media-library-item';
				item.setAttribute('aria-label', `Select ${String(icon?.label || name)}`);

				const preview         = document.createElement('div');
				preview.style.cssText = 'position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;';
				preview.innerHTML     = String(icon?.content || '');
				const title           = document.createElement('div');
				title.className       = 'mwp-sfe-media-library-item-title';
				title.textContent     = String(icon?.label || name);

				item.append(preview, title);
				item.addEventListener('click', () => {
					maintainFocus();
					onSelect(name, null, String(icon?.content || ''));
				});
				grid.appendChild(item);
			});
		};

		const cached = mediaLibraryCache?.get('icon');
		if (cached?.items) {
			renderIcons(cached.items);
			return;
		}

		try {
			const iconLibraryUrl = String(SFE.ManagerData.iconLibraryUrl || '').trim();
			if (!iconLibraryUrl) {
				throw new Error('Icon Library URL is not configured.');
			}
			const iconLibraryRequestUrl = new URL(iconLibraryUrl, window.location.href);
			iconLibraryRequestUrl.searchParams.set('per_page', '100');
			iconLibraryRequestUrl.searchParams.set('context', 'view');
			const response = await fetch(iconLibraryRequestUrl.toString(), {
				headers: { 'X-WP-Nonce': SFE.ManagerData.nonce },
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const icons = await response.json();
			mediaLibraryCache?.set('icon', { items: icons });
			renderIcons(icons);
		} catch (error) {
			console.error('FrontEdit: failed to load the Icon Library', error);
			grid.innerHTML = `<div class="mwp-sfe-media-library-message" style="color:#dc3232;">Unable to load the Icon Library: ${error.message}</div>`;
		}
	}

	// ─── Main entry point ────────────────────────────────────────────────────

	/**
	 * Build the explicit schema media descriptor consumed by MediaHelper and the
	 * schema media editing UI.
	 *
	 * @param {object|null} component Editable schema component definition.
	 * @returns {object|null} Normalized schema media descriptor, or null when invalid.
	 */
	function buildSchemaMediaDescriptor(component) {
		const mediaDescriptor = component?.mediaDescriptor && typeof component.mediaDescriptor === 'object'
			? component.mediaDescriptor
			: null;
		const targetSource = component?.target && typeof component.target === 'object'
			? component.target
			: null;
		const descriptor = mediaDescriptor || {
			componentId: component?.id || '',
			scopeSelector: component?.selector || '',
			targetSelector: targetSource?.selector || '',
			attribute: targetSource?.attribute || '',
			mediaType: targetSource?.mediaType || '',
		};

		const MediaHelper = SFE.MediaHelper || null;
		return MediaHelper?.isSchemaMediaDescriptor?.(descriptor) ? descriptor : null;
	}

	/**
	 * Resolve every schema target element that should receive the current media value.
	 *
	 * @param {HTMLElement|null} mediaEl         Active schema component root element.
	 * @param {object|null}      mediaDescriptor Schema media descriptor.
	 * @returns {HTMLElement[]} Ordered list of target elements within the component.
	 */
	function resolveComponentMediaTargets(mediaEl, mediaDescriptor) {
		const targetSelector = typeof mediaDescriptor?.targetSelector === 'string'
			? mediaDescriptor.targetSelector.trim()
			: '';
		if (!mediaEl || !targetSelector) return [];

		if (targetSelector === ':self') {
			return [mediaEl];
		}

		const targets = [];
		if (mediaEl.matches && mediaEl.matches(targetSelector)) {
			targets.push(mediaEl);
		}

		if (typeof mediaEl.querySelectorAll === 'function') {
			mediaEl.querySelectorAll(targetSelector).forEach(node => {
				if (!targets.includes(node)) {
					targets.push(node);
				}
			});
		}

		return targets;
	}

	/**
	 * Read the currently displayed media URL from a schema media component.
	 *
	 * @param {HTMLElement|null} mediaEl         Active schema component root element.
	 * @param {object|null}      mediaDescriptor Schema media descriptor.
	 * @param {object|null}      MediaHelper     Shared media helper utilities.
	 * @returns {string} Current media URL for the component.
	 */
	function readComponentMediaUrl(mediaEl, mediaDescriptor, MediaHelper) {
		if (!mediaEl) return '';

		const targets = resolveComponentMediaTargets(mediaEl, mediaDescriptor);
		if (!targets.length) return '';
		const primary = targets[0] || mediaEl;

		if (MediaHelper?.isCssBackgroundElement(primary)) {
			const bg    = primary.style?.backgroundImage || '';
			const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
			return match && match[2] ? match[2] : '';
		}

		const attr = String(mediaDescriptor?.attribute || '').toLowerCase();
		if (!attr) return '';
		if (attr === 'href') {
			return primary.getAttribute('href') || primary.href || '';
		}
		if (attr === 'src') {
			return primary.getAttribute('src') || primary.src || '';
		}
		return primary.getAttribute(attr) || '';
	}

	/**
	 * Apply a new media URL to a schema media component in the live DOM preview.
	 *
	 * @param {HTMLElement|null} mediaEl         Active schema component root element.
	 * @param {object|null}      mediaDescriptor Schema media descriptor.
	 * @param {string}           url             New media URL.
	 * @param {object|null}      MediaHelper     Shared media helper utilities.
	 * @returns {HTMLElement|null} Updated component root element reference.
	 */
	function writeComponentMediaUrl(mediaEl, mediaDescriptor, url, MediaHelper) {
		if (!mediaEl) return mediaEl;

		const targets = resolveComponentMediaTargets(mediaEl, mediaDescriptor);
		if (!targets.length) return mediaEl;
		const attr = String(mediaDescriptor?.attribute || '').toLowerCase();
		if (!attr) return mediaEl;
		const updatedTargets = targets.map(target => {
			if (!target) return target;

			if (MediaHelper?.isCssBackgroundElement(target)) {
				target.style.backgroundImage = `url(${url})`;
				return target;
			}

			const tagName = target.tagName ? target.tagName.toUpperCase() : '';
			if (attr === 'src' && (tagName === 'IMG' || tagName === 'VIDEO')) {
				return MediaHelper?.swapIfNeeded ? (MediaHelper.swapIfNeeded(target, url) || target) : target;
			}

			target.setAttribute(attr, url);
			if (attr === 'href' && 'href' in target) {
				target.href = url;
			}

			return target;
		});

		if (targets[0] === mediaEl) {
			return updatedTargets[0] || mediaEl;
		}
		return mediaEl;
	}

	/**
	 * Replace an icon component's rendered SVG preview with the trusted markup
	 * returned by WordPress' Icon Library endpoint.
	 *
	 * @param   {HTMLElement|null} mediaEl Current icon SVG element.
	 * @param   {string}           markup  Icon SVG markup from `/wp/v2/icons`.
	 * @returns {HTMLElement|null} Updated SVG element, or the original element.
	 */
	function writeIconPreview(mediaEl, markup) {
		if (!mediaEl || typeof markup !== 'string' || !markup.trim()) {
			return mediaEl;
		}

		const template     = document.createElement('template');
		template.innerHTML = markup.trim();
		const replacement  = template.content.firstElementChild;
		if (!replacement || replacement.tagName?.toLowerCase() !== 'svg' || !mediaEl.parentNode) {
			return mediaEl;
		}

		mediaEl.parentNode.replaceChild(replacement, mediaEl);
		return replacement;
	}

	/**
	 * Schema mixed-component media editing path.
	 * Runs inside an existing text editor session and must not refetch block attrs.
	 */
	function startSchemaComponentEditing(editorState, component, options = {}) {
		const ctx              = SFE.Context;
		const actionBar        = ctx?.actionBar;
		const buttonManager    = ctx?.buttonManager;
		const { positionFloatingElements } = SFE.PositionManager;
		const MediaHelper      = SFE.MediaHelper;
		const ToolbarManager   = SFE.ToolbarManager || null;
		const postId           = SFE.ManagerData.postId;
		const actionsContainer = editorState?.actionsContainer || null;
		const blockEditSession = editorState?.blockEditSession || null;
		const getRootElement   = () => editorState?.element || null;

		if (!editorState || !component?.element || !getRootElement() || !actionsContainer || !actionBar || !buttonManager) {
			return { cleanup: () => {} };
		}

		const toolbarContainer = ensureToolbarContainer(editorState);
		if (!editorState.attributeChanges || typeof editorState.attributeChanges !== 'object') {
			editorState.attributeChanges = {};
		}

		let mediaEl         = component.element;
		const mediaDescriptor = buildSchemaMediaDescriptor(component);
		const declaredType  = SFE.MediaHelper?.getMediaType?.(mediaDescriptor) || '';
		if (!mediaDescriptor || !declaredType) {
			return { cleanup: () => {} };
		}

		const isCssBg       = MediaHelper?.isCssBackgroundElement?.(mediaEl);
		const mediaType     = (isCssBg && declaredType === 'image_or_video') ? 'image' : declaredType;
		const mediaTypeName = getMediaTypeName(mediaType);

		const baselineUrl       = readComponentMediaUrl(mediaEl, mediaDescriptor, MediaHelper);
		const baselineOuterHTML = mediaEl?.outerHTML || '';
		const baselineChanges   = (
			mediaEl._mwpMediaChanges && typeof mediaEl._mwpMediaChanges === 'object'
		) ? { ...mediaEl._mwpMediaChanges } : null;

		const uploadState = {
			url: baselineChanges?.url || baselineUrl,
			file: null,
			attachmentId: baselineChanges?.id ?? null,
		};

		let disposed = false;
		let currentState = 'idle';
		const toolbarFormats = ToolbarManager && typeof ToolbarManager.resolveFormats === 'function'
			? ToolbarManager.resolveFormats(component?.editorOptions || {}, mediaEl)
			: [];
		let toolbarHost = null;
		let toolbarManager = null;

		const maintainActionBarFocus = () => {
			requestAnimationFrame(() => {
				if (!disposed && actionsContainer && document.body.contains(actionsContainer)) {
					actionsContainer.focus({ preventScroll: true });
				}
			});
		};

		const reposition = () => {
			const rootElement = getRootElement();
			if (!disposed && rootElement) {
				if (toolbarHost?.options && typeof toolbarHost.options === 'object') {
					toolbarHost.options.blockRootElement = rootElement;
				}
				positionFloatingElements(rootElement, editorState.toolbarContainer || null, actionsContainer);
			}
		};

		const syncRootMediaChanges = (changes) => {
			const rootElement = getRootElement();
			if (!rootElement) {
				return;
			}

			if (changes && typeof changes === 'object') {
				rootElement._mwpMediaChanges = { ...changes };
			} else {
				delete rootElement._mwpMediaChanges;
			}
		};

		const serializeToolbarState = (host) => ({
			componentId: String(component?.id || '').trim(),
			align: typeof host.getBlockAlignState === 'function'
				? host.getBlockAlignState()
				: 'none',
			attributeChanges: cloneAttributeChanges(host.attributeChanges),
			mediaUrl: readComponentMediaUrl(mediaEl, mediaDescriptor, MediaHelper),
			mediaMarkup: mediaEl?._mwpMediaChanges?.markup || '',
			mediaChanges: mediaEl?._mwpMediaChanges && typeof mediaEl._mwpMediaChanges === 'object'
				? { ...mediaEl._mwpMediaChanges }
				: null,
		});

		const applyToolbarState = (host, state) => {
			host.attributeChanges = cloneAttributeChanges(state?.attributeChanges);
			editorState.attributeChanges = host.attributeChanges;
			const targetUrl = typeof state?.mediaUrl === 'string'
				? state.mediaUrl
				: baselineUrl;
			mediaEl = writeComponentMediaUrl(mediaEl, mediaDescriptor, targetUrl, MediaHelper);
			if (declaredType === 'icon') {
				mediaEl = writeIconPreview(mediaEl, state?.mediaMarkup || baselineOuterHTML);
			}
			component.element = mediaEl;
			component.mediaDescriptor = mediaDescriptor;
			if (state?.mediaChanges && typeof state.mediaChanges === 'object') {
				mediaEl._mwpMediaChanges = { ...state.mediaChanges };
				syncRootMediaChanges(mediaEl._mwpMediaChanges);
			} else {
				delete mediaEl._mwpMediaChanges;
				syncRootMediaChanges(null);
			}
			markComponentElement();
			const nextAlign = typeof state?.align === 'string' && state.align.trim()
				? state.align.trim().toLowerCase()
				: 'none';
			host.changeBlockAlign(nextAlign, {
				target: 'block',
				targetKey: 'align',
				operation: typeof host.getBlockAlignOperation === 'function'
					? host.getBlockAlignOperation()
					: null,
			});
		};

		const markComponentElement = () => {
			if (!mediaEl) return;
			component.element = mediaEl;
			component.mediaDescriptor = mediaDescriptor;
			if (toolbarHost && typeof toolbarHost.setElement === 'function') {
				toolbarHost.setElement(mediaEl);
				if (toolbarHost.options && typeof toolbarHost.options === 'object') {
					toolbarHost.options.blockRootElement = getRootElement();
				}
			}
			mediaEl.classList.add('mwp-sfe-editable-component', 'mwp-sfe-component-active');
			mediaEl.dataset.mwpSfeEditableComponent = component.id;
			mediaEl.dataset.mwpSfeActiveComponent = component.id;
		};

		if (toolbarContainer && toolbarFormats.length && ToolbarManager) {
			toolbarHost = createMediaToolbarHost({
				editorState,
				component,
				toolbarContainer,
				formats: toolbarFormats,
				getMediaElement: () => mediaEl,
				setMediaElement: (nextElement) => {
					mediaEl = nextElement;
				},
				reposition,
				serializeState: serializeToolbarState,
				applySerializedState: applyToolbarState,
				showMediaReplaceUI: () => showInputUI(),
			});
			toolbarManager = new ToolbarManager(toolbarHost);
			toolbarManager.createToolbar();
			showToolbar(toolbarContainer);
			if (blockEditSession && typeof blockEditSession.registerSnapshotHost === 'function') {
				const textEditorApi = SFE.TextEditor || null;
				blockEditSession.registerSnapshotHost(toolbarHost, {
					editorState,
					scopeId: 'media',
					attachHistoryApi: true,
					seedInitialHistory: true,
					captureSnapshot: ({ editorState: activeEditorState, host }) => (
						textEditorApi &&
						typeof textEditorApi.captureBlockSessionSnapshot === 'function'
					)
						? textEditorApi.captureBlockSessionSnapshot(activeEditorState)
						: serializeToolbarState(host),
					captureSelection: ({ editorState: activeEditorState }) => (
						textEditorApi &&
						typeof textEditorApi.captureBlockSessionSelection === 'function'
					)
						? textEditorApi.captureBlockSessionSelection(activeEditorState)
						: null,
					restoreSnapshot: ({ editorState: activeEditorState, host, snapshot, selectionToRestore }) => {
						if (
							textEditorApi &&
							typeof textEditorApi.restoreBlockSessionSnapshot === 'function' &&
							snapshot &&
							typeof snapshot === 'object' &&
							Object.prototype.hasOwnProperty.call(snapshot, 'rootOuterHTML')
						) {
							textEditorApi.restoreBlockSessionSnapshot(activeEditorState, snapshot, selectionToRestore || null);
							return;
						}

						applyToolbarState(host, snapshot);
					},
				});
			}
			toolbarHost.updateToolbarState();
		}

		editorState.activeSchemaHost = toolbarHost || null;

		const restoreBaselineMedia = () => {
			mediaEl = declaredType === 'icon'
				? writeIconPreview(mediaEl, baselineOuterHTML)
				: writeComponentMediaUrl(mediaEl, mediaDescriptor, baselineUrl, MediaHelper);
			markComponentElement();

			if (baselineChanges) {
				mediaEl._mwpMediaChanges = { ...baselineChanges };
				syncRootMediaChanges(mediaEl._mwpMediaChanges);
			} else {
				delete mediaEl._mwpMediaChanges;
				syncRootMediaChanges(null);
			}

			if (toolbarHost) {
				toolbarHost.updateToolbarState();
			}

			repositionAfterMediaLoad(mediaEl, getRootElement(), toolbarContainer, actionsContainer, positionFloatingElements);
		};

		const applyMediaChange = (url, attachmentId, markup = '') => {
			uploadState.url          = url;
			uploadState.attachmentId = attachmentId;

			mediaEl = declaredType === 'icon'
				? writeIconPreview(mediaEl, markup)
				: writeComponentMediaUrl(mediaEl, mediaDescriptor, url, MediaHelper);
			markComponentElement();

			const mediaChanges = { url };
			if (markup) mediaChanges.markup = markup;
			if (attachmentId != null) mediaChanges.id = attachmentId;
			mediaEl._mwpMediaChanges = mediaChanges;
			syncRootMediaChanges(mediaChanges);

			if (attachmentId != null) {
				SFE.Api.queueResolvedMediaAttributes(editorState, {
					mediaElement: mediaEl,
					syncRootChanges: syncRootMediaChanges
				}).catch(error => {
					console.warn('FrontEdit: failed to resolve schema media attributes', error);
				});
			}

			if (toolbarHost) {
				toolbarHost.saveToHistory();
				toolbarHost.updateToolbarState();
			}

			repositionAfterMediaLoad(mediaEl, getRootElement(), toolbarContainer, actionsContainer, positionFloatingElements);
		};

		if (toolbarHost) {
			toolbarHost.applyMediaSelection = (url, attachmentId, options = {}) => {
				const normalizedUrl = String(url || '').trim();
				if (!normalizedUrl) {
					return false;
				}

				applyMediaChange(normalizedUrl, attachmentId);
				restoreInlineEditButtons(editorState);
				currentState = 'idle';
				requestAnimationFrame(reposition);
				return true;
			};
		}

		const stepBack = () => {
			if (disposed) return false;

			if (currentState === 'library') {
				if (mediaType === 'icon') {
					restoreInlineEditButtons(editorState);
					currentState = 'idle';
					requestAnimationFrame(reposition);
					return true;
				}
				showInputUI({ force: true });
				return true;
			}

			if (currentState === 'input') {
				restoreInlineEditButtons(editorState);
				currentState = 'idle';
				requestAnimationFrame(reposition);
				return true;
			}

			return false;
		};

		const showMediaLibraryUI = () => {
			if (disposed) return;
			currentState = 'library';
			if (mediaType === 'icon') {
				showIconLibrary({
					actionsContainer,
					onBack: stepBack,
					onSelect: (iconName, unusedAttachmentId, iconMarkup) => {
						applyMediaChange(iconName, null, iconMarkup);
						restoreInlineEditButtons(editorState);
						currentState = 'idle';
						requestAnimationFrame(reposition);
					},
					reposition,
					maintainFocus: maintainActionBarFocus,
				});
				return;
			}
			showMediaLibrary({
				actionsContainer,
				mediaType,
				mediaTypeName,
				postId,
				onBack: stepBack,
				onSelect: (url, attachmentId) => {
					applyMediaChange(url, attachmentId);
					restoreInlineEditButtons(editorState);
					currentState = 'idle';
					requestAnimationFrame(reposition);
				},
				reposition,
				maintainFocus: maintainActionBarFocus
			});
		};

		const showInputUI = (options = {}) => {
			if (disposed) return false;
			if (mediaType === 'icon') {
				showMediaLibraryUI();
				return true;
			}

			const force = options.force === true;

			// Replace Media UI is already open. Do not rebuild it.
			if (!force && (currentState === 'input' || currentState === 'library')) {
				maintainActionBarFocus();
				return false;
			}

			currentState = 'input';

			uploadState.url          = '';
			uploadState.file         = null;
			uploadState.attachmentId = null;

			const isAttrsLoading = !!actionsContainer.querySelector(
				'.mwp-sfe-btn-primary-inline[data-loading-attrs]'
			);

			releaseMediaElements(actionsContainer);
			actionsContainer.innerHTML = '';
			actionsContainer.appendChild(buildInputUI({
				state: uploadState,
				mediaType,
				mediaTypeName,
				mediaDescriptor,
				isAttrsLoading,
				onUploadSuccess: (url, attachmentId) => {
					applyMediaChange(url, attachmentId);
					restoreInlineEditButtons(editorState);
					currentState = 'idle';
					requestAnimationFrame(reposition);
				},
				onBrowse: showMediaLibraryUI,
				onCancel: () => {
					restoreInlineEditButtons(editorState);
					currentState = 'idle';
					requestAnimationFrame(reposition);
				},
				maintainFocus: maintainActionBarFocus
			}));

			maintainActionBarFocus();
			requestAnimationFrame(reposition);
			return true;
		};

		restoreInlineEditButtons(editorState);
		currentState = 'idle';
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				reposition();
			});
		});

		return {
			handleEscape: stepBack,
			getEditorHost: () => toolbarHost,
			applySelection: (url, attachmentId) => {
				if (disposed || !url) return false;
				applyMediaChange(url, attachmentId);
				restoreInlineEditButtons(editorState);
				currentState = 'idle';
				requestAnimationFrame(reposition);
				return true;
			},
			showInputUI: () => showInputUI(),
			showMediaLibraryUI: () => {
				if (disposed) return false;
				showMediaLibraryUI();
				return true;
			},
			cleanup: (cleanupOptions = {}) => {
				const preserveChanges = cleanupOptions.preserveChanges !== false;
				const preserveToolbarDom = cleanupOptions.preserveToolbarDom === true;
				disposed = true;
				releaseMediaElements(actionsContainer);
				if (editorState.activeSchemaHost === toolbarHost) {
					editorState.activeSchemaHost = null;
				}
				if (toolbarManager && typeof toolbarManager.destroy === 'function') {
					toolbarManager.destroy({ removeToolbar: !preserveToolbarDom });
				}
				toolbarManager = null;
				toolbarHost = null;
				if (!preserveChanges) {
					restoreBaselineMedia();
					// Full teardown path (explicit discard): clear panel content now.
					actionsContainer.innerHTML = '';
				}
				// Preserve-path cleanup is used by component switches and editor close.
				// Keep existing action-bar DOM until the next state render / close
				// animation to avoid flashing an empty wrapper mid-transition.
			}
		};
	}

	function findScopedComponentElement(rootElement, selector) {
		if (!rootElement || !selector) return null;

		if (rootElement.matches(selector)) {
			const owner = rootElement.closest('[data-mwp-sfe-uuid]');
			if (!owner || owner === rootElement) return rootElement;
		}

		const matches = rootElement.querySelectorAll(selector);
		for (const candidate of matches) {
			const owner = candidate.closest('[data-mwp-sfe-uuid]');
			if (!owner || owner === rootElement) {
				return candidate;
			}
		}

		return null;
	}

	function buildStandaloneSchemaMediaComponent(rootElement, handler) {
		const configured = Array.isArray(handler?.client_config?.editableComponents)
			? handler.client_config.editableComponents
			: [];
		if (!configured.length) return null;

		const fileComponents = configured
			.filter(component => (
				component &&
				typeof component === 'object' &&
				typeof component.type === 'string' &&
				component.type.trim().toLowerCase() === 'file'
			))
			.sort((a, b) => Number(!!b.default) - Number(!!a.default));
		if (!fileComponents.length) return null;

		for (let i = 0; i < fileComponents.length; i++) {
			const component = fileComponents[i];
			const selector = typeof component.selector === 'string' ? component.selector.trim() : '';
			const mediaDescriptor = buildSchemaMediaDescriptor(component);
			if (!selector || !mediaDescriptor) {
				continue;
			}

			const element = findScopedComponentElement(rootElement, selector);
			if (!element) {
				continue;
			}

			const id = typeof component.id === 'string' && component.id.trim()
				? component.id.trim()
				: `schema_media_component_${i + 1}`;

			return {
				id,
				label: typeof component.label === 'string' && component.label.trim()
					? component.label.trim()
					: id,
				type: 'file',
				selector,
				default: !!component.default,
				element,
				editorOptions: component.editor && typeof component.editor === 'object'
					? { ...component.editor }
					: {},
				target: {
					selector: mediaDescriptor.targetSelector,
					attribute: mediaDescriptor.attribute,
					mediaType: mediaDescriptor.mediaType,
				},
				mediaDescriptor: {
					...mediaDescriptor,
					componentId: id,
					scopeSelector: selector,
				},
				urlBindingPath: typeof component.urlBindingPath === 'string'
					? component.urlBindingPath.trim()
					: '',
				idBindingPath: typeof component.idBindingPath === 'string'
					? component.idBindingPath.trim()
					: '',
			};
		}

		return null;
	}

	/**
	 * Content-type-specific: Media Editing
	 * Receives common state, adds media-specific resources, returns complete editor state.
	 */
	function startMediaEditing(commonState) {
		const ctx = SFE.Context;
		const { debouncedPosition } = SFE.PositionManager;
		const { element, handler, actionsContainer } = commonState;

		ctx.activeMode = 'media';

		const schemaComponent = buildStandaloneSchemaMediaComponent(element, handler);
		if (!schemaComponent) {
			console.error('FrontEdit: startMediaEditing requires a schema file component', handler?.id || '');
			alert('No media element found to edit.');
			return commonState;
		}

		const schemaEditorState = {
			...commonState,
			editableComponents: [schemaComponent],
			activeEditableComponent: schemaComponent,
			activeComponentId: schemaComponent.id,
		};
		ensureToolbarContainer(schemaEditorState);

		const mediaSession = startSchemaComponentEditing(schemaEditorState, schemaComponent, {
			onCancel: () => {
				const activeState = SFE.Context.activeEditor || schemaEditorState;
				SFE.closeInPlaceEditor(activeState, true);
			},
		});

		const updatePositions = () => debouncedPosition(element, schemaEditorState.toolbarContainer || null, actionsContainer);
		window.addEventListener('scroll', updatePositions, true);

		const resizeObserver = new ResizeObserver(updatePositions);
		resizeObserver.observe(element);

		const escapeHandler = (e) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			const activeState = SFE.Context.activeEditor || schemaEditorState;
			const activeSession = activeState?._mwpSchemaMediaSession || mediaSession;
			if (
				activeSession &&
				typeof activeSession.handleEscape === 'function' &&
				activeSession.handleEscape()
			) {
				return;
			}
			SFE.closeInPlaceEditor(activeState, true);
		};
		document.addEventListener('keydown', escapeHandler);

		schemaEditorState._mwpSchemaMediaSession = mediaSession;
		schemaEditorState._mwpActiveComponentType = 'file';
		schemaEditorState.updatePositions = updatePositions;
		schemaEditorState.resizeObserver = resizeObserver;
		schemaEditorState.escapeHandler = escapeHandler;
		schemaEditorState.isMediaEditor = true;
		return schemaEditorState;
	}

	SFE.MediaEditor = { startMediaEditing, startSchemaComponentEditing };

})();
