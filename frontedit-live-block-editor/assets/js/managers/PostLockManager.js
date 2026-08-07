/**
 * Native WordPress post-lock coordinator for live FrontEdit sessions.
 *
 * Reads: SFE.Api.apiCall, SFE.ManagerData.postId
 * Exposes: SFE.PostLockManager { beginLockClaim, ensureLock, handleLockedError }
 */
(function() {
	'use strict';
	window.MWP       = window.MWP || {};
	window.MWP.SFE   = window.MWP.SFE || {};
	const SFE        = window.MWP.SFE;
	let ownsLock     = false;
	let refreshTimer = null;
	let pendingClaim = null;

	/**
	 * Prevent editor and draft-preview Escape handlers from closing an active
	 * editing session while the post-lock decision is on screen.
	 *
	 * Window capture runs before the document-level editor lifecycle handlers.
	 *
	 * @param {KeyboardEvent} event Keyboard event.
	 * @returns {void}
	 */
	window.addEventListener('keydown', (event) => {
		if (
			event.key === 'Escape' &&
			document.querySelector('.mwp-sfe-post-lock-modal.is-open')
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}, true);

	function escapeHtml(value) {
		return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
	}

	function showLockModal(owner = {}) {
		return new Promise((resolve) => {
			const modal     = document.createElement('div');
			modal.className = 'mwp-sfe-post-lock-modal is-open';
			modal.setAttribute('data-mwp-sfe-control', 'post-lock-modal');
			modal.innerHTML = `
				<div class="mwp-sfe-post-lock-backdrop"></div>
				<div class="mwp-sfe-post-lock-dialog" role="dialog" aria-modal="true" aria-label="Post locked">
					<section class="mwp-sfe-post-lock-panel">
						<header class="mwp-sfe-post-lock-header">
							<h2 class="mwp-sfe-post-lock-title">Post is being edited</h2>
						</header>
						<div class="mwp-sfe-post-lock-body">
							<p class="mwp-sfe-post-lock-copy">${escapeHtml(owner.name || 'Another user')} is currently working on this post, which means you cannot make changes, unless you take over.</p>
							<p class="mwp-sfe-post-lock-copy">If you take over, the other user will lose editing control to the post, but their changes will be saved.</p>
							<div class="mwp-sfe-post-lock-actions">
								<button type="button" class="mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-sfe-post-lock-takeover">Take over</button>
								<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-sfe-post-lock-cancel">Cancel</button>
							</div>
						</div>
					</section>
				</div>`;
			document.body.appendChild(modal);
			modal.querySelector('.mwp-sfe-post-lock-cancel').addEventListener('click', () => { modal.remove(); resolve(false); });
			modal.querySelector('.mwp-sfe-post-lock-takeover').addEventListener('click', () => { modal.remove(); resolve(true); });
		});
	}

	function beginRefresh() {
		if (refreshTimer) return;
		refreshTimer = window.setInterval(async () => {
			if (!ownsLock) return;
			try {
				await SFE.Api.apiCall('/post-lock/claim', { post_id: SFE.ManagerData.postId });
			} catch (error) {
				ownsLock = false;
				clearInterval(refreshTimer);
				refreshTimer = null;
			}
		}, 60000);
	}

	/**
	 * Start one shared lock-claim operation for the current post.
	 *
	 * Opening an editor does not need to wait for this request, but every
	 * published-content mutation must await the returned promise before it
	 * reaches the server. Sharing the promise keeps concurrent editor opens and
	 * saves from issuing competing claims or bypassing the pending decision.
	 *
	 * @returns {Promise<boolean>} Whether this user holds the post lock.
	 */
	function beginLockClaim() {
		if (ownsLock) return Promise.resolve(true);
		if (pendingClaim) return pendingClaim;

		pendingClaim = (async () => {
			try {
				await SFE.Api.apiCall('/post-lock/claim', { post_id: SFE.ManagerData.postId });
			} catch (error) {
				if (error.message !== 'POST_LOCKED' || !await showLockModal(error?.payload?.lock?.owner)) return false;
				try {
					await SFE.Api.apiCall('/post-lock/claim', { post_id: SFE.ManagerData.postId, take_over: true });
				} catch (_) {
					return false;
				}
			}
			ownsLock = true;
			beginRefresh();
			return true;
		})();

		pendingClaim.finally(() => {
			pendingClaim = null;
		});

		return pendingClaim;
	}

	/**
	 * Wait until the current user's native WordPress post lock is held.
	 *
	 * @returns {Promise<boolean>} Whether this user holds the post lock.
	 */
	async function ensureLock() {
		return beginLockClaim();
	}

	async function handleLockedError(error) {
		ownsLock = false;
		if (error?.message !== 'POST_LOCKED') return false;
		if (!await showLockModal(error?.payload?.lock?.owner)) return false;

		try {
			await SFE.Api.apiCall('/post-lock/claim', {
				post_id:   SFE.ManagerData.postId,
				take_over: true
			});
			ownsLock = true;
			beginRefresh();
			return true;
		} catch (_) {
			return false;
		}
	}

	SFE.PostLockManager = { beginLockClaim, ensureLock, handleLockedError };
})();
