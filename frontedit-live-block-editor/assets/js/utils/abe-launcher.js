/**
 * Bottom-right ABE launcher owned by the base frontend editor.
 *
 * Exposes: SFE.ABELauncher { init }
 */
(function() {
	'use strict';

	window.MWP = window.MWP || {};
	window.MWP.SFE = window.MWP.SFE || {};

	const SFE = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};
	const LAUNCHER_VISIBILITY_EVENT = 'mwp-abe-launcher-visibility';
	const SPARKLE_GRADIENT_ID = 'mwp-abe-sparkle-gradient';
	const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
	let visibilityListenerInstalled = false;
	let lifecycleRecoveryInstalled = false;
	let shadowHost = null;
	let shadowRootRef = null;
	let shadowShell = null;
	let teaserUi = null;

	/**
	 * @returns {HTMLButtonElement|null} Current launcher button when mounted.
	 */
	function getLauncherButton() {
		const button = shadowShell ? shadowShell.querySelector('.mwp-abe-launcher') : null;
		return button instanceof HTMLButtonElement ? button : null;
	}

	/**
	 * @returns {HTMLDivElement|null} Shared shadow shell that owns all base ABE UI.
	 */
	function getUiShell() {
		return shadowShell instanceof HTMLDivElement ? shadowShell : null;
	}

	/**
	 * Ensure the shared sparkle gradient defs exist inside the launcher's shadow
	 * shell so the SVG icon can resolve `url(#mwp-abe-sparkle-gradient)`.
	 *
	 * @param {ParentNode|null} container Launcher-owned rendering root.
	 * @returns {SVGSVGElement|null} Hidden defs host when available.
	 */
	function ensureSparkleGradientDefs(container) {
		if (
			!container ||
			typeof container.querySelector !== 'function' ||
			typeof container.insertBefore !== 'function'
		) {
			return null;
		}

		const existingDefs = container.querySelector('.mwp-abe-global-gradients');
		if (existingDefs instanceof SVGSVGElement) {
			return existingDefs;
		}

		const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
		svg.setAttribute('class', 'mwp-abe-global-gradients');
		svg.setAttribute('width', '0');
		svg.setAttribute('height', '0');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		svg.style.position = 'absolute';
		svg.style.pointerEvents = 'none';

		const defs = document.createElementNS(SVG_NAMESPACE, 'defs');
		const gradient = document.createElementNS(SVG_NAMESPACE, 'linearGradient');
		gradient.setAttribute('id', SPARKLE_GRADIENT_ID);
		gradient.setAttribute('x1', '0');
		gradient.setAttribute('y1', '0');
		gradient.setAttribute('x2', '0');
		gradient.setAttribute('y2', '1');

		const startStop = document.createElementNS(SVG_NAMESPACE, 'stop');
		startStop.setAttribute('offset', '25%');
		startStop.setAttribute('stop-color', 'var(--mwp-abe-sparkle-gradient-start)');

		const endStop = document.createElementNS(SVG_NAMESPACE, 'stop');
		endStop.setAttribute('offset', '75%');
		endStop.setAttribute('stop-color', 'var(--mwp-abe-sparkle-gradient-end)');

		gradient.appendChild(startStop);
		gradient.appendChild(endStop);
		defs.appendChild(gradient);
		svg.appendChild(defs);

		container.insertBefore(svg, container.firstChild || null);
		return svg;
	}

	/**
	 * Build or return the shared Shadow DOM host for the launcher-owned ABE UI.
	 *
	 * @returns {HTMLDivElement} Shadow shell container.
	 */
	function ensureUiShell() {
		if (getUiShell()) {
			return shadowShell;
		}

		const config = getConfig();
		shadowHost = document.createElement('div');
		shadowHost.className = 'mwp-abe-shadow-host';
		shadowHost.setAttribute('data-mwp-sfe-control', 'true');
		shadowHost.setAttribute('aria-hidden', 'true');
		shadowHost.style.pointerEvents = 'auto';
		document.body.appendChild(shadowHost);

		shadowRootRef = typeof shadowHost.attachShadow === 'function'
			? shadowHost.attachShadow({ mode: 'open' })
			: shadowHost;

		shadowShell = document.createElement('div');
		shadowShell.className = 'mwp-abe-shadow-shell';
		shadowRootRef.appendChild(shadowShell);
		ensureSparkleGradientDefs(shadowShell);

		(config.styleUrls || []).forEach(styleUrl => {
			if (!styleUrl) {
				return;
			}

			const stylesheet = document.createElement('link');
			stylesheet.rel = 'stylesheet';
			stylesheet.href = styleUrl;
			shadowShell.appendChild(stylesheet);
		});

		return shadowShell;
	}

	/**
	 * @returns {Object} Launcher configuration.
	 */
	function getConfig() {
		const defaults = {
			enabled: false,
			isAvailable: false,
			eventName: 'mwp-abe-launch-request',
			label: 'ABE',
			downloadUrl: '#',
			unavailableTitle: 'AI Assisted Block Editor Coming Soon',
			unavailableSubtitle: 'Sign up for updates.',
			unavailableMessage: 'AI Automated Block Editor is coming soon. Join our waitlist to get early updates, sneak peeks, and be among the first to know when the plugin officially launches. We will let you know as soon as it is available.',
			unavailableCta: 'Join the Waitlist',
			previewCta: 'Preview ABE',
			styleUrls: [],
		};

		return Object.assign({}, defaults, SFE.ManagerData.abeLauncher || {});
	}

	/**
	 * @returns {string} Sparkle icon markup.
	 */
	function buildSparkleIcon() {
		return [
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="2.3 1.6 20 20.7" aria-hidden="true" focusable="false">',
			'<g class="mwp-abe-sparkle-fill-group-1">',
			'<path d="M19.46,8l0.79-1.75L22,5.46c0.39-0.18,0.39-0.73,0-0.91l-1.75-0.79L19.46,2c-0.18-0.39-0.73-0.39-0.91,0l-0.79,1.75 L16,4.54c-0.39,0.18-0.39,0.73,0,0.91l1.75,0.79L18.54,8C18.72,8.39,19.28,8.39,19.46,8z"></path>',
			'</g>',
			'<g class="mwp-abe-sparkle-fill-group-2">',
			'<path d="M11.5,9.5L9.91,6 C9.56,5.22,8.44,5.22,8.09,6L6.5,9.5L3,11.09c-0.78,0.36-0.78,1.47,0,1.82l3.5,1.59L8.09,18c0.36,0.78,1.47,0.78,1.82,0l1.59-3.5 l3.5-1.59c0.78-0.36,0.78-1.47,0-1.82L11.5,9.5z"></path>',
			'</g>',
			'<g class="mwp-abe-sparkle-fill-group-3">',
			'<path d="M18.54,16l-0.79,1.75L16,18.54c-0.39,0.18-0.39,0.73,0,0.91l1.75,0.79L18.54,22 c0.18,0.39,0.73,0.39,0.91,0l0.79-1.75L22,19.46c0.39-0.18,0.39-0.73,0-0.91l-1.75-0.79L19.46,16 C19.28,15.61,18.72,15.61,18.54,16z"></path>',
			'</g>',
			'</svg>',
		].join('');
	}

	/**
	 * @returns {string} Close icon markup.
	 */
	function buildCloseIcon() {
		return [
			'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
			'<path d="M6 6l12 12"></path>',
			'<path d="M18 6L6 18"></path>',
			'</svg>',
		].join('');
	}

	/**
	 * @returns {string} Plus icon markup.
	 */
	function buildPlusIcon() {
		return [
			'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">',
			'<path d="M12 5v14"></path>',
			'<path d="M5 12h14"></path>',
			'</svg>',
		].join('');
	}

	/**
	 * @returns {string} Arrow icon markup.
	 */
	function buildArrowUpIcon() {
		return [
			'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
			'<path d="M12 18V7"></path>',
			'<path d="M7 12l5-5 5 5"></path>',
			'</svg>',
		].join('');
	}

	/**
	 * @param {boolean} isHidden Whether the launcher should be hidden.
	 * @returns {void}
	 */
	function setLauncherVisibility(isHidden) {
		const button = getLauncherButton();
		if (!button) {
			return;
		}

		button.classList.toggle('mwp-abe-launcher-hidden', !!isHidden);
		button.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
		button.tabIndex = isHidden ? -1 : 0;
	}

	/**
	 * Install the visibility event listener only once even if init() reruns.
	 *
	 * @returns {void}
	 */
	function ensureVisibilityListener() {
		if (visibilityListenerInstalled) {
			return;
		}

		document.addEventListener(LAUNCHER_VISIBILITY_EVENT, event => {
			const detail = event && event.detail ? event.detail : {};
			setLauncherVisibility(!!detail.isHidden);
		});

		visibilityListenerInstalled = true;
	}

	/**
	 * Re-run launcher initialization after browser lifecycle changes when the
	 * button should exist but no longer does.
	 *
	 * @returns {void}
	 */
	function recoverLauncherIfMissing() {
		const config = getConfig();
		if (!config.enabled || getLauncherButton()) {
			return;
		}

		init();
	}

	/**
	 * Register lifecycle listeners once so the FrontEdit-owned launcher can restore
	 * itself if a browser/tab transition leaves it detached.
	 *
	 * @returns {void}
	 */
	function ensureLifecycleRecovery() {
		if (lifecycleRecoveryInstalled) {
			return;
		}

		window.addEventListener('pageshow', recoverLauncherIfMissing);
		window.addEventListener('focus', recoverLauncherIfMissing);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				recoverLauncherIfMissing();
			}
		});

		lifecycleRecoveryInstalled = true;
	}

	/**
	 * @param {HTMLElement} element Surface element.
	 * @returns {number} Transition duration in milliseconds.
	 */
	function getTransitionDuration(element) {
		const styles = window.getComputedStyle(element);
		const durations = String(styles.transitionDuration || '0s').split(',');
		const delays = String(styles.transitionDelay || '0s').split(',');
		let longest = 0;

		durations.forEach((duration, index) => {
			const delay = delays[index] || delays[delays.length - 1] || '0s';
			const total = toMilliseconds(duration.trim()) + toMilliseconds(delay.trim());
			longest = Math.max(longest, total);
		});

		return longest;
	}

	/**
	 * @param {string} value CSS duration string.
	 * @returns {number} Milliseconds.
	 */
	function toMilliseconds(value) {
		if (!value) {
			return 0;
		}

		if (value.endsWith('ms')) {
			return Number.parseFloat(value) || 0;
		}

		if (value.endsWith('s')) {
			return (Number.parseFloat(value) || 0) * 1000;
		}

		return Number.parseFloat(value) || 0;
	}

	/**
	 * @param {HTMLElement} element Surface element.
	 * @returns {void}
	 */
	function showSurface(element) {
		if (!element) {
			return;
		}

		if (element._mwpAbeHideTimeoutId) {
			window.clearTimeout(element._mwpAbeHideTimeoutId);
			element._mwpAbeHideTimeoutId = 0;
		}

		element.hidden = false;
		element.setAttribute('aria-hidden', 'false');
		if (shadowHost) {
			shadowHost.setAttribute('aria-hidden', 'false');
		}

		element.classList.remove('is-open');
		void element.offsetWidth;
		window.requestAnimationFrame(() => {
			element.classList.add('is-open');
		});
	}

	/**
	 * @param {HTMLElement} element Surface element.
	 * @param {Function|null} [callback=null] Optional callback after hide completes.
	 * @returns {void}
	 */
	function hideSurface(element, callback = null) {
		if (!element) {
			if (typeof callback === 'function') {
				callback();
			}
			return;
		}

		if (element._mwpAbeHideTimeoutId) {
			window.clearTimeout(element._mwpAbeHideTimeoutId);
			element._mwpAbeHideTimeoutId = 0;
		}

		element.classList.remove('is-open');
		element.setAttribute('aria-hidden', 'true');

		const finalize = () => {
			element.hidden = true;
			element._mwpAbeHideTimeoutId = 0;
			if (typeof callback === 'function') {
				callback();
			}
		};

		const duration = getTransitionDuration(element);
		if (duration <= 0) {
			finalize();
			return;
		}

		element._mwpAbeHideTimeoutId = window.setTimeout(finalize, duration + 50);
	}

	/**
	 * @returns {void}
	 */
	function syncShellVisibility() {
		if (!shadowHost || !teaserUi) {
			return;
		}

		const hasOpenSurface = !teaserUi.modal.hidden || !teaserUi.chat.hidden;
		shadowHost.setAttribute('aria-hidden', hasOpenSurface ? 'false' : 'true');
		setLauncherVisibility(hasOpenSurface);
	}

	/**
	 * @param {Object} options Header settings.
	 * @returns {string} Branded header markup.
	 */
	function buildBrandedHeaderMarkup(options) {
		const settings = options && typeof options === 'object' ? options : {};
		const title = String(settings.title || '');
		const subtitle = String(settings.subtitle || '');
		const titleId = String(settings.titleId || '').trim();
		const actionsMarkup = String(settings.actionsMarkup || '');
		const titleAttribute = titleId ? ` id="${titleId}"` : '';

		return `
			<div class="mwp-abe-header mwp-abe-header-branded${settings.headerClassName ? ` ${settings.headerClassName}` : ''}">
				<div class="mwp-abe-header-brand">
					<span class="mwp-abe-sparkle-icon mwp-abe-header-icon">${buildSparkleIcon()}</span>
					<div class="mwp-abe-header-copy mwp-abe-header-copy-branded${settings.copyClassName ? ` ${settings.copyClassName}` : ''}">
						<div class="mwp-abe-kicker">ABE</div>
						<h2${titleAttribute} class="mwp-abe-title">${title}</h2>
						<p class="mwp-abe-subtitle">${subtitle}</p>
					</div>
				</div>
				<div class="mwp-abe-header-actions">${actionsMarkup}</div>
			</div>
		`;
	}

	/**
	 * @param {Object} config Launcher configuration.
	 * @returns {string} Teaser modal markup.
	 */
	function buildTeaserModalMarkup(config) {
		return `
			<div class="mwp-abe-modal-backdrop" data-mwp-abe-unavailable-close="true"></div>
			<div class="mwp-abe-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="mwp-abe-unavailable-title">
				<div class="mwp-abe-panel mwp-abe-modal-panel">
					${buildBrandedHeaderMarkup({
						title: config.unavailableTitle || 'AI Assisted Block Editor Coming Soon',
						subtitle: config.unavailableSubtitle || 'Sign up for updates.',
						titleId: 'mwp-abe-unavailable-title',
						headerClassName: 'mwp-abe-modal-header',
						copyClassName: 'mwp-abe-modal-header-copy',
						actionsMarkup: `<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-abe-close-btn" data-mwp-abe-unavailable-close="true" aria-label="Close ABE notice">${buildCloseIcon()}</button>`,
					})}
					<div class="mwp-abe-modal-body">
						<p class="mwp-abe-subtitle mwp-abe-modal-copy">${config.unavailableMessage || 'AI Automated Block Editor is coming soon. Join our waitlist to get early updates, sneak peeks, and be among the first to know when the plugin officially launches. We will let you know as soon as it is available.'}</p>
						<div class="mwp-abe-preview-actions">
							<a class="mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-abe-modal-button" href="${config.waitlistUrl || '#'}" target="_blank" rel="noopener noreferrer">${config.unavailableCta || 'Join the Waitlist'}</a>
							<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-abe-modal-button" data-mwp-abe-open-preview="true">${config.previewCta || 'Preview ABE'}</button>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	/**
	 * @returns {string} Fake preview chat markup.
	 */
	function buildPreviewChatMarkup() {
		return `
			<div class="mwp-abe-panel">
				${buildBrandedHeaderMarkup({
					title: 'AI Assistant',
					subtitle: 'Ask ABE to update the selected block.',
					actionsMarkup: `<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-abe-close-btn" data-mwp-abe-close-preview="true" aria-label="Close AI Assisted Block Editor">${buildCloseIcon()}</button>`,
				})}
				<div class="mwp-abe-layout">
					<div class="mwp-abe-chat-wrap">
						<div class="mwp-abe-messages" aria-live="polite">
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-1">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>I see the table block you'd like to edit. What would you like to change?</p>
								</div>
							</article>
							<article class="mwp-abe-message is-user" data-mwp-abe-message-id="mwp-abe-runtime-message-2">
								<div class="mwp-abe-message-label">You</div>
								<div class="mwp-abe-message-bubble">
									<p>Can you align both columns center?</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-3">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>I will change the first and second column alignment to center.</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant is-thought-duration" data-mwp-abe-message-id="mwp-abe-runtime-message-4">
								<p class="mwp-abe-thinking-row is-complete">
									<span class="mwp-abe-thinking-text">ABE thought for 4s</span>
								</p>
							</article>
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-5">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>Done. Both columns are now aligned center.</p>
								</div>
							</article>
							<article class="mwp-abe-message is-user" data-mwp-abe-message-id="mwp-abe-runtime-message-6">
								<div class="mwp-abe-message-label">You</div>
								<div class="mwp-abe-message-bubble">
									<p>Now make the column headers plural.</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-7">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>I'll udpate the headers from "Action" and "Expected Result" to "Actions" and "Expected Results."</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant is-thought-duration" data-mwp-abe-message-id="mwp-abe-runtime-message-8">
								<p class="mwp-abe-thinking-row is-complete">
									<span class="mwp-abe-thinking-text">ABE thought for 5s</span>
								</p>
							</article>
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-9">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>Done. The headers for columns one and two now say "Actions" and "Expected Results."</p>
								</div>
							</article>
							<article class="mwp-abe-message is-user" data-mwp-abe-message-id="mwp-abe-runtime-message-10">
								<div class="mwp-abe-message-label">You</div>
								<div class="mwp-abe-message-bubble">
									<p>Looks good. Can you check the table for clarity?</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant" data-mwp-abe-message-id="mwp-abe-runtime-message-11">
								<div class="mwp-abe-message-label">ABE</div>
								<div class="mwp-abe-message-bubble">
									<p>I'll review the table for clarity and suggest any improvements.</p>
								</div>
							</article>
							<article class="mwp-abe-message is-assistant is-pending is-stage-placeholder" data-mwp-abe-message-id="mwp-abe-runtime-message-12">
								<p class="mwp-abe-stage-row">
									<span class="mwp-abe-stage-text is-pending">Checking the target block</span>
								</p>
							</article>
							<article class="mwp-abe-message is-assistant is-pending is-thinking-placeholder" data-mwp-abe-message-id="mwp-abe-runtime-message-13">
								<p class="mwp-abe-thinking-row">
									<span class="mwp-abe-thinking-text is-pending">Thinking</span>
								</p>
							</article>
						</div>
						<form class="mwp-abe-composer" data-mwp-abe-preview-form="true">
							<label class="screen-reader-text" for="mwp-abe-input-preview">AI prompt</label>
							<div class="mwp-abe-composer-footer">
								<textarea id="mwp-abe-input-preview" class="mwp-abe-input" rows="4" placeholder="ABE is AI and can make mistakes. Check all content."></textarea>
								<div class="mwp-abe-composer-drop-status" hidden></div>
								<div class="mwp-abe-composer-overlay">
									<div class="mwp-abe-composer-overlay-upload">
										<div class="mwp-abe-composer-leading-actions">
											<button type="button" class="mwp-sfe-btn mwp-sfe-btn-secondary-inline mwp-abe-upload-btn" aria-label="Upload a file for this chat" title="Upload a file for this chat">${buildPlusIcon()}</button>
										</div>
									</div>
									<div class="mwp-abe-composer-overlay-action">
										<div class="mwp-abe-composer-links" role="group" aria-label="Open AI panels"></div>
										<div class="mwp-abe-composer-actions">
											<button type="submit" class="mwp-sfe-btn mwp-sfe-btn-primary-inline mwp-abe-send-btn" aria-label="Send prompt" title="Send prompt">${buildArrowUpIcon()}</button>
										</div>
									</div>
								</div>
							</div>
						</form>
					</div>
				</div>
			</div>
		`;
	}

	/**
	 * @param {HTMLElement|null} messagesEl Messages container.
	 * @returns {void}
	 */
	function scrollPreviewMessages(messagesEl) {
		if (!messagesEl) {
			return;
		}

		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	/**
	 * Bind the teaser modal controls after the markup renders.
	 *
	 * @param {HTMLDivElement} modal Modal surface.
	 * @returns {void}
	 */
	function bindTeaserModalEvents(modal) {
		modal.addEventListener('click', event => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}

			const closeTrigger = target.closest('[data-mwp-abe-unavailable-close="true"]');
			if (closeTrigger) {
				closeTeaserModal();
			}
		});

		modal.querySelectorAll('[data-mwp-abe-open-preview="true"]').forEach(button => {
			button.addEventListener('click', () => {
				openPreviewChat();
			});
		});
	}

	/**
	 * Bind the fake preview chat controls after the markup renders.
	 *
	 * @param {HTMLElement} chat Chat surface.
	 * @returns {void}
	 */
	function bindPreviewChatEvents(chat) {
		chat.querySelectorAll('[data-mwp-abe-close-preview="true"]').forEach(button => {
			button.addEventListener('click', () => {
				closePreviewChat(true);
			});
		});

		const previewForm = chat.querySelector('[data-mwp-abe-preview-form="true"]');
		if (previewForm instanceof HTMLFormElement) {
			previewForm.addEventListener('submit', event => {
				event.preventDefault();
			});
		}

		scrollPreviewMessages(chat.querySelector('.mwp-abe-messages'));
	}

	/**
	 * Create the teaser modal and preview chat surfaces on first use.
	 *
	 * @returns {{modal: HTMLDivElement, chat: HTMLElement}} Teaser UI record.
	 */
	function ensureTeaserUi() {
		if (teaserUi) {
			return teaserUi;
		}

		const uiShell = ensureUiShell();
		const config = getConfig();
		const modal = document.createElement('div');
		modal.className = 'mwp-abe-modal mwp-abe-unavailable-modal';
		modal.hidden = true;
		modal.setAttribute('data-mwp-sfe-control', 'true');
		modal.setAttribute('aria-hidden', 'true');
		modal.innerHTML = buildTeaserModalMarkup(config);
		bindTeaserModalEvents(modal);

		const chat = document.createElement('aside');
		chat.className = 'mwp-abe-drawer mwp-abe-shell mwp-abe-shell-frontend';
		chat.hidden = true;
		chat.setAttribute('data-mwp-sfe-control', 'true');
		chat.setAttribute('aria-label', 'AI Assisted Block Editor preview');
		chat.setAttribute('aria-hidden', 'true');
		chat.innerHTML = buildPreviewChatMarkup();
		bindPreviewChatEvents(chat);

		uiShell.appendChild(modal);
		uiShell.appendChild(chat);

		document.addEventListener('keydown', event => {
			if (event.key !== 'Escape') {
				return;
			}

			if (teaserUi && !teaserUi.chat.hidden) {
				event.preventDefault();
				closePreviewChat(true);
				return;
			}

			if (teaserUi && !teaserUi.modal.hidden) {
				event.preventDefault();
				closeTeaserModal();
			}
		});

		teaserUi = { modal, chat };
		return teaserUi;
	}

	/**
	 * Re-render the teaser modal with the current launcher config.
	 *
	 * @param {Object} config Launcher configuration.
	 * @returns {void}
	 */
	function refreshTeaserModal(config) {
		const ui = ensureTeaserUi();
		ui.modal.innerHTML = buildTeaserModalMarkup(config);
		bindTeaserModalEvents(ui.modal);
	}

	/**
	 * @returns {void}
	 */
	function showTeaserModal() {
		const ui = ensureTeaserUi();
		hideSurface(ui.chat, () => {
			syncShellVisibility();
		});
		showSurface(ui.modal);
		syncShellVisibility();
	}

	/**
	 * @returns {void}
	 */
	function closeTeaserModal() {
		const ui = ensureTeaserUi();
		hideSurface(ui.modal, () => {
			syncShellVisibility();
		});
	}

	/**
	 * @returns {void}
	 */
	function openPreviewChat() {
		const ui = ensureTeaserUi();
		hideSurface(ui.modal, () => {
			syncShellVisibility();
		});
		showSurface(ui.chat);
		scrollPreviewMessages(ui.chat.querySelector('.mwp-abe-messages'));
		syncShellVisibility();
	}

	/**
	 * @param {boolean} returnToModal Whether the teaser modal should reopen.
	 * @returns {void}
	 */
	function closePreviewChat(returnToModal) {
		const ui = ensureTeaserUi();
		hideSurface(ui.chat, () => {
			if (returnToModal) {
				showSurface(ui.modal);
			}
			syncShellVisibility();
		});
	}

	/**
	 * @param {Object} config Launcher configuration localized from PHP.
	 * @returns {void}
	 */
	function showUnavailableModal(config) {
		refreshTeaserModal(config);
		showTeaserModal();
	}

	/**
	 * @param {Object} config Launcher configuration.
	 * @returns {void}
	 */
	function dispatchLaunchEvent(config) {
		const eventName = config.eventName || 'mwp-abe-launch-request';
		document.dispatchEvent(new window.CustomEvent(eventName, {
			detail: {
				postId: Number(SFE.ManagerData.postId || 0),
				source: 'mwp-sfe-base-launcher',
			},
		}));
	}

	/**
	 * @param {MouseEvent} event Click event.
	 * @returns {void}
	 */
	function handleLauncherClick(event) {
		event.preventDefault();
		event.stopPropagation();

		const config = getConfig();
		if (!config.isAvailable) {
			showUnavailableModal(config);
			return;
		}

		dispatchLaunchEvent(config);
	}

	/**
	 * Initialize the base launcher button.
	 *
	 * @returns {void}
	 */
	function init() {
		const config = getConfig();
		ensureVisibilityListener();
		ensureLifecycleRecovery();

		if (!config.enabled || getLauncherButton()) {
			return;
		}

		ensureUiShell();

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mwp-abe-launcher';
		button.setAttribute('data-mwp-sfe-control', 'true');
		button.setAttribute('aria-label', config.label || 'Open ABE');
		button.innerHTML = `<span class="mwp-abe-launcher-icon">${buildSparkleIcon()}</span>`;
		button.addEventListener('click', handleLauncherClick);

		shadowShell.appendChild(button);
	}

	SFE.ABELauncher = { init };

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
