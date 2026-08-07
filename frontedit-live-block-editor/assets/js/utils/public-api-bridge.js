/**
 * Public API bridge.
 *
 * Initializes the shared event emitter and internal helpers used by the
 * documented runtime API before the editor lifecycle modules run.
 *
 * Exposes:
 *   SFE.PublicApi
 *   SFE.PublicApiBridge
 */
(function() {
	'use strict';

	window.MWP = window.MWP || {};
	window.MWP.SFE = window.MWP.SFE || {};

	const SFE = window.MWP.SFE;
	const PublicApi = SFE.PublicApi || {};
	const eventListeners = new Map();
	const stagedBlockStates = new Map();

	/**
	 * Create a plain-data clone for event payloads and snapshots.
	 *
	 * @param {*} value Source value.
	 * @returns {*} Cloned value when possible.
	 */
	function clonePlainData(value) {
		if (value === null || typeof value === 'undefined') {
			return value;
		}

		try {
			return JSON.parse(JSON.stringify(value));
		} catch (error) {
			if (Array.isArray(value)) {
				return value.slice();
			}
			if (typeof value === 'object') {
				return Object.assign({}, value);
			}
			return value;
		}
	}

	/**
	 * Resolve the current editor snapshot builder when available.
	 *
	 * @param {Object|null} editorState Active editor state.
	 * @returns {Object|null} Stable editor snapshot.
	 */
	function buildEditorSnapshot(editorState) {
		if (typeof PublicApi._buildEditorSnapshot === 'function') {
			return PublicApi._buildEditorSnapshot(editorState);
		}
		return null;
	}

	/**
	 * Invoke one event handler safely.
	 *
	 * @param {Function} handler Registered listener.
	 * @param {Object}   payload Event payload.
	 * @returns {void}
	 */
	function callHandler(handler, payload) {
		try {
			handler(payload);
		} catch (error) {
			console.error('FrontEdit: PublicApi event handler failed', error);
		}
	}

	/**
	 * Emit one public runtime event.
	 *
	 * @param {string} eventName Event name.
	 * @param {Object} payload Event payload.
	 * @returns {void}
	 */
	function emitEvent(eventName, payload) {
		const listeners = eventListeners.get(eventName);
		if (!listeners || !listeners.size) {
			return;
		}

		const snapshot = clonePlainData(payload);
		listeners.forEach(handler => callHandler(handler, snapshot));
	}

	/**
	 * Register one runtime event listener.
	 *
	 * @param {string}   eventName Event name.
	 * @param {Function} handler Event handler.
	 * @returns {Function} Unsubscribe callback.
	 */
	function on(eventName, handler) {
		const normalizedEventName = String(eventName || '').trim();
		if (!normalizedEventName || typeof handler !== 'function') {
			return function noop() {};
		}

		if (!eventListeners.has(normalizedEventName)) {
			eventListeners.set(normalizedEventName, new Set());
		}

		eventListeners.get(normalizedEventName).add(handler);
		return function unsubscribe() {
			off(normalizedEventName, handler);
		};
	}

	/**
	 * Remove one runtime event listener.
	 *
	 * @param {string}   eventName Event name.
	 * @param {Function} handler Event handler.
	 * @returns {void}
	 */
	function off(eventName, handler) {
		const normalizedEventName = String(eventName || '').trim();
		if (!normalizedEventName || typeof handler !== 'function') {
			return;
		}

		const listeners = eventListeners.get(normalizedEventName);
		if (!listeners) {
			return;
		}

		listeners.delete(handler);
		if (!listeners.size) {
			eventListeners.delete(normalizedEventName);
		}
	}

	/**
	 * Emit one editor lifecycle event using the current snapshot builder.
	 *
	 * @param {string}      eventName Event name.
	 * @param {Object|null} editorState Editor session state.
	 * @param {Object}      metadata Additional event metadata.
	 * @returns {void}
	 */
	function emitEditorEvent(eventName, editorState, metadata = {}) {
		const editor = buildEditorSnapshot(editorState);
		if (!editor) {
			return;
		}

		emitEvent(eventName, Object.assign({}, metadata, { editor }));
	}

	/**
	 * Emit one save lifecycle event using the current snapshot builder.
	 *
	 * @param {string}      eventName Event name.
	 * @param {Object|null} editorState Editor session state.
	 * @param {Object}      metadata Additional event metadata.
	 * @returns {void}
	 */
	function emitSaveEvent(eventName, editorState, metadata = {}) {
		const editor = buildEditorSnapshot(editorState);
		if (!editor) {
			return;
		}

		emitEvent(eventName, Object.assign({}, metadata, { editor }));
	}

	PublicApi.on = on;
	PublicApi.off = off;

	SFE.PublicApi = PublicApi;
	SFE.PublicApiBridge = {
		clonePlainData,
		emitEvent,
		emitEditorEvent,
		emitSaveEvent,
		stagedBlockStates,
	};
})();
