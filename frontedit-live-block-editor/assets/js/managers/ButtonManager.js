/**
 * Button manager - centralizes button config objects for the action bar
 *
 * Reads (via globals):
 *   SFE.BatchEditManager   - .isSessionActive, .isEnabled
 *   SFE.Api                - .apiCall
 *   SFE.PostLockManager    - .ensureLock, .handleLockedError
 *   SFE.Context            - .uuidMap, .pageRevisionToken
 *   SFE.SaveHelpers        - .updatePageRevisionToken
 *   SFE.showInlineSuccess  - set by SaveManager
 *   SFE.closeDraftPreview  - set by DraftManager
 *   SFE.ManagerData        - .postId, .hasPro, .canManageDrafts
 *
 * Exposes: SFE.ButtonManager  (class - instantiated by frontend-inline-edit.js)
 *   { getLoadingConfig, getEditButtons, getEditDraftConfig, getClosePreviewConfig,
 *     getCloseConfig, getApproveDraftConfig, getDiscardDraftConfig,
 *     getDraftPreviewButtons, getMediaSaveButtons }
 */
(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	class ButtonManager {
		constructor(deps) {
			// Store dependencies passed from the main app
			this.perms = deps.perms;
			// These methods will be assigned later by the main app
			this.handleInlineSave   = deps.handleInlineSave   || null;
			this.closeInPlaceEditor = deps.closeInPlaceEditor || null;
			this.editPendingDraft   = deps.editPendingDraft   || null;
			this.closeDraftPreview  = deps.closeDraftPreview  || null;
		}

		/**
		 * Get loading button config
		 */
		getLoadingConfig(text) {
			return {
				text:      text || 'Saving...',
				className: 'mwp-sfe-btn mwp-sfe-btn-primary-inline',
				disabled:  true,
				loading:   true
			};
		}

		/**
		 * Get the Save + Cancel button configs for the 'edit' state.
		 * Save label reflects batch-session state and publish permissions.
		 * Buttons store themselves on the bar (_saveBtn / _cancelBtn) via storeAs
		 * so that editors can look them up after updateState() returns.
		 */
		getEditButtons() {
			let saveText;

			if (this.perms.can_publish) {
				saveText = 'Save Changes';
			} else if (this.perms.can_draft) {
				saveText = 'Submit for Review';
			} else {
				saveText = 'Save';
			}

			return {
				buttons: [
					{
						text:      saveText,
						className: 'mwp-sfe-btn mwp-sfe-btn-primary-inline',
						storeAs:   'saveBtn'
					},
					{
						text:      'Cancel',
						className: 'mwp-sfe-btn mwp-sfe-btn-secondary-inline',
						storeAs:   'cancelBtn'
					}
				]
			};
		}

		/**
		 * Get Edit Draft button config
		 */
		getEditDraftConfig(bar, element, handlers, uuid) {
			return {
				text:      'Edit',
				className: 'mwp-sfe-btn mwp-sfe-btn-secondary-inline',
				onClick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (this.editPendingDraft) this.editPendingDraft(bar, element, handlers, uuid);
				}
			};
		}

		/**
		 * Get Close Preview button config
		 */
		getClosePreviewConfig(bar, element, handlers, uuid) {
			return {
				text:      'Close',
				className: 'mwp-sfe-btn mwp-sfe-btn-secondary-inline',
				onClick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (this.closeDraftPreview) this.closeDraftPreview(bar, element, uuid);
				}
			};
		}

		/**
		 * Get Close button config (for error states)
		 */
		getCloseConfig(bar, element, handlers, uuid) {
			return this.getClosePreviewConfig(bar, element, handlers, uuid); // Reuse logic
		}

		/**
		 * Get Approve Draft button config.
		 * Calls the Pro draft-decision route, then refreshes the element HTML
		 * via showInlineSuccess so the live element reflects the approved content.
		 */
		getApproveDraftConfig(bar, element, handlers, uuid) {
			return {
				text:      'Approve',
				className: 'mwp-sfe-btn mwp-sfe-btn-primary-inline',
				onClick: async (e) => {
					e.preventDefault();
					e.stopPropagation();
					const btn     = e.currentTarget;
					const apiCall = SFE.Api?.apiCall;
					if ( ! apiCall ) return;

					const ctx     = SFE.Context;
					const version = ctx?.uuidMap?.[ uuid ]?.pending_info?.version ?? null;
					if ( version === null ) {
						console.warn( 'FrontEdit: No pending_info.version for', uuid );
						return;
					}

					if (!await SFE.PostLockManager.ensureLock()) return;

					// Lock the full UI
					const { lockSaveUI, unlockSaveUI } = SFE.SaveHelpers || {};
					bar.querySelectorAll( '.mwp-sfe-btn' ).forEach( b => {
						if ( b !== btn ) b.disabled = true;
					} );
					if ( lockSaveUI ) {
						lockSaveUI( btn );
					} else {
						btn.disabled = true;
						btn.setAttribute( 'mwp-sfe-btn-loading', 'true' );
					}

					const restoreBtn = () => {
						if ( unlockSaveUI ) {
							unlockSaveUI( btn );
						} else {
							btn.disabled = false;
							btn.removeAttribute( 'mwp-sfe-btn-loading' );
						}
						// Re-enable the other bar buttons so the user can try again.
						bar.querySelectorAll( '.mwp-sfe-btn' ).forEach( b => {
							b.disabled = false;
							b.removeAttribute( 'mwp-sfe-btn-loading' );
						} );
					};
					const reloadAfterRefreshFailure = (message) => {
						if (SFE.SaveHelpers && typeof SFE.SaveHelpers.reloadAfterRefreshFailure === 'function') {
							SFE.SaveHelpers.reloadAfterRefreshFailure(message);
							return;
						}
						if (message) console.error(message);
						window.location.reload();
					};

					const doApprove = async ( includeToken ) => {
						const payload = {
							post_id:      SFE.ManagerData.postId,
							element_uuid: uuid,
							version,
							decision:     'approve',
						};
						if ( includeToken ) {
							payload.page_revision_token = ctx?.pageRevisionToken || 0;
						}
						return apiCall( '/pro/decide-draft', payload );
					};

					try {
						const result = await doApprove( true );

						// Keep the client token current so subsequent saves on this
						// session don't false-conflict against the revision we just created.
						SFE.SaveHelpers?.updatePageRevisionToken( result );

						// Fetch the freshly-rendered approved block HTML from the current page render and swap it in.
						const blockHTML = await SFE.SaveHelpers.fetchRenderedBlockHTML( uuid, { force: true } );

						if ( blockHTML ) {
							// Reuse the save-success path: re-enables hover, resets state, re-attaches.
							const mockState = {
								element,
								uuid,
								actionsContainer: bar,
								handler: handlers.find( h => h.capability === 'edit' ) || handlers[0],
							};
							// Update uuidMap so the element is no longer flagged as pending.
							if ( ctx?.uuidMap?.[ uuid ] ) {
								ctx.uuidMap[ uuid ].is_pending = false;
								delete ctx.uuidMap[ uuid ].pending_info;
							}
							SFE.showInlineSuccess( mockState, 'Draft Approved', blockHTML, false );
						} else {
							reloadAfterRefreshFailure( 'FrontEdit: Draft approval succeeded but refreshed block HTML was unavailable.' );
							return;
						}
					} catch ( err ) {
						if ( err.message === 'POST_LOCKED' ) {
							await SFE.PostLockManager.handleLockedError( err );
							restoreBtn();
							return;
						}
						if ( err.message === 'BLOCK_HTML_REFRESH_FAILED' ) {
							reloadAfterRefreshFailure( 'FrontEdit: Draft approval succeeded but refreshed block HTML could not be extracted from the post render.' );
							return;
						}
						if ( err.message === 'REVISION_CONFLICT' ) {
							const saveAnyway = confirm(
								'This page was updated by another user since you started editing. ' +
								'Approving now may overwrite their recent changes.\n\n' +
								'Press OK to approve anyway, or Cancel to refresh the page.'
							);
							if ( ! saveAnyway ) {
								restoreBtn();
								window.location.reload();
								return;
							}
							// Retry without the conflict token so the server force-approves.
							try {
								await doApprove( false );
								const blockHTML = await SFE.SaveHelpers.fetchRenderedBlockHTML( uuid, { force: true } );
								if ( blockHTML ) {
									const mockState = {
										element,
										uuid,
										actionsContainer: bar,
										handler: handlers.find( h => h.capability === 'edit' ) || handlers[0],
									};
									if ( ctx?.uuidMap?.[ uuid ] ) {
										ctx.uuidMap[ uuid ].is_pending = false;
										delete ctx.uuidMap[ uuid ].pending_info;
									}
									SFE.showInlineSuccess( mockState, 'Draft Approved', blockHTML, false );
									setTimeout( () => window.location.reload(), SFE.TIMING?.EDIT_DELAY || 300 );
								} else {
									reloadAfterRefreshFailure( 'FrontEdit: Draft approval retry succeeded but refreshed block HTML was unavailable.' );
									return;
								}
							} catch ( retryErr ) {
								if ( retryErr.message === 'BLOCK_HTML_REFRESH_FAILED' ) {
									reloadAfterRefreshFailure( 'FrontEdit: Draft approval retry succeeded but refreshed block HTML could not be extracted from the post render.' );
									return;
								}
								console.error( 'FrontEdit: Approve retry failed', retryErr );
								restoreBtn();
							}
							return;
						}
						console.error( 'FrontEdit: Approve failed', err );
						if ( err.message && err.message.indexOf( '403' ) !== -1 ) {
							alert( 'You no longer have permission to approve drafts. Your publish access may have been changed. Please refresh the page.' );
						}
						restoreBtn();
					}
				}
			};
		}

		/**
		 * Get Discard Draft button config.
		 * Calls the Pro draft-decision route with `deny`, then shows a red banner,
		 * restoring the original live element without changing post content.
		 */
		getDiscardDraftConfig(bar, element, handlers, uuid) {
			return {
				text:      'Discard',
				className: 'mwp-sfe-btn mwp-sfe-btn-secondary-inline',
				onClick: async (e) => {
					e.preventDefault();
					e.stopPropagation();
					const btn     = e.currentTarget;
					const apiCall = SFE.Api?.apiCall;
					if ( ! apiCall ) return;

					const ctx     = SFE.Context;
					const version = ctx?.uuidMap?.[ uuid ]?.pending_info?.version ?? null;
					if ( version === null ) {
						console.warn( 'FrontEdit: No pending_info.version for', uuid );
						return;
					}

					// Lock the full UI
					const { lockSaveUI, unlockSaveUI } = SFE.SaveHelpers || {};
					bar.querySelectorAll( '.mwp-sfe-btn' ).forEach( b => {
						if ( b !== btn ) b.disabled = true;
					} );
					if ( lockSaveUI ) {
						lockSaveUI( btn );
					} else {
						btn.disabled = true;
						btn.setAttribute( 'mwp-sfe-btn-loading', 'true' );
					}

					try {
						await apiCall( '/pro/decide-draft', {
							post_id:      SFE.ManagerData.postId,
							element_uuid: uuid,
							version,
							decision:     'deny',
						} );

						// Update uuidMap so the element is no longer flagged as pending.
						if ( ctx?.uuidMap?.[ uuid ] ) {
							ctx.uuidMap[ uuid ].is_pending = false;
							delete ctx.uuidMap[ uuid ].pending_info;
						}

						// showInlineSuccess with isDraft=true restores via editorState.originalOuterHTML.
						// The original (live) element was stashed in bar._originalElement by DraftManager
						// when the draft was swapped in - use its outerHTML as the restore source.
						const mockState = {
							element,
							uuid,
							actionsContainer:    bar,
							originalOuterHTML:   bar._originalElement?.outerHTML ?? element.outerHTML,
							clearPending:        true,
							handler: handlers.find( h => h.capability === 'edit' ) || handlers[0],
						};
						SFE.showInlineSuccess( mockState, 'Draft Discarded', null, true, 'discard' );
					} catch ( err ) {
						console.error( 'FrontEdit: Discard failed', err );
						if ( err.message && err.message.indexOf( '403' ) !== -1 ) {
							alert( 'You no longer have permission to discard drafts. Your publish access may have been changed. Please refresh the page.' );
						}
						// Unlock the full UI on error so the user can try again.
						if ( unlockSaveUI ) {
							unlockSaveUI( btn );
						} else {
							btn.disabled = false;
							btn.removeAttribute( 'mwp-sfe-btn-loading' );
						}
						bar.querySelectorAll( '.mwp-sfe-btn' ).forEach( b => {
							b.disabled = false;
							b.removeAttribute( 'mwp-sfe-btn-loading' );
						} );
					}
				}
			};
		}

		/**
		 * Get complete content config for draft preview (loaded state).
		 *
		 * Returns { header, buttons } so the action bar can render a
		 * draft-specific header that updates on button hover.
		 *
		 * Permission model:
		 * - can_publish  – Approve + Discard + (pro: Edit Draft) + Close Preview
		 * - not publish  – Close Preview only (view the draft but cannot decide)
		 */
		getDraftPreviewButtons(bar, element, handlers, uuid) {
			const hasPro        = !! ( SFE.ManagerData?.hasPro );
			const canManageDrafts = SFE.ManagerData?.canManageDrafts === true;
			const elementType   = ( handlers && handlers[0] && handlers[0].elementType ) || 'Element';
			const defaultHeader = `${elementType} • View pending draft.`;
			const buttons       = [];

			if ( canManageDrafts ) {
				const approveConfig       = this.getApproveDraftConfig( bar, element, handlers, uuid );
				approveConfig.hoverHeader = `${elementType} • Approve and publish this draft.`;
				buttons.push( approveConfig );

				const discardConfig       = this.getDiscardDraftConfig( bar, element, handlers, uuid );
				discardConfig.hoverHeader = `${elementType} • Discard this draft.`;
				buttons.push( discardConfig );

				// Pro adds Edit Draft so the content can be changed before approval.
				if ( hasPro ) {
					const editConfig       = this.getEditDraftConfig( bar, element, handlers, uuid );
					editConfig.hoverHeader = `${elementType} • Edit this draft.`;
					buttons.push( editConfig );
				}
			}
			// View-only users may close their preview but cannot act on the draft.

			const closeConfig       = this.getClosePreviewConfig( bar, element, handlers, uuid );
			closeConfig.hoverHeader = `${elementType} • Close draft preview.`;
			buttons.push( closeConfig );

			return { header: defaultHeader, buttons };
		}

		/**
		 * Get Media Save/Back buttons
		 */
		getMediaSaveButtons(onSave, onBack) {
			let saveText = this.perms.can_publish ? 'Save Changes' : 'Submit for Review';
			
			return [
				{
					text: saveText,
					className: 'mwp-sfe-btn mwp-sfe-btn-primary-inline',
					onClick: (e) => {
						e.preventDefault();
						onSave(e);
					}
				},
				{
					text: 'Back',
					className: 'mwp-sfe-btn mwp-sfe-btn-secondary-inline',
					onClick: (e) => {
						e.preventDefault();
						onBack(e);
					}
				}
			];
		}
	}

	// Expose globally
	SFE.ButtonManager = ButtonManager;

})();
