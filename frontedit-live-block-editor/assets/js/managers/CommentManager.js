/**
 * Comment mode - start/exit inline commenting on an element,
 * and the shared comment-form DOM builder used by both the standard
 * action-bar comment flow and the batch editing comment flow.
 *
 * Reads (via globals set by earlier modules):
 *   SFE.Context            - .activeMode (r/w), .actionBar
 *   SFE.ElementState       - .ElementState
 *   SFE.FocusManager       - .createFocusManager
 *   SFE.OverlayManager
 *   SFE.LifecycleHelpers   - .createFadeHandler
 *   SFE.Api                - .apiCall
 *   SFE.ElementPrep
 *   SFE.TIMING
 *   SFE.ManagerData        - .postId
 *   SFE.showInlineSuccess  - set by SaveManager
 *   SFE.closeAnyActiveMode - set by frontend-inline-edit.js
 *
 * Exposes: SFE.CommentManager
 *   { startCommenting, exitCommentMode, buildCommentForm }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	function startCommenting(bar, element, handlers, uuid) {
		const ctx                    = SFE.Context;
		const { ElementState }       = SFE.ElementState;
		const { createFocusManager } = SFE.FocusManager;
		const actionBar              = ctx.actionBar;

		SFE.closeAnyActiveMode();
		ctx.activeMode = 'comment';
		ElementState.markActive(element, 'commenting');

		const commentForm = SFE.CommentManager.buildCommentForm(
			element, handlers, uuid,
			() => exitCommentMode(bar, element, uuid)
		);
		actionBar.updateState({
			bar,
			element,
			state:   'comment',
			content: { customElement: commentForm }
		});

		// Escape exits comment mode; no fading on blur (mode toggle handles preview)
		bar._cleanupCommentFocus = createFocusManager([], {
			escapeHandler: (e) => {
				if (e.key === 'Escape') exitCommentMode(bar, element, uuid);
			}
		});
	}

	function exitCommentMode(bar, element, uuid) {
		const ctx       = SFE.Context;
		const actionBar = ctx.actionBar;

		const commentCleanup = () => {
			if (bar._cleanupCommentFocus) {
				bar._cleanupCommentFocus();
				delete bar._cleanupCommentFocus;
			}
		};

		ctx.activeMode = null;
		actionBar.reset(bar, element, uuid, commentCleanup);
	}

	/**
	 * Build the comment form DOM element shared between the standard comment
	 * flow (action-bar state 'comment') and the batch editing flow.
	 *
	 * The returned wrapper is NOT appended to anything - the caller decides
	 * where it goes (typically inside the action bar).
	 *
	 * @param  {Element}   element   The editable block element being commented on.
	 * @param  {Array}     handlers  All handlers bound to the element.
	 * @param  {string}    uuid      The block UUID.
	 * @param  {Function}  onCancel  Called after a successful submit OR when the
	 *                               Cancel button is clicked.  In the standard
	 *                               flow this exits comment mode; in batch mode
	 *                               it restores the action bar to its base state.
	 * @return {HTMLDivElement|null}  The form wrapper, or null if no comment handler.
	 */
	function buildCommentForm(element, handlers, uuid, onCancel) {
		const commentHandler = handlers.find(h => h.capability === 'comment');
		if (!commentHandler) return null;

		const { apiCall } = SFE.Api;
		const ElementPrep = SFE.ElementPrep;
		const TIMING      = SFE.TIMING;
		const postId      = (SFE.ManagerData || {}).postId;

		const wrapper     = document.createElement('div');
		wrapper.className = 'mwp-sfe-inline-comment-form';
		wrapper.addEventListener('click', e => e.stopPropagation());

		const textarea       = document.createElement('textarea');
		textarea.className   = 'mwp-sfe-text-entry mwp-sfe-inline-comment-textarea';
		textarea.placeholder = 'Type your comment...';

		const actions     = document.createElement('div');
		actions.className = 'mwp-sfe-inline-comment-actions';

		const submitBtn       = document.createElement('button');
		submitBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-primary-inline';
		submitBtn.textContent = 'Submit';
		submitBtn.disabled    = true;

		const cancelBtn       = document.createElement('button');
		cancelBtn.className   = 'mwp-sfe-btn mwp-sfe-btn-secondary-inline';
		cancelBtn.textContent = 'Cancel';

		actions.appendChild(submitBtn);
		actions.appendChild(cancelBtn);
		wrapper.appendChild(textarea);
		wrapper.appendChild(actions);

		/**
		 * Sync the submit button with the trimmed textarea value so empty
		 * comments are visibly non-submittable before the click path runs.
		 *
		 * @return {void}
		 */
		function syncSubmitState() {
			submitBtn.disabled = !textarea.value.trim();
		}

		textarea.addEventListener('input', syncSubmitState);

		cancelBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			onCancel();
		};

		submitBtn.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const comment = textarea.value.trim();
			if (!comment) return;

			try {
				await apiCall('/comment', {
					post_id:      postId,
					element_uuid: uuid,
					handler_id:   commentHandler.id,
					comment,
					element_text: ElementPrep.getContent(element, commentHandler.contentType || 'text')
				}, submitBtn);

				SFE.showInlineSuccess(
					{ element, uuid },
					'Comment Submitted',
					null,
					false,
					'comment'
				);
				onCancel();
			} catch (error) {
				alert('Error: ' + error.message);
			}
		};

		// Defer focus so the element is attached to the DOM first.
		const focusDelay = TIMING?.FOCUS_DEBOUNCE ?? 50;
		setTimeout(() => textarea.focus(), focusDelay);
		syncSubmitState();

		return wrapper;
	}

	SFE.CommentManager = { startCommenting, exitCommentMode, buildCommentForm };

})();
